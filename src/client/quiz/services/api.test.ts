import { describe, it, expect, vi } from 'vitest'
import { createQuizApi } from './api.js'

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok' }))
describe('browser API', () => {
  it('shares a host session request and uploads without browser authentication or JSON headers', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ token: 'local-token', user: { id: 1 } }))
      .mockResolvedValueOnce(ok({ doc_id: 'doc1', status: 'processing' }))
    const api = createQuizApi({ fetch: fetcher })
    await Promise.all([api.connect(), api.connect()])
    await api.uploadDocument(new File(['hello'], 'notes.txt'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    const headers = new Headers(fetcher.mock.calls[1][1].headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(fetcher.mock.calls[0][0]).toBe('/nobei/quiz/v1/session')
    expect(headers.has('Content-Type')).toBe(false)
    expect(fetcher.mock.calls[1][1].body).toBeInstanceOf(FormData)
  })
  it('preserves document source and generation settings', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ user: { id: 1 } })).mockResolvedValueOnce(ok({ task_id: 'task1' }))
    const api = createQuizApi({ fetch: fetcher })
    await api.connect()
    await api.generateQuiz({ source: { kind: 'document', docId: 'doc42', title: 'notes.txt', text: '重点学习第一章' }, questionCount: 8, difficulty: 'hard', generateImages: true })
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ user_input: '重点学习第一章', doc_id: 'doc42', question_count: 8, difficulty: 'hard', generate_images: true })
  })
  it('rejects an external source until its host adapter is supplied', async () => {
    const api = createQuizApi({ fetch: vi.fn() })
    await expect(api.generateQuiz({ source: { kind: 'external', provider: 'betterlearn', sourceId: 'book1', title: 'Book', text: 'Knowledge' }, questionCount: 5, difficulty: 'mixed', generateImages: false })).rejects.toThrow('来源适配器')
  })
  it('requests contiguous document text from the content endpoint', async () => {
    const content = { doc_id: 'doc42', file_name: 'notes.md', file_type: 'md', media_type: 'text/markdown', text: '# 标题', character_count: 4, byte_size: 7 }
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ user: { id: 1 } })).mockResolvedValueOnce(ok(content))
    const api = createQuizApi({ fetch: fetcher })
    await api.connect()
    await expect(api.getDocumentContent('doc 42')).resolves.toEqual(content)
    expect(fetcher.mock.calls[1][0]).toBe('/nobei/quiz/v1/knowledge/documents/doc%2042/content')
    expect(fetcher.mock.calls[1][1].method).toBe('GET')
  })
  it('surfaces non-JSON server failures instead of a misleading parse error', async () => {
    const api = createQuizApi({ fetch: vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })) })
    await expect(api.connect()).rejects.toThrow('502')
  })
})
