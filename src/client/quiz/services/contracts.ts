import type { KnowledgeStatsApi } from '../knowledge-stats-types.js'
import type { SourceApi } from '../source-types.js'
import type { ExamApi } from '../exam-types.js'
import type { GoalApi } from '../goal-types.js'
import type { BankCategory, BankEntry, BankHistoryItem, BankPage, BankQuery, BankStats } from '../bank-types.js'
import type { AttemptAnswers, AttemptSummary, PracticeAttempt, AnswerRecord, KnowledgeDocumentContent, KnowledgeDocumentItem, KnowledgeUploadResponse, LoginResponse, QuizData, QuizDetailResponse, QuizHistoryList, QuizTaskStatus, ReportData, UserProfile } from '../types.js'

/** Host-provided sources keep identity and evidence metadata outside presentation components. */
export type KnowledgeSource =
  | { kind: 'topic'; text: string }
  | { kind: 'document'; docId: string; title: string; text?: string }
  | { kind: 'external'; provider: string; sourceId: string; title: string; text: string; metadata?: Record<string, unknown> }
export interface GenerateInput {
  source: KnowledgeSource
  questionCount: number
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed'
  generateImages: boolean
}
export interface ReportInput { quiz_id: string; topic: string; questions: QuizData['questions']; answer_records: AnswerRecord[] }
export interface QuizApi extends GoalApi, ExamApi, SourceApi, KnowledgeStatsApi {
  getBankEntries(query?: BankQuery, signal?: AbortSignal): Promise<BankPage<BankEntry>>
  getBankEntry(id: number): Promise<BankEntry>
  getBankHistory(id: number, page?: number): Promise<BankPage<BankHistoryItem>>
  getBankStats(): Promise<BankStats>
  getBankCategories(): Promise<{ items: BankCategory[] }>
  setBankBookmark(id: number, bookmarked: boolean): Promise<{ id: number; bookmarked: boolean }>
  createBankCategory(name: string): Promise<{ id: number; name: string }>
  renameBankCategory(id: number, name: string): Promise<{ id: number; name: string }>
  deleteBankCategory(id: number): Promise<{ id: number }>
  setBankCategory(entryId: number, categoryId: number, linked: boolean): Promise<{ entry_id: number; category_id: number; linked: boolean }>
  createAttempt(quizId: string, requestId: string): Promise<PracticeAttempt>
  listAttempts(quizId: string): Promise<{ items: AttemptSummary[] }>
  getAttempt(attemptId: string): Promise<PracticeAttempt>
  saveAttempt(attemptId: string, input: AttemptAnswers): Promise<PracticeAttempt>
  submitAttempt(attemptId: string, input: AttemptAnswers): Promise<PracticeAttempt>
  generateAttemptReport(attemptId: string): Promise<ReportData>
  connect(): Promise<LoginResponse>
  generateQuiz(input: GenerateInput): Promise<{ task_id: string }>
  getTask(id: string, signal?: AbortSignal): Promise<QuizTaskStatus>
  generateReport(input: ReportInput): Promise<ReportData>
  getProfile(): Promise<UserProfile>
  updateProfile(input: { nickname?: string; avatar_url?: string }): Promise<null>
  getHistory(page?: number): Promise<QuizHistoryList>
  getDetail(id: string): Promise<QuizDetailResponse>
  getDocuments(signal?: AbortSignal): Promise<{ items: KnowledgeDocumentItem[] }>
  getDocumentContent(id: string, signal?: AbortSignal): Promise<KnowledgeDocumentContent>
  uploadDocument(file: File): Promise<KnowledgeUploadResponse>
  deleteDocument(id: string): Promise<null>
}
