import type { ExamSource } from './exam-types.js'
import type { Question } from './types.js'
export type BankScope = 'all' | 'wrong' | 'ever_wrong' | 'bookmarked' | 'uncategorized'
export interface BankQuery { page?: number; page_size?: number; scope?: BankScope; category_id?: number; quiz_id?: string; search?: string; sort?: 'recent' | 'oldest' }
export interface BankPage<T> { items: T[]; total: number; page: number; page_size: number }
export interface BankCategory { id: number; name: string; entry_count: number }
export interface BankEntry {
  id: number; quiz_id: string; question_id: string; question_hash: string; title: string; question: Question
  source?: ExamSource | null; source_revision?: number
  bookmarked: boolean; is_correct: boolean | null; latest_attempt_id: string | null
  attempt_count: number; wrong_count: number; created_at: string; last_answered_at: string | null
  categories: Pick<BankCategory, 'id' | 'name'>[]
}
export interface BankHistoryItem { attempt_id: string; submitted_at: string; selected_answers: string[]; is_correct: boolean; duration_ms: number }
export interface BankStats { total: number; wrong: number; ever_wrong: number; bookmarked: number; uncategorized: number }
