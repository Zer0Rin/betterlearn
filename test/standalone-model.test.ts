import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, test, vi } from 'vitest'
import { StandaloneGenerationAdapter } from '../src/standalone/model.js'
import { loadCandidateContract } from '../src/product/contract.js'
import type { PreparedGeneration } from '../src/product/types.js'

const contract = loadCandidateContract(process.cwd())
const valid = { schemaVersion: 1, candidates: [{ type: 'concept', title: '植物', statement: '绿色植物转化光能。', evidence: [{ quote: '绿色植物', prefix: '', suffix: '' }] }] }
const prepared: PreparedGeneration = {
  runId: 'r', attemptId: 'a', attemptNumber: 1, revision: 1,
  schemaVersion: 1, schemaSha256: contract.schemaSha256, promptVersion: 'l1-v3',
  document: { text: '绿色植物转化光能。', sha256: 'x' }, requestDigest: 'x', providerIdempotencyKey: 'x',
  modelSelection: { provider: 'local', model: 'frozen' },
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())) })
function output(res: ServerResponse, value: unknown) {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'structured_output', arguments: JSON.stringify(value) } }] } }] }))
}
async function provider(reply: (res: ServerResponse, body: any, count: number) => void) {
  const requests: Array<{ body: any; authorization?: string; url?: string }> = []
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    requests.push({ body, authorization: req.headers.authorization, url: req.url })
    reply(res, body, requests.length)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const connection = { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: 'fake-secret', model: 'frozen' }
  const resolveConnection = vi.fn(async () => connection)
  return { requests, connection, resolveConnection, adapter: new StandaloneGenerationAdapter(contract, resolveConnection) }
}
async function run(adapter: StandaloneGenerationAdapter, input = prepared) {
  const handle = await adapter.start(input, new AbortController().signal)
  return handle.result
}

test('forces the named function, validates complete business contract and makes exactly one HTTP call', async () => {
  const fake = await provider(res => output(res, valid))
  expect(await run(fake.adapter)).toEqual({ ok: true, value: valid })
  expect(fake.requests).toHaveLength(1)
  expect(fake.requests[0]).toMatchObject({ url: '/v1/chat/completions', authorization: 'Bearer fake-secret', body: {
    model: 'frozen', max_tokens: 32768, parallel_tool_calls: false, stream: false,
    tool_choice: { type: 'function', function: { name: 'structured_output' } },
  } })
  expect(fake.requests[0].body.tools[0].function.parameters).toEqual(contract.schema)
})

test('rejects invalid complete contract including bounds and extra properties', async () => {
  const fake = await provider(res => output(res, { ...valid, candidates: [{ ...valid.candidates[0], title: 'x'.repeat(1000), extra: true }] }))
  expect(await run(fake.adapter)).toEqual({ ok: false, code: 'GENERATION_SCHEMA_INVALID' })
  expect(fake.requests).toHaveLength(1)
})

test.each([401, 429, 500])('provider HTTP %i never retries', async status => {
  const fake = await provider(res => { res.statusCode = status; res.end('secret provider error') })
  expect(await run(fake.adapter)).toEqual({ ok: false, code: 'GENERATION_PROVIDER_ERROR' })
  expect(fake.requests).toHaveLength(1)
})

test.each([
  [{ choices: [{ finish_reason: 'length' }] }, 'GENERATION_OUTPUT_LIMIT'],
  [{ choices: [{ message: { content: '{}' } }] }, 'GENERATION_NO_OUTPUT'],
  [{ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'wrong', arguments: '{}' } }] } }] }, 'GENERATION_SCHEMA_INVALID'],
  [{ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'structured_output', arguments: '{' } }] } }] }, 'GENERATION_SCHEMA_INVALID'],
])('classifies malformed/missing structured output', async (body, code) => {
  const fake = await provider(res => res.end(JSON.stringify(body)))
  expect(await run(fake.adapter)).toEqual({ ok: false, code })
  expect(fake.requests).toHaveLength(1)
})

function grouped(strategy: 'L2' | 'L3' = 'L2'): PreparedGeneration {
  return { ...prepared, document: { text: '甲😀乙丙', sha256: 'x' }, extractionPlan: {
    strategy, blocks: [{ id: 'b1', textStart: 0, textEnd: 2 }, { id: 'b2', textStart: 2, textEnd: 4 }],
    containers: [{ blockIds: ['b1', 'b2'], textStart: 0, textEnd: 4 }],
    boundaries: strategy === 'L3' ? [{ textStart: 1, textEnd: 3 }] : [], maxCalls: 4,
  } }
}
test.each(['L2', 'L3'] as const)('%s reuses planning and freezes connection across every batch', async strategy => {
  const fake = await provider((res, _body, count) => {
    if (count === 1) {
      fake.connection.model = 'edited'; fake.connection.apiKey = 'edited'; fake.connection.baseUrl = 'http://127.0.0.1:1'
      output(res, { groups: [{ blockIds: ['b1'] }, { blockIds: ['b2'] }] })
    } else output(res, valid)
  })
  const result = await run(fake.adapter, grouped(strategy))
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.value.batches).toHaveLength(strategy === 'L2' ? 2 : 3)
  expect(fake.resolveConnection).toHaveBeenCalledTimes(1)
  expect(fake.requests.every(req => req.body.model === 'frozen' && req.authorization === 'Bearer fake-secret')).toBe(true)
  expect(fake.requests[1].body.messages[0].content).toContain('甲😀')
})

test('invalid plan and call ceiling prevent extra extraction calls', async () => {
  const fake = await provider(res => output(res, { groups: [{ blockIds: ['b1'] }, { blockIds: ['b2'] }] }))
  const input = grouped(); input.extractionPlan!.maxCalls = 1
  expect(await run(fake.adapter, input)).toEqual({ ok: false, code: 'GENERATION_SCHEMA_INVALID' })
  expect(fake.requests).toHaveLength(1)
  const bad = await provider(res => output(res, { groups: [{ blockIds: ['b2', 'b1'] }] }))
  expect(await run(bad.adapter, grouped())).toEqual({ ok: false, code: 'GENERATION_SCHEMA_INVALID' })
  expect(bad.requests).toHaveLength(1)
})

test('cancel during request settles and launches no later batches', async () => {
  let received!: () => void
  const waiting = new Promise<void>(resolve => { received = resolve })
  const fake = await provider(() => received())
  const handle = await fake.adapter.start(grouped(), new AbortController().signal)
  await waiting
  handle.cancel()
  expect(await handle.result).toEqual({ ok: false, code: 'GENERATION_PROVIDER_ERROR' })
  await handle.dispose(); await handle.dispose()
  expect(fake.requests).toHaveLength(1)
})

test('timeout settles stalled HTTP request and stalled configuration lookup', async () => {
  const fake = await provider(() => {})
  const adapter = new StandaloneGenerationAdapter(contract, fake.resolveConnection, { timeoutMs: 30 })
  expect(await run(adapter)).toEqual({ ok: false, code: 'GENERATION_TIMEOUT' })
  const pending = new StandaloneGenerationAdapter(contract, () => new Promise(() => {}), { timeoutMs: 30 })
  expect(await run(pending)).toEqual({ ok: false, code: 'GENERATION_TIMEOUT' })
})

test('already aborted attempt performs no lookup and no HTTP request', async () => {
  const fake = await provider(res => output(res, valid))
  const handle = await fake.adapter.start(prepared, AbortSignal.abort())
  expect(await handle.result).toEqual({ ok: false, code: 'GENERATION_PROVIDER_ERROR' })
  expect(fake.resolveConnection).not.toHaveBeenCalled()
  expect(fake.requests).toHaveLength(0)
})

test('freezes explicitly selected reasoning effort for every request', async () => {
  const input = grouped()
  input.modelSelection = { ...input.modelSelection, reasoningEffort: 'high' }
  const fake = await provider((res, _body, count) => {
    input.modelSelection.reasoningEffort = 'low'
    output(res, count === 1 ? { groups: [{ blockIds: ['b1', 'b2'] }] } : valid)
  })
  expect((await run(fake.adapter, input)).ok).toBe(true)
  expect(fake.requests.map(request => request.body.reasoning_effort)).toEqual(['high', 'high'])
})
