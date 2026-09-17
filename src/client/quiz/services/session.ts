import type { AnswerRecord, QuizData, ReportData } from '../types.js'
export interface PracticeSession {
  quiz?: QuizData; records: AnswerRecord[]; index: number; report?: ReportData
  taskId?: string; taskStartedAt?: number
}
export const emptySession = (): PracticeSession => ({ records: [], index: 0 })
export function readSession(storage: Pick<Storage, 'getItem'>): PracticeSession {
  try {
    const data = JSON.parse(storage.getItem('betterlearn:quiz:practice') ?? 'null')
    if (!data || !Array.isArray(data.records) || !Number.isInteger(data.index) || data.index < 0) return emptySession()
    if (data.quiz && (!Array.isArray(data.quiz.questions) || !data.quiz.questions.length || data.index >= data.quiz.questions.length)) return emptySession()
    return data
  } catch { return emptySession() }
}
export function saveSession(storage: Pick<Storage, 'setItem'>, data: PracticeSession) { storage.setItem('betterlearn:quiz:practice', JSON.stringify(data)) }
