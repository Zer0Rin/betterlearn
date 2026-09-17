import type { LoginResponse } from '../types.js'
import type { QuizApi } from './contracts.js'

interface Options {
  baseUrl?: string
  fetch?: typeof fetch
}
export function createQuizApi({ baseUrl = '/nobei/quiz/v1', fetch: fetcher = globalThis.fetch.bind(globalThis) }: Options = {}): QuizApi {
  let login: Promise<LoginResponse> | undefined

  async function send<T>(path: string, method = 'GET', body?: unknown, timeout = 120000, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('请求超时，请重试')), timeout)
    const headers: Record<string, string> = {}
    const form = body instanceof FormData
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
    try {
      const response = await fetcher(`${baseUrl}${path}`, { method, headers, body: form ? body : body === undefined ? undefined : JSON.stringify(body), signal: controller.signal })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result || result.code !== 0) {
        const detail = typeof result?.detail === 'string' ? result.detail : null
        throw new Error(result?.message || detail || `请求失败（HTTP ${response.status}），请检查后端服务`)
      }
      return result.data as T
    } catch (error) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? '已停止等待' : '请求超时，请重试')
      if (error instanceof TypeError) throw new Error('无法连接服务，请确认后端已启动')
      throw error
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  function connect() {
    if (!login) login = send<LoginResponse>('/session', 'POST').catch(error => { login = undefined; throw error })
    return login
  }
  return {
    connect,
    async generateQuiz(input) {
      if (input.source.kind === 'external') throw new Error('此知识来源需要宿主提供来源适配器')
      const { source } = input
      return send('/quiz/generate/async', 'POST', {
        user_input: source.kind === 'topic' ? source.text : source.text?.trim() || `请基于我上传的知识库文档《${source.title}》生成一套闯关题`,
        ...(source.kind === 'document' ? { doc_id: source.docId } : {}),
        question_count: input.questionCount, difficulty: input.difficulty, generate_images: input.generateImages,
      })
    },
    getTask: (id, signal) => send(`/quiz/task/${encodeURIComponent(id)}`, 'GET', undefined, 30000, signal),
    generateReport: input => send('/report/generate', 'POST', input, 600000),
    getProfile: () => send('/user/profile'),
    updateProfile: input => send('/user/profile', 'PUT', input),
    getHistory: (page = 1) => send(`/user/quizzes?page=${page}&page_size=10`),
    getDetail: id => send(`/user/quizzes/${encodeURIComponent(id)}`),
    getDocuments: signal => send('/knowledge/documents', 'GET', undefined, 30000, signal),
    getDocumentContent: (id, signal) => send(`/knowledge/documents/${encodeURIComponent(id)}/content`, 'GET', undefined, 120000, signal),
    uploadDocument: file => { const form = new FormData(); form.append('file', file); return send('/knowledge/documents', 'POST', form) },
    deleteDocument: id => send(`/knowledge/documents/${encodeURIComponent(id)}`, 'DELETE'),
  }
}
