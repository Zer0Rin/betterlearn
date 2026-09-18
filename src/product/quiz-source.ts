import { createHash } from 'node:crypto'
import { CoreRpcError } from './core-rpc-client.js'
import type { ProductOperations } from './routes.js'

export type QuizSourceResolver = Pick<ProductOperations, 'getLearningCourse'>
export class QuizSourceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k))
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  }
  return JSON.stringify(value)
}

/** Public input selects a frozen Core unit; only Host builds the private snapshot. */
export async function resolveQuizSource(
  body: ArrayBuffer | undefined, resolver: QuizSourceResolver | undefined, signal: AbortSignal,
  getCurrentSource?: () => Promise<{ source_revision: number; source: Record<string, unknown> | null }>,
): Promise<ArrayBuffer> {
  const invalid = () => new QuizSourceError(400, 'SOURCE_INPUT_INVALID')
  let input: unknown
  try { input = JSON.parse(Buffer.from(body ?? new ArrayBuffer(0)).toString('utf8')) }
  catch { throw invalid() }
  if (!exact(input, ['expected_revision', 'source'])
    || typeof input.expected_revision !== 'number' || !Number.isSafeInteger(input.expected_revision)
    || input.expected_revision < 0 || input.expected_revision >= Number.MAX_SAFE_INTEGER) throw invalid()
  const selection = input.source
  if (selection !== null && (!exact(selection, ['courseId', 'unitId'])
    || typeof selection.courseId !== 'string' || !/^course_[a-f0-9]{20}$/.test(selection.courseId)
    || typeof selection.unitId !== 'string' || !/^unit_[a-f0-9]{20}$/.test(selection.unitId))) throw invalid()
  const encode = (source: unknown) => Uint8Array.from(Buffer.from(JSON.stringify({
    expected_revision: input.expected_revision, source,
  }))).buffer
  let source: unknown = null
  if (selection !== null) {
    const { courseId, unitId } = selection as { courseId: string; unitId: string }
    const current = await getCurrentSource?.()
    if (current?.source_revision === input.expected_revision + 1
      && current.source?.course_id === courseId && current.source?.unit_id === unitId) {
      // Send the frozen snapshot back through Quiz's ownership and CAS checks;
      // a concurrent edit after this read must still reject the replay.
      return encode(current.source)
    }
    if (current && current.source_revision !== input.expected_revision) {
      throw new QuizSourceError(409, 'SOURCE_REVISION_CONFLICT')
    }
    if (!resolver) throw new QuizSourceError(503, 'CORE_UNAVAILABLE')
    let course
    try { course = await resolver.getLearningCourse(courseId, signal) }
    catch (error) {
      if (error instanceof CoreRpcError && error.code === 'LEARNING_COURSE_NOT_FOUND') {
        throw new QuizSourceError(404, 'SOURCE_NOT_FOUND')
      }
      throw error
    }
    if (course.courseId !== courseId) throw new QuizSourceError(503, 'CORE_SOURCE_INVALID')
    if (course.status !== 'active') throw new QuizSourceError(409, 'SOURCE_COURSE_INACTIVE')
    const unit = course.units.find(item => item.unitId === unitId)
    if (!unit) throw new QuizSourceError(404, 'SOURCE_NOT_FOUND')
    const content = { knowledge_point_id: unit.knowledgePointId, type: unit.type, title: unit.title,
      statement: unit.lesson.explanation, evidence: unit.evidence }
    source = { schema_version: 1, course_id: courseId, unit_id: unitId, ...content,
      content_version: createHash('sha256').update(canonical(content), 'utf8').digest('hex') }
  }
  return encode(source)
}
