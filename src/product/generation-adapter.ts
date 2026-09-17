import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { GENERATION_TOOL_DENIAL } from './constants.js'
import type { CandidateContract } from './contract.js'
import { ModelSelectionPropagation } from './model-selection-propagation.js'
import type { PreparedGeneration } from './types.js'
import { PlannedGenerationAdapter, type GenerationHandle, type GenerationAdapterResult } from './generation-plan.js'
export { promptFor, promptIdentity, PLANNER_SCHEMA, plannerPrompt, validatePlannerGroups } from './generation-plan.js'
export type { GenerationAdapter, GenerationAdapterResult, GenerationHandle } from './generation-plan.js'

export const WORKFLOW_SCRIPT = 'const value = await agent(args.prompt, { schema: args.schema })\nreturn value'
export { GENERATION_TOOL_DENIAL } from './constants.js'

interface StructuredGenerationAdapterOptions {
  packageRoot: string
}

const WORKFLOW_SCHEMA_KEYS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'title', 'description', 'default',
])

function inferredType(value: unknown): string | undefined {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string' || typeof value === 'boolean') return typeof value
  if (typeof value === 'object') return 'object'
  return undefined
}

function warnGeneration(ctx: Context, message: string): void {
  const logger = (ctx as Context & { logger?: { warn(value: string): void } }).logger
  logger?.warn(`nobei generation: ${message}`)
}

export function toWorkflowSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWorkflowSchema)
  if (value === null || typeof value !== 'object') return value
  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(input)) {
    if (!WORKFLOW_SCHEMA_KEYS.has(key)) continue
    if (key === 'properties' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
      output.properties = Object.fromEntries(
        Object.entries(child as Record<string, unknown>).map(([name, schema]) => [name, toWorkflowSchema(schema)]),
      )
    } else {
      output[key] = toWorkflowSchema(child)
    }
  }
  if (output.type === undefined) {
    if (Object.hasOwn(output, 'const')) output.type = inferredType(output.const)
    else if (Array.isArray(output.enum) && output.enum.length > 0) {
      const types = new Set(output.enum.map(inferredType))
      if (types.size === 1) output.type = [...types][0]
    }
  }
  // rc.7/rc.8 reject these validation keywords. Preserve their meaning for the
  // model as annotations; the original contract still enforces every bound.
  const bounds = output.type === 'array'
    ? [input.minItems, input.maxItems]
    : output.type === 'string' ? [input.minLength, input.maxLength] : []
  const limits = [
    typeof bounds[0] === 'number' ? `at least ${bounds[0]}` : '',
    typeof bounds[1] === 'number' ? `at most ${bounds[1]}` : '',
  ].filter(Boolean)
  if (limits.length) {
    const description = output.type === 'array'
      ? `Item count: ${limits.join(' and ')}.`
      : `Length: ${limits.join(' and ')} Unicode characters.`
    output.description = [output.description, description].filter(Boolean).join(' ')
  }
  return output
}

export class StructuredGenerationAdapter extends PlannedGenerationAdapter {
  constructor(
    private readonly ctx: Context,
    contract: CandidateContract,
    private readonly options: StructuredGenerationAdapterOptions,
  ) { super(contract) }

  protected override warn(message: string): void { warnGeneration(this.ctx, message) }

  protected async startCall(prepared: PreparedGeneration, signal: AbortSignal, prompt: string, schema: unknown, planning: boolean, onResponse: (time: number) => void): Promise<GenerationHandle> {
    const propagation = new ModelSelectionPropagation(this.ctx, prepared.modelSelection)
    const parent = await this.ctx.agents.create({
      sessionId: SessionId(`nobei-phase1c-${randomUUID()}`),
      meta: { cwd: this.options.packageRoot },
      agentOptions: propagation.agentOptions,
      setup: propagation.setupParent,
      signal,
    })
    try {
      propagation.observeChildren(parent.agent, onResponse)
    } catch (error) {
      propagation.disposeBoundaries()
      await parent.dispose().catch(() => undefined)
      throw error
    }

    let run: WorkflowRun | undefined
    let cancelled = signal.aborted
    let cleanupPromise: Promise<void> | undefined
    const cleanup = (): Promise<void> => {
      cleanupPromise ??= (async () => {
        let firstError: unknown
        try {
          propagation.disposeBoundaries()
        } catch (error) {
          firstError = error
        }
        if (run) {
          try {
            await run.dispose()
          } catch (error) {
            firstError ??= error
          }
        }
        try {
          await parent.dispose()
        } catch (error) {
          firstError ??= error
        }
        if (firstError) throw firstError
      })()
      return cleanupPromise
    }

    const outcomePromise = (async () => {
      run = this.ctx.workflowEngine.start({
        script: WORKFLOW_SCRIPT,
        meta: {
          name: 'nobei-phase1c-candidate-generation',
          description: 'Generate one structured candidate set from an owned source document.',
        },
        args: {
          prompt,
          schema: toWorkflowSchema(schema),
        },
        parent: parent.agent,
        subagentProvider: 'spawn',
        maxTotalAgents: 1,
        signal,
      })
      if (signal.aborted) run.cancel('nobei-generation-cancelled')
      return run.result
    })()

    const result = (async (): Promise<GenerationAdapterResult> => {
      let classified: GenerationAdapterResult
      try {
        const outcome = await outcomePromise
        propagation.assertComplete()
        if (cancelled || signal.aborted || outcome.stopReason !== 'completed' || outcome.agentsStarted !== 1) {
          warnGeneration(this.ctx, `workflow rejected (cancelled=${cancelled}, aborted=${signal.aborted}, stopReason=${outcome.stopReason}, agentsStarted=${outcome.agentsStarted})`)
          classified = { ok: false, code: 'GENERATION_PROVIDER_ERROR' }
        } else if (outcome.value === null || outcome.value === undefined) {
          classified = { ok: false, code: propagation.childStopReason === 'max-tokens'
            ? 'GENERATION_OUTPUT_LIMIT' : 'GENERATION_NO_OUTPUT' }
        } else if (!planning && this.contract.validate(outcome.value).length > 0) {
          classified = { ok: false, code: 'GENERATION_SCHEMA_INVALID' }
        } else {
          classified = { ok: true, value: outcome.value as Record<string, unknown> }
        }
      } catch (error) {
        warnGeneration(this.ctx, `workflow failed (${error instanceof Error ? error.message : String(error)})`)
        classified = { ok: false, code: 'GENERATION_PROVIDER_ERROR' }
      }

      try {
        await cleanup()
      } catch (error) {
        warnGeneration(this.ctx, `cleanup failed (${error instanceof Error ? error.message : String(error)})`)
        if (classified.ok) return { ok: false, code: 'GENERATION_PROVIDER_ERROR' }
      }
      return classified
    })()

    let cancelCalled = false
    const cancel = (): void => {
      if (cancelCalled) return
      cancelCalled = true
      cancelled = true
      run?.cancel('nobei-generation-cancelled')
    }
    let disposePromise: Promise<void> | undefined
    return {
      result,
      cancel,
      dispose(): Promise<void> {
        if (!disposePromise) {
          cancel()
          disposePromise = result.then(() => undefined)
        }
        return disposePromise
      },
    }
  }
}
