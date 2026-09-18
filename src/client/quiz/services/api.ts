import type { LoginResponse } from '../types.js'
import type { QuizApi } from './contracts.js'

export class QuizApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
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
        throw new QuizApiError(result?.message || detail || `请求失败（HTTP ${response.status}），请检查后端服务`, response.status)
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
    getKnowledgeStats: (query = {}, signal) => {
      const params = new URLSearchParams({page_size:'20'})
      for (const [key,value] of Object.entries(query)) if (value !== undefined) params.set(key,String(value))
      return send(`/question-bank/knowledge-stats?${params}`, 'GET', undefined, 30000, signal)
    },
    getKnowledgeHistory: (query, signal) => {
      const params = new URLSearchParams({page_size:'20'})
      for (const [key,value] of Object.entries(query)) if (value !== undefined) params.set(key,String(value))
      return send(`/question-bank/knowledge-stats/history?${params}`, 'GET', undefined, 30000, signal)
    },
    getBankSource: id => send(`/question-bank/entries/${id}/source`),
    setBankSource: (id, input) => send(`/question-bank/entries/${id}/source`, 'PUT', input),
    generateFromSource: input => send('/quiz/generate/from-source', 'POST', input),
    previewPaper: input => send('/exam-papers/preview', 'POST', input),
    createPaper: input => send('/exam-papers', 'POST', input),
    listPapers: (page = 1) => send(`/exam-papers?page=${page}&page_size=20`),
    getPaper: id => send(`/exam-papers/${encodeURIComponent(id)}`),
    reviewPaper: (id, input) => send(`/exam-papers/${encodeURIComponent(id)}/review`, 'PUT', input),
    startExam: (id, input) => send(`/exam-papers/${encodeURIComponent(id)}/sessions`, 'POST', input),
    listExams: (page = 1) => send(`/exam-sessions?page=${page}&page_size=20`),
    getExam: id => send(`/exam-sessions/${encodeURIComponent(id)}`),
    saveExam: (id, input) => send(`/exam-sessions/${encodeURIComponent(id)}/answers`, 'PUT', input),
    submitExam: (id, input) => send(`/exam-sessions/${encodeURIComponent(id)}/submit`, 'POST', input),
    listGoals: (status = 'active', page = 1, signal) => send(`/learning-goals?status=${status}&page=${page}&page_size=20`, 'GET', undefined, 30000, signal),
    getGoal: (id, signal) => send(`/learning-goals/${encodeURIComponent(id)}`, 'GET', undefined, 30000, signal),
    createGoal: input => send('/learning-goals', 'POST', input),
    archiveGoal: (id, input) => send(`/learning-goals/${encodeURIComponent(id)}/archive`, 'PUT', input),
    getBankEntries: (query = {}, signal) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries({...query, page_size: query.page_size ?? 20})) if (value !== undefined) params.set(key, String(value))
      return send(`/question-bank/entries?${params}`, 'GET', undefined, 30000, signal)
    },
    getBankEntry: id => send(`/question-bank/entries/${id}`),
    getBankHistory: (id, page = 1) => send(`/question-bank/entries/${id}/history?page=${page}&page_size=20`),
    getBankStats: () => send('/question-bank/stats'),
    getBankCategories: () => send('/question-bank/categories'),
    setBankBookmark: (id, bookmarked) => send(`/question-bank/entries/${id}`, 'PUT', {bookmarked}),
    createBankCategory: name => send('/question-bank/categories', 'POST', {name}),
    renameBankCategory: (id, name) => send(`/question-bank/categories/${id}`, 'PUT', {name}),
    deleteBankCategory: id => send(`/question-bank/categories/${id}`, 'DELETE'),
    setBankCategory: (entryId, categoryId, linked) => send(`/question-bank/entries/${entryId}/categories/${categoryId}`, linked ? 'PUT' : 'DELETE', linked ? {} : undefined),
    createAttempt: (id, requestId) => send(`/quiz/${encodeURIComponent(id)}/attempts`, 'POST', { request_id: requestId }),
    listAttempts: id => send(`/quiz/${encodeURIComponent(id)}/attempts`),
    getAttempt: id => send(`/quiz/attempts/${encodeURIComponent(id)}`),
    saveAttempt: (id, input) => send(`/quiz/attempts/${encodeURIComponent(id)}/answers`, 'PUT', input),
    submitAttempt: (id, input) => send(`/quiz/attempts/${encodeURIComponent(id)}/submit`, 'POST', input),
    generateAttemptReport: id => send(`/quiz/attempts/${encodeURIComponent(id)}/report`, 'POST', {}, 600000),
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
    vectorizeDocument: docId => send(`/knowledge/documents/${encodeURIComponent(docId)}/vectorize`, 'POST', {}),
    uploadDocument: file => { const form = new FormData(); form.append('file', file); return send('/knowledge/documents', 'POST', form) },
    deleteDocument: id => send(`/knowledge/documents/${encodeURIComponent(id)}`, 'DELETE'),
  }
}
