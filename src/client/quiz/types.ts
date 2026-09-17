export interface QuestionOption {
  key: string
  text: string
}

export interface Question {
  id: string
  type: 'single' | 'multiple' | 'judge'
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
  knowledge_point: string
  difficulty: 'easy' | 'medium' | 'hard'
  image_url?: string | null
}

export interface QuizData {
  quiz_id: string
  title: string
  summary: string
  questions: Question[]
  image_notice?: string | null
}

export interface QuizTaskStatus {
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result: QuizData | null
  error_message: string | null
}

export interface AnswerRecord {
  question_id: string
  selected_answers: string[]
  is_correct: boolean
  duration_ms: number
}

export interface ReportData {
  accuracy: number
  mastered_points: string[]
  weak_points: string[]
  three_line_summary: string[]
  advice: string[]
  share_quote: string
}

export interface UserBrief {
  id: number
  nickname: string
  avatar_url: string
  total_xp: number
}

export interface LoginResponse {
  user: UserBrief
}

export interface UserProfile {
  id: number
  nickname: string
  avatar_url: string
  total_xp: number
  quiz_count: number
  correct_count: number
  average_accuracy: number
}

export interface QuizHistoryItem {
  quiz_id: string
  title: string
  accuracy: number
  question_count: number
  created_at: string
}

export interface QuizHistoryList {
  items: QuizHistoryItem[]
  total: number
  page: number
  page_size: number
}

export interface QuizDetailResponse {
  quiz_id: string
  title: string
  summary: string
  user_input?: string
  questions: Question[]
  answer_records?: AnswerRecord[]
  report?: ReportData
  created_at: string
}

/* ---- 知识库类型定义 ---- */

export type KnowledgeDocumentStatusEnum = 'processing' | 'ready' | 'failed'

export interface KnowledgeUploadResponse {
  doc_id: string
  file_name: string
  status: KnowledgeDocumentStatusEnum
}

export interface KnowledgeDocumentItem {
  doc_id: string
  file_name: string
  file_type: string
  file_size: number
  status: KnowledgeDocumentStatusEnum
  chunk_count: number
  error_message: string | null
  created_at: string
}

export interface KnowledgeListResponse {
  items: KnowledgeDocumentItem[]
}

export interface KnowledgeDocumentStatus {
  doc_id: string
  file_name: string
  status: KnowledgeDocumentStatusEnum
  chunk_count: number
  error_message: string | null
}

/** 文档的连续正文。text 与上传原件逐字一致，字符偏移量可被外部工具定位。 */
export interface KnowledgeDocumentContent {
  doc_id: string
  file_name: string
  file_type: string
  media_type: 'text/plain' | 'text/markdown'
  text: string
  character_count: number
  byte_size: number
}
