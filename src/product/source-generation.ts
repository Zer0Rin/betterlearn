import { QuizSourceError, resolveQuizSource, type QuizSourceResolver } from './quiz-source.js'

const encode = (value: unknown) => Uint8Array.from(Buffer.from(JSON.stringify(value))).buffer

export async function resolveSourceGeneration(body: ArrayBuffer | undefined,
  resolver: QuizSourceResolver | undefined, signal: AbortSignal,
  lookup: (requestId: string) => Promise<{ source: Record<string, unknown> } | undefined>,
): Promise<ArrayBuffer> {
  const invalid = () => new QuizSourceError(400, 'SOURCE_GENERATION_INPUT_INVALID')
  let value
  try { value = JSON.parse(Buffer.from(body ?? new ArrayBuffer(0)).toString('utf8')) }
  catch { throw invalid() }
  const allowed = ['request_id', 'source', 'user_input', 'question_count', 'difficulty', 'generate_images']
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))
    || typeof value.request_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.request_id)) throw invalid()
  const source = value.source
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).length !== 2
    || typeof source.courseId !== 'string' || !/^course_[a-f0-9]{20}$/.test(source.courseId)
    || typeof source.unitId !== 'string' || !/^unit_[a-f0-9]{20}$/.test(source.unitId)) throw invalid()
  const input = { request_id: value.request_id, user_input: value.user_input === undefined ? '围绕所选知识点出题' : value.user_input,
    question_count: value.question_count === undefined ? 5 : value.question_count,
    difficulty: value.difficulty === undefined ? 'mixed' : value.difficulty,
    generate_images: value.generate_images === undefined ? false : value.generate_images }
  if (typeof input.user_input !== 'string' || [...input.user_input].length < 1 || [...input.user_input].length > 2000
    || !Number.isInteger(input.question_count) || input.question_count < 3 || input.question_count > 10
    || !['easy', 'medium', 'hard', 'mixed'].includes(input.difficulty) || typeof input.generate_images !== 'boolean') throw invalid()
  const stored = await lookup(input.request_id)
  if (stored) {
    if (stored.source.course_id !== source.courseId || stored.source.unit_id !== source.unitId) {
      throw new QuizSourceError(409, 'SOURCE_REQUEST_CONFLICT')
    }
    // Quiz compares the full normalized request digest before returning the task.
    return encode({ ...input, source: stored.source })
  }
  const resolved = await resolveQuizSource(encode({ expected_revision: 0, source }), resolver, signal)
  return encode({ ...input, source: JSON.parse(Buffer.from(resolved).toString()).source })
}
