import type { RouteContext } from './http-port.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { authorizeProductRequest } from './request-security.js'
import { resolveQuizSource, QuizSourceError, type QuizSourceResolver } from './quiz-source.js'
import { resolveLearningGoal, validLearningGoalQuery } from './learning-goal.js'
import { resolveSourceGeneration } from './source-generation.js'
import type { QuizServicePort } from './quiz-service.js'

const PREFIX = '/nobei/quiz/v1'
const JSON_LIMIT = 1024 * 1024
const UPLOAD_LIMIT = 11 * 1024 * 1024
const RESPONSE_LIMIT = 16 * 1024 * 1024
const ID = '[A-Za-z0-9_-]{1,100}'
const BANK_ID = '[1-9][0-9]{0,15}'
const routes: Array<[RegExp, readonly string[]]> = [
  [/^\/session$/, ['POST']],
  [/^\/exam-papers$/, ['GET', 'POST']],
  [/^\/exam-papers\/preview$/, ['POST']],
  [/^\/exam-papers\/paper_[0-9a-f]{32}$/, ['GET']],
  [/^\/exam-papers\/paper_[0-9a-f]{32}\/review$/, ['PUT']],
  [/^\/exam-papers\/paper_[0-9a-f]{32}\/sessions$/, ['POST']],
  [/^\/exam-sessions$/, ['GET']],
  [/^\/exam-sessions\/exam_[0-9a-f]{32}$/, ['GET']],
  [/^\/exam-sessions\/exam_[0-9a-f]{32}\/answers$/, ['PUT']],
  [/^\/exam-sessions\/exam_[0-9a-f]{32}\/submit$/, ['POST']],
  [/^\/learning-goals$/, ['GET', 'POST']],
  [/^\/learning-goals\/goal_[0-9a-f]{32}$/, ['GET']],
  [/^\/learning-goals\/goal_[0-9a-f]{32}\/archive$/, ['PUT']],
  [/^\/user\/profile$/, ['GET', 'PUT']],
  [/^\/user\/quizzes$/, ['GET']],
  [new RegExp(`^/user/quizzes/${ID}$`), ['GET']],
  [/^\/quiz\/generate\/async$/, ['POST']],
  [/^\/quiz\/generate\/from-source$/, ['POST']],
  [new RegExp(`^/quiz/task/${ID}$`), ['GET']],
  [new RegExp(`^/quiz/${ID}/attempts$`), ['GET', 'POST']],
  [new RegExp(`^/quiz/attempts/${ID}$`), ['GET']],
  [new RegExp(`^/quiz/attempts/${ID}/answers$`), ['PUT']],
  [new RegExp(`^/quiz/attempts/${ID}/(?:submit|report)$`), ['POST']],
  [/^\/question-bank\/entries$/, ['GET']],
  [/^\/question-bank\/stats$/, ['GET']],
  [/^\/question-bank\/knowledge-stats(?:\/history)?$/, ['GET']],
  [/^\/question-bank\/knowledge-assessment$/, ['GET']],
  [new RegExp(`^/question-bank/entries/${BANK_ID}/source$`), ['GET', 'PUT']],
  [new RegExp(`^/question-bank/entries/${BANK_ID}$`), ['GET', 'PUT']],
  [new RegExp(`^/question-bank/entries/${BANK_ID}/history$`), ['GET']],
  [/^\/question-bank\/categories$/, ['GET', 'POST']],
  [new RegExp(`^/question-bank/categories/${BANK_ID}$`), ['PUT', 'DELETE']],
  [new RegExp(`^/question-bank/entries/${BANK_ID}/categories/${BANK_ID}$`), ['PUT', 'DELETE']],
  [/^\/report\/generate$/, ['POST']],
  [/^\/knowledge\/documents$/, ['GET', 'POST']],
  [new RegExp(`^/knowledge/documents/${ID}$`), ['GET', 'DELETE']],
  [new RegExp(`^/knowledge/documents/${ID}/content$`), ['GET']],
  [new RegExp(`^/knowledge/documents/${ID}/vectorize$`), ['POST']],
]

function validExamQuery(path: string, params: URLSearchParams, method?: string): boolean {
  if (method !== 'GET' || !['/exam-papers', '/exam-sessions'].includes(path)) return params.size === 0
  const seen = new Set<string>()
  for (const [key, value] of params) {
    if (seen.has(key) || !['page', 'page_size'].includes(key)
      || !/^[1-9][0-9]{0,6}$/.test(value) || Number(value) > (key === 'page' ? 1000000 : 100)) return false
    seen.add(key)
  }
  return true
}

function validBankQuery(path: string, params: URLSearchParams): boolean {
  const stats = path === '/question-bank/knowledge-stats'
  const statsHistory = path === '/question-bank/knowledge-stats/history'
  const assessment = path === '/question-bank/knowledge-assessment'
  if (stats || statsHistory || assessment) {
    const seen = new Set<string>()
    for (const [key, value] of params) {
      if (seen.has(key)) return false
      seen.add(key)
      if (key === 'page' || key === 'page_size') {
        if (assessment) return false
        if (!/^[1-9][0-9]{0,6}$/.test(value) || Number(value) > (key === 'page' ? 1000000 : 100)) return false
      } else if (key === 'knowledge_point_id') {
        if (!/^kp_[0-9a-f]{20}$/.test(value)) return false
      } else if (key === 'content_version') {
        if (!/^[0-9a-f]{64}$/.test(value)) return false
      } else return false
    }
    return (!params.has('content_version') || params.has('knowledge_point_id'))
      && (!(statsHistory || assessment) || (params.has('knowledge_point_id') && params.has('content_version')))
  }
  const listing = path === '/question-bank/entries'
  const history = new RegExp(`^/question-bank/entries/${BANK_ID}/history$`).test(path)
  if (!listing && !history) return params.size === 0
  const seen = new Set<string>()
  for (const [key, value] of params) {
    if (seen.has(key)) return false
    seen.add(key)
    if (key === 'page' || key === 'page_size') {
      if (!/^[1-9][0-9]{0,6}$/.test(value) || Number(value) > (key === 'page' ? 1000000 : 100)) return false
    } else if (!listing) return false
    else if (key === 'scope') { if (!['all', 'wrong', 'ever_wrong', 'bookmarked', 'uncategorized'].includes(value)) return false }
    else if (key === 'sort') { if (!['recent', 'oldest'].includes(value)) return false }
    else if (key === 'category_id') { if (!new RegExp(`^${BANK_ID}$`).test(value)) return false }
    else if (key === 'quiz_id') { if (!new RegExp(`^${ID}$`).test(value)) return false }
    else if (key === 'search') { if ([...value].length > 200) return false }
    else return false
  }
  return true
}

function send(res: ServerResponse, status: number, message: string, data: unknown = null): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ code: status < 400 ? 0 : status * 10, message, data }))
}

async function readBody(req: IncomingMessage, limit: number): Promise<ArrayBuffer | undefined> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    length += chunk.byteLength
    if (length > limit) throw new Error('BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  if (!length) return undefined
  return Uint8Array.from(Buffer.concat(chunks)).buffer
}

async function responseBody(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > RESPONSE_LIMIT) { await reader.cancel(); throw new Error('UPSTREAM_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}

export function registerQuizRoutes(ctx: RouteContext, service?: QuizServicePort, sourceResolver?: QuizSourceResolver): () => void {
  const pending = new Set<AbortController>()
  const unregister = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: async (req, res) => {
    const trust = authorizeProductRequest(req, req.method !== 'GET', ctx.webServer.port)
    if (!trust.ok) return send(res, trust.status, trust.code)
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname.slice(PREFIX.length)
    const methods = url.pathname.startsWith(PREFIX + '/') ? routes.find(([pattern]) => pattern.test(path))?.[1] : undefined
    const validQuery = path.startsWith('/exam-') ? validExamQuery(path, url.searchParams, req.method) : path.startsWith('/learning-goals') ? validLearningGoalQuery(path, url.searchParams, req.method) : path.startsWith('/question-bank/') ? validBankQuery(path, url.searchParams) : path === '/user/quizzes'
      ? [...url.searchParams].every(([key, value]) => ['page', 'page_size'].includes(key) && /^\d{1,6}$/.test(value))
      : url.search === ''
    if (!methods || !validQuery) return send(res, 404, 'ROUTE_NOT_FOUND')
    if (!methods.includes(req.method ?? '')) return send(res, 405, 'METHOD_NOT_ALLOWED')
    if (!service) return send(res, 503, '练习服务尚未配置，请运行 BetterLearn 升级或安装流程')
    const upload = path === '/knowledge/documents' && req.method === 'POST'
    const limit = upload ? UPLOAD_LIMIT : JSON_LIMIT
    const length = req.headers['content-length']
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
      req.resume(); return send(res, 413, 'BODY_TOO_LARGE')
    }
    const controller = new AbortController()
    pending.add(controller)
    const disconnect = () => { if (!res.writableEnded) controller.abort() }
    res.once('close', disconnect)
    try {
      const contentType = req.headers['content-type'] ?? ''
      if (upload && !/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) return send(res, 415, 'MULTIPART_REQUIRED')
      if (['POST', 'PUT'].includes(req.method ?? '') && !upload && path !== '/session'
        && contentType.split(';')[0].trim().toLowerCase() !== 'application/json') return send(res, 415, 'JSON_REQUIRED')
      let body = await readBody(req, limit)
      if (body && ['GET', 'DELETE'].includes(req.method ?? '')) return send(res, 400, 'BODY_FORBIDDEN')
      if (path === '/session') {
        if (body) return send(res, 400, 'BODY_FORBIDDEN')
        return send(res, 200, 'success', await service.session())
      }
      if (req.method === 'PUT' && new RegExp(`^/question-bank/entries/${BANK_ID}/source$`).test(path)) {
        body = await resolveQuizSource(body, sourceResolver, controller.signal, async () => {
          const response = await service.request(path, { method: 'GET', signal: controller.signal })
          const text = await responseBody(response)
          if (!response.ok) throw new QuizSourceError(response.status, 'SOURCE_READ_FAILED')
          const result = JSON.parse(text)
          if (result.code !== 0 || !result.data || !Number.isSafeInteger(result.data.source_revision)
            || result.data.source_revision < 0
            || (result.data.source !== null && (typeof result.data.source !== 'object' || Array.isArray(result.data.source)))) {
            throw new QuizSourceError(503, 'SOURCE_READ_FAILED')
          }
          return result.data
        })
      }
      if (path === '/learning-goals' && req.method === 'POST') {
        body = await resolveLearningGoal(body, sourceResolver, controller.signal, async requestId => {
          const response = await service.request('/learning-goals/request/' + requestId, { method: 'GET', signal: controller.signal })
          const text = await responseBody(response)
          if (response.status === 404) return undefined
          if (!response.ok) throw new QuizSourceError(response.status, 'GOAL_REQUEST_READ_FAILED')
          const result = JSON.parse(text)
          if (result.code !== 0 || !result.data?.request?.source) throw new QuizSourceError(503, 'GOAL_REQUEST_READ_FAILED')
          return result.data.request
        })
      }
      if (path === '/quiz/generate/from-source') {
        body = await resolveSourceGeneration(body, sourceResolver, controller.signal, async requestId => {
          const response = await service.request('/quiz/source-request/' + requestId, { method: 'GET', signal: controller.signal })
          const text = await responseBody(response)
          if (response.status === 404) return undefined
          if (!response.ok) throw new QuizSourceError(response.status, 'SOURCE_REQUEST_READ_FAILED')
          const result = JSON.parse(text)
          if (result.code !== 0 || !result.data?.request?.source) throw new QuizSourceError(503, 'SOURCE_REQUEST_READ_FAILED')
          return result.data.request
        })
      }
      const response = await service.request(path + url.search, { method: req.method,
        headers: contentType ? { 'content-type': contentType } : undefined,
        body, signal: controller.signal })
      const text = await responseBody(response)
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(text)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof QuizSourceError) send(res, error.status, error.message)
        else if (error instanceof Error && error.message === 'BODY_TOO_LARGE') send(res, 413, 'BODY_TOO_LARGE')
        else send(res, 503, '练习服务不可用，请检查 模型设置、本地数据库和练习 Python 环境后重试')
      }
    } finally { pending.delete(controller); res.off('close', disconnect) }
  } })
  return () => { unregister(); for (const controller of pending) controller.abort(); pending.clear() }
}
