import { QuizSourceError, resolveQuizSource, type QuizSourceResolver } from './quiz-source.js'

const encode = (value: unknown) => Uint8Array.from(Buffer.from(JSON.stringify(value))).buffer
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizeDueAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value)
  if (!match || value.startsWith('0000-')) return
  const local = match[1] + 'T' + match[2] + (match[3] ?? '.0').padEnd(4, '0') + 'Z'
  const localTime = Date.parse(local), utcTime = Date.parse(value)
  if (!Number.isFinite(localTime) || !Number.isFinite(utcTime) || new Date(localTime).toISOString() !== local) return
  const normalized = new Date(utcTime).toISOString()
  if (normalized.length !== 24 || normalized.startsWith('0000-')) return
  return normalized
}

/** Freeze a real Core unit; accepted goal requests reuse their original source. */
export async function resolveLearningGoal(body: ArrayBuffer | undefined,
  resolver: QuizSourceResolver | undefined, signal: AbortSignal,
  lookup: (requestId: string) => Promise<{ source: Record<string, unknown> } | undefined>,
): Promise<ArrayBuffer> {
  const invalid = () => new QuizSourceError(400, 'GOAL_INPUT_INVALID')
  let value
  try { value = JSON.parse(Buffer.from(body ?? new ArrayBuffer(0)).toString('utf8')) }
  catch { throw invalid() }
  const allowed = ['request_id', 'title', 'source', 'target_percent', 'min_distinct_questions', 'due_at']
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))
    || typeof value.request_id !== 'string' || !UUID.test(value.request_id)
    || typeof value.title !== 'string') throw invalid()
  const source = value.source
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).length !== 2
    || typeof source.courseId !== 'string' || !/^course_[0-9a-f]{20}$/.test(source.courseId)
    || typeof source.unitId !== 'string' || !/^unit_[0-9a-f]{20}$/.test(source.unitId)) throw invalid()
  const title = value.title.trim(), due_at = normalizeDueAt(value.due_at)
  const target_percent = value.target_percent === undefined ? 90 : value.target_percent
  const min_distinct_questions = value.min_distinct_questions === undefined ? 5 : value.min_distinct_questions
  if (!title || [...title].length > 120 || !due_at
    || !Number.isInteger(target_percent) || target_percent < 1 || target_percent > 100
    || !Number.isInteger(min_distinct_questions) || min_distinct_questions < 3 || min_distinct_questions > 100) throw invalid()
  const input = { request_id: value.request_id.toLowerCase(), title, due_at, target_percent, min_distinct_questions }
  const stored = await lookup(input.request_id)
  if (stored) {
    if (stored.source.course_id !== source.courseId || stored.source.unit_id !== source.unitId) {
      throw new QuizSourceError(409, 'GOAL_REQUEST_CONFLICT')
    }
    // Final digest/owner comparison and future-deadline validation belong to Quiz.
    return encode({ ...input, source: stored.source })
  }
  const resolved = await resolveQuizSource(encode({ expected_revision: 0, source }), resolver, signal)
  return encode({ ...input, source: JSON.parse(Buffer.from(resolved).toString()).source })
}

export function validLearningGoalQuery(path: string, params: URLSearchParams, method: string | undefined): boolean {
  if (path !== '/learning-goals' || method !== 'GET') return params.size === 0
  const seen = new Set<string>()
  for (const [key, value] of params) {
    if (seen.has(key)) return false
    seen.add(key)
    if (key === 'status') {
      if (!['active', 'archived', 'all'].includes(value)) return false
    } else if (key === 'page' || key === 'page_size') {
      if (!/^[1-9][0-9]{0,6}$/.test(value) || Number(value) > (key === 'page' ? 1000000 : 50)) return false
    } else return false
  }
  return true
}
