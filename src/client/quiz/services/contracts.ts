import type { AnswerRecord, KnowledgeDocumentContent, KnowledgeDocumentItem, KnowledgeUploadResponse, LoginResponse, QuizData, QuizDetailResponse, QuizHistoryList, QuizTaskStatus, ReportData, UserProfile } from '../types.js'

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
export interface QuizApi {
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
