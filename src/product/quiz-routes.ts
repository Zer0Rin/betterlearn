import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { authorizeProductRequest } from './request-security.js'
import type { QuizServicePort } from './quiz-service.js'

const PREFIX = '/nobei/quiz/v1'
const JSON_LIMIT = 1024 * 1024
const UPLOAD_LIMIT = 11 * 1024 * 1024
const RESPONSE_LIMIT = 16 * 1024 * 1024
const ID = '[A-Za-z0-9_-]{1,100}'
const routes: Array<[RegExp, readonly string[]]> = [
  [/^\/session$/, ['POST']],
  [/^\/user\/profile$/, ['GET', 'PUT']],
  [/^\/user\/quizzes$/, ['GET']],
  [new RegExp(`^/user/quizzes/${ID}$`), ['GET']],
  [/^\/quiz\/generate\/async$/, ['POST']],
  [new RegExp(`^/quiz/task/${ID}$`), ['GET']],
  [/^\/report\/generate$/, ['POST']],
  [/^\/knowledge\/documents$/, ['GET', 'POST']],
  [new RegExp(`^/knowledge/documents/${ID}$`), ['GET', 'DELETE']],
  [new RegExp(`^/knowledge/documents/${ID}/content$`), ['GET']],
]

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

export function registerQuizRoutes(ctx: Context, service?: QuizServicePort): () => void {
  const pending = new Set<AbortController>()
  const unregister = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: async (req, res) => {
    const trust = authorizeProductRequest(req, req.method !== 'GET', ctx.webServer.port)
    if (!trust.ok) return send(res, trust.status, trust.code)
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname.slice(PREFIX.length)
    const methods = url.pathname.startsWith(PREFIX + '/') ? routes.find(([pattern]) => pattern.test(path))?.[1] : undefined
    const validQuery = path === '/user/quizzes'
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
      const body = await readBody(req, limit)
      if (body && ['GET', 'DELETE'].includes(req.method ?? '')) return send(res, 400, 'BODY_FORBIDDEN')
      if (path === '/session') {
        if (body) return send(res, 400, 'BODY_FORBIDDEN')
        return send(res, 200, 'success', await service.session())
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
        if (error instanceof Error && error.message === 'BODY_TOO_LARGE') send(res, 413, 'BODY_TOO_LARGE')
        else send(res, 503, '练习服务不可用，请检查 quiz.env、MySQL 和练习 Python 环境后重试')
      }
    } finally { pending.delete(controller); res.off('close', disconnect) }
  } })
  return () => { unregister(); for (const controller of pending) controller.abort(); pending.clear() }
}
