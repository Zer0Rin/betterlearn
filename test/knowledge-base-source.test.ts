import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import {
  KNOWLEDGE_BASE_MEDIA_TYPE,
  KnowledgeBaseSource,
  KnowledgeBaseSourceError,
  type KnowledgeBaseFetch,
} from '../src/product/knowledge-base-source.js'

const baseUrl = 'http://127.0.0.1:9090'
const token = 'token-fixture'

function documentItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    doc_id: 'doc_abc123',
    file_name: '操作系统笔记.md',
    file_type: 'md',
    file_size: 1024,
    status: 'ready',
    chunk_count: 12,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function envelope(data: unknown, code = 0): Response {
  return new Response(JSON.stringify({ code, message: code === 0 ? 'ok' : 'boom', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** 按路径分发响应；未登记的路径直接失败，避免测试静默走到默认分支。 */
function createSource(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = []
  const fetchImpl: KnowledgeBaseFetch = async (input, init) => {
    const url = String(input)
    const path = new URL(url).pathname
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    const handler = routes[path]
    if (!handler) throw new Error(`unexpected request: ${path}`)
    return handler()
  }
  const source = new KnowledgeBaseSource({ baseUrl, token, fetch: fetchImpl })
  return { source, calls }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof KnowledgeBaseSourceError) return error.code
    return `UNEXPECTED:${String(error)}`
  }
  return 'NO_ERROR'
}

describe('knowledge base source listing', () => {
  test('normalizes the metadata and keeps the original file name', async () => {
    const { source, calls } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: [documentItem()] }),
    })

    await expect(source.list()).resolves.toEqual([{
      docId: 'doc_abc123',
      fileName: '操作系统笔记.md',
      fileType: 'md',
      fileSize: 1024,
      status: 'ready',
      chunkCount: 12,
      createdAt: '2026-01-01T00:00:00Z',
    }])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${token}`)
  })

  test('carries the failure message of a broken document', async () => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({
        items: [documentItem({ status: 'failed', error_message: '解析失败' })],
      }),
    })

    await expect(source.list()).resolves.toEqual([
      expect.objectContaining({ status: 'failed', errorMessage: '解析失败' }),
    ])
  })

  test('drops entries without an id or a file name and unknown statuses', async () => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({
        items: [
          documentItem(),
          documentItem({ doc_id: '' }),
          documentItem({ file_name: '' }),
          null,
          'not-an-object',
          documentItem({ doc_id: 'doc_zzz', status: 'weird' }),
        ],
      }),
    })

    const documents = await source.list()
    expect(documents.map(document => document.docId)).toEqual(['doc_abc123', 'doc_zzz'])
    expect(documents[1]!.status).toBe('failed')
  })

  test('caps the list at 50 documents', async () => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({
        items: Array.from({ length: 60 }, (_, index) => documentItem({ doc_id: `doc_${index}` })),
      }),
    })

    await expect(source.list()).resolves.toHaveLength(50)
  })

  test.each([
    ['a non-array payload', () => envelope({ items: 'nope' })],
    ['a closed error envelope', () => envelope(undefined, 500)],
    ['an unparsable body', () => new Response('<html>', { status: 200 })],
  ])('reports an unreadable list for %s', async (_name, handler) => {
    const { source } = createSource({ '/api/v1/knowledge/documents': handler })

    await expect(codeOf(source.list())).resolves.toBe('KNOWLEDGE_BASE_READ_FAILED')
  })

  test.each([
    [401, 'KNOWLEDGE_BASE_UNAVAILABLE'],
    [403, 'KNOWLEDGE_BASE_UNAVAILABLE'],
    [404, 'KNOWLEDGE_BASE_DOCUMENT_NOT_FOUND'],
    [500, 'KNOWLEDGE_BASE_READ_FAILED'],
  ] as const)('maps HTTP %i to %s', async (status, code) => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => new Response('{}', { status }),
    })

    await expect(codeOf(source.list())).resolves.toBe(code)
  })

  test('treats a transport failure as unreadable rather than unavailable', async () => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => { throw new Error('ECONNREFUSED') },
    })

    await expect(codeOf(source.list())).resolves.toBe('KNOWLEDGE_BASE_READ_FAILED')
  })
})

describe('knowledge base source reading', () => {
  const readyItems = [
    documentItem({ doc_id: 'doc_alpha', file_name: '进程.md' }),
    documentItem({ doc_id: 'doc_beta', file_name: '线程.md' }),
  ]

  test('joins the selected documents into one continuous body', async () => {
    const { source, calls } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: readyItems }),
      '/api/v1/knowledge/documents/doc_alpha/content': () => envelope({ text: '进程是资源分配的单位。' }),
      '/api/v1/knowledge/documents/doc_beta/content': () => envelope({ text: '线程是调度的单位。' }),
    })

    const document = await source.read(['doc_beta', 'doc_alpha'])

    expect(document.text).toBe(
      '# 线程.md\n\n线程是调度的单位。\n\n# 进程.md\n\n进程是资源分配的单位。',
    )
    expect(document.docIds).toEqual(['doc_beta', 'doc_alpha'])
    expect(document.mediaType).toBe(KNOWLEDGE_BASE_MEDIA_TYPE)
    expect(document.documentCount).toBe(2)
    expect(document.characterCount).toBe(document.text.length)
    expect(document.byteSize).toBe(Buffer.byteLength(document.text, 'utf8'))
    // 摘要必须落在拼好的正文上，bl4dsh 的乐观并发校验依赖它。
    expect(document.contentDigest).toBe(
      createHash('sha256').update(document.text, 'utf8').digest('hex'),
    )
    // 顺序按调用方给定，内容请求也要用选中的 docId。
    expect(calls.slice(1).map(call => call.url)).toEqual([
      `${baseUrl}/api/v1/knowledge/documents/doc_beta/content`,
      `${baseUrl}/api/v1/knowledge/documents/doc_alpha/content`,
    ])
  })

  test('names a single document after its file name', async () => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: readyItems }),
      '/api/v1/knowledge/documents/doc_alpha/content': () => envelope({ text: '正文' }),
    })

    await expect(source.read(['doc_alpha'])).resolves.toMatchObject({ filename: '进程.md' })
  })

  test('names a merged body after the first document and the count', async () => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: readyItems }),
      '/api/v1/knowledge/documents/doc_alpha/content': () => envelope({ text: '正文' }),
      '/api/v1/knowledge/documents/doc_beta/content': () => envelope({ text: '正文' }),
    })

    await expect(source.read(['doc_alpha', 'doc_beta'])).resolves.toMatchObject({
      filename: '进程.md 等 2 篇知识库文档.md',
    })
  })

  test('escapes the doc id in the content path', async () => {
    const { source, calls } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: [documentItem({ doc_id: 'doc_a b' })] }),
      '/api/v1/knowledge/documents/doc_a%20b/content': () => envelope({ text: '正文' }),
    })

    await source.read(['doc_a b'])

    expect(calls[1]!.url).toBe(`${baseUrl}/api/v1/knowledge/documents/doc_a%20b/content`)
  })

  test('rejects an empty selection without touching the service', async () => {
    const { source, calls } = createSource({})

    await expect(codeOf(source.read([]))).resolves.toBe('KNOWLEDGE_BASE_EMPTY')
    expect(calls).toEqual([])
  })

  test('rejects a selection above the document cap without touching the service', async () => {
    const { source, calls } = createSource({})

    const tooMany = Array.from({ length: 51 }, (_, index) => `doc_${index}`)
    await expect(codeOf(source.read(tooMany))).resolves.toBe('KNOWLEDGE_BASE_TOO_LARGE')
    expect(calls).toEqual([])
  })

  test('rejects an unknown document id', async () => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: readyItems }),
    })

    await expect(codeOf(source.read(['doc_missing']))).resolves.toBe('KNOWLEDGE_BASE_DOCUMENT_NOT_FOUND')
  })

  test.each([
    ['processing'],
    ['failed'],
  ] as const)('refuses to read a document still in %s', async (status) => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: [documentItem({ status })] }),
    })

    await expect(codeOf(source.read(['doc_abc123']))).resolves.toBe('KNOWLEDGE_BASE_DOCUMENT_NOT_READY')
  })

  test.each([
    ['a missing text field', () => envelope({})],
    ['a blank text field', () => envelope({ text: '   \n\n  ' })],
    ['an empty document', () => new Response(JSON.stringify({ code: 0, data: { text: '' } }), { status: 200 })],
  ])('treats %s as an empty source', async (_name, handler) => {
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: readyItems }),
      '/api/v1/knowledge/documents/doc_alpha/content': handler,
    })

    await expect(codeOf(source.read(['doc_alpha']))).resolves.toBe('KNOWLEDGE_BASE_EMPTY')
  })

  test('stops reading once the merged body exceeds 512 KiB', async () => {
    // 先让单篇就逼近上限，第二篇一进来就必然越界。
    const oversized = 'a'.repeat(512 * 1024 - 200)
    let betaRead = 0
    const { source, calls } = createSource({
      '/api/v1/knowledge/documents': () => envelope({
        items: [
          documentItem({ doc_id: 'doc_alpha', file_name: '甲.md' }),
          documentItem({ doc_id: 'doc_beta', file_name: '乙.md' }),
        ],
      }),
      '/api/v1/knowledge/documents/doc_alpha/content': () => envelope({ text: oversized }),
      '/api/v1/knowledge/documents/doc_beta/content': () => {
        betaRead += 1
        return envelope({ text: oversized })
      },
    })

    const error = await source.read(['doc_alpha', 'doc_beta']).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(KnowledgeBaseSourceError)
    expect((error as KnowledgeBaseSourceError).code).toBe('KNOWLEDGE_BASE_TOO_LARGE')
    // 越界的是拼接后的总量，而不是单篇。
    expect((error as KnowledgeBaseSourceError).detail).toMatchObject({ limit: 512 * 1024 })
    expect(betaRead).toBe(1)
    expect(calls).toHaveLength(3)
  })

  test('never asks for the third document once the total is already over', async () => {
    const oversized = 'a'.repeat(512 * 1024 - 200)
    let gammaRead = 0
    const { source, calls } = createSource({
      '/api/v1/knowledge/documents': () => envelope({
        items: [
          documentItem({ doc_id: 'doc_alpha', file_name: '甲.md' }),
          documentItem({ doc_id: 'doc_beta', file_name: '乙.md' }),
          documentItem({ doc_id: 'doc_gamma', file_name: '丙.md' }),
        ],
      }),
      '/api/v1/knowledge/documents/doc_alpha/content': () => envelope({ text: oversized }),
      '/api/v1/knowledge/documents/doc_beta/content': () => envelope({ text: oversized }),
      '/api/v1/knowledge/documents/doc_gamma/content': () => {
        gammaRead += 1
        return envelope({ text: '小文档' })
      },
    })

    await expect(codeOf(source.read(['doc_alpha', 'doc_beta', 'doc_gamma'])))
      .resolves.toBe('KNOWLEDGE_BASE_TOO_LARGE')

    expect(gammaRead).toBe(0)
    expect(calls).toHaveLength(3)
  })

  test('counts the document headers towards the size limit', async () => {
    // 正文本身刚好在限制之下，加上标题后越界。
    const text = 'a'.repeat(512 * 1024 - 10)
    const { source } = createSource({
      '/api/v1/knowledge/documents': () => envelope({ items: [documentItem({ doc_id: 'doc_alpha', file_name: '超长.md' })] }),
      '/api/v1/knowledge/documents/doc_alpha/content': () => envelope({ text }),
    })

    await expect(codeOf(source.read(['doc_alpha']))).resolves.toBe('KNOWLEDGE_BASE_TOO_LARGE')
  })

  test('gives up on a hanging read instead of waiting forever', async () => {
    // 超时下限是 1000ms，AbortSignal.timeout 用的是真实计时器，只能用真实的短超时验证。
    const fetchImpl = vi.fn<KnowledgeBaseFetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const source = new KnowledgeBaseSource({ baseUrl, token, fetch: fetchImpl, timeoutMs: 1 })

    await expect(codeOf(source.list())).resolves.toBe('KNOWLEDGE_BASE_READ_FAILED')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  }, 5_000)

  test('lets the caller abort a read', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('aborted', 'AbortError')
    const fetchImpl = vi.fn<KnowledgeBaseFetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(abortError))
    }))
    const source = new KnowledgeBaseSource({ baseUrl, token, fetch: fetchImpl })

    const settled = source.list(controller.signal)
    controller.abort()

    // 调用方主动取消时不能伪装成知识库读取失败，否则界面会显示错误的提示。
    await expect(settled).rejects.toBe(abortError)
  })
})
