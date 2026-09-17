import type { CandidateContract } from '../product/contract.js'
import { GENERATION_TIMEOUT_MS } from '../product/constants.js'
import { PlannedGenerationAdapter, type GenerationAdapter, type GenerationAdapterResult, type GenerationHandle } from '../product/generation-plan.js'
import type { ModelSelectionSnapshot, PreparedGeneration } from '../product/types.js'
import type { GenerationProgress } from '../generation-progress.js'

export interface ModelConnection {
  /** OpenAI-compatible API root, usually ending in /v1. */
  baseUrl: string
  apiKey: string
  model: string
}
export type ResolveConnection = (selection: ModelSelectionSnapshot) => Promise<ModelConnection>

type Call = (signal: AbortSignal, prompt: string, schema: unknown, planning: boolean, onResponse: (time: number) => void) => Promise<GenerationHandle>
class AttemptPlan extends PlannedGenerationAdapter {
  constructor(contract: CandidateContract, private readonly call: Call) { super(contract) }
  protected startCall(_prepared: PreparedGeneration, signal: AbortSignal, prompt: string, schema: unknown, planning: boolean, onResponse: (time: number) => void) {
    return this.call(signal, prompt, schema, planning, onResponse)
  }
}

/** One explicitly forced function call per planned batch; never retries requests. */
export class StandaloneGenerationAdapter implements GenerationAdapter {
  constructor(
    private readonly contract: CandidateContract,
    private readonly resolveConnection: ResolveConnection,
    private readonly options: { timeoutMs?: number } = {},
  ) {}

  async start(prepared: PreparedGeneration, signal: AbortSignal, onProgress?: (progress: GenerationProgress) => void): Promise<GenerationHandle> {
    const selection = { ...prepared.modelSelection }
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? GENERATION_TIMEOUT_MS)
    const attemptSignal = AbortSignal.any([signal, timeout])
    let connection: Promise<ModelConnection> | undefined
    const plan = new AttemptPlan(this.contract, async (callSignal, prompt, schema, planning, onResponse) => {
      const controller = new AbortController()
      const requestSignal = AbortSignal.any([callSignal, controller.signal])
      const result = (async (): Promise<GenerationAdapterResult> => {
        try {
          requestSignal.throwIfAborted()
          // Resolve and copy once so settings edits cannot change later batches.
          connection ??= this.resolveConnection(selection).then(value => ({ ...value }))
          const frozen = await abortable(connection, requestSignal)
          requestSignal.throwIfAborted()
          const url = new URL(`${frozen.baseUrl.replace(/\/+$/, '')}/chat/completions`)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('INVALID_MODEL_URL')
          const response = await fetch(url, {
            method: 'POST', signal: requestSignal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${frozen.apiKey}` },
            body: JSON.stringify({
              model: frozen.model,
              ...(selection.reasoningEffort ? { reasoning_effort: selection.reasoningEffort } : {}),
              messages: [{ role: 'user', content: prompt }],
              tools: [{ type: 'function', function: { name: 'structured_output', description: 'Return the requested extraction or plan.', parameters: schema } }],
              tool_choice: { type: 'function', function: { name: 'structured_output' } },
              parallel_tool_calls: false,
              stream: false,
            }),
          })
          onResponse(Date.now())
          if (!response.ok) { await response.body?.cancel(); return { ok: false, code: 'GENERATION_PROVIDER_ERROR' } }
          const body = await response.json() as any
          requestSignal.throwIfAborted()
          const choice = body?.choices?.[0]
          if (choice?.finish_reason === 'length') return { ok: false, code: 'GENERATION_OUTPUT_LIMIT' }
          const calls = choice?.message?.tool_calls
          if (!Array.isArray(calls) || calls.length === 0) return { ok: false, code: 'GENERATION_NO_OUTPUT' }
          if (calls.length !== 1 || calls[0]?.type !== 'function' || calls[0]?.function?.name !== 'structured_output'
            || typeof calls[0]?.function?.arguments !== 'string') return { ok: false, code: 'GENERATION_SCHEMA_INVALID' }
          let value: unknown
          try { value = JSON.parse(calls[0].function.arguments) } catch { return { ok: false, code: 'GENERATION_SCHEMA_INVALID' } }
          if (!value || typeof value !== 'object' || Array.isArray(value)
            || (!planning && this.contract.validate(value).length)) return { ok: false, code: 'GENERATION_SCHEMA_INVALID' }
          return { ok: true, value: value as Record<string, unknown> }
        } catch {
          // Deliberately omit response bodies, connection details and provider errors.
          return { ok: false, code: 'GENERATION_PROVIDER_ERROR' }
        }
      })()
      return { result, cancel: () => controller.abort(), dispose: async () => { controller.abort(); await result } }
    })
    const handle = await plan.start(prepared, attemptSignal, onProgress)
    return {
      get progress() { return handle.progress },
      result: handle.result.then(result => timeout.aborted && !signal.aborted
        ? { ok: false as const, code: 'GENERATION_TIMEOUT' as const } : result),
      cancel: () => handle.cancel(),
      dispose: () => handle.dispose(),
    }
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}
