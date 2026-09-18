import type {ExamSource} from './exam-types.js'
import type {BankPage} from './bank-types.js'
export interface KnowledgeVersion {knowledge_point_id:string;content_version:string}
export interface KnowledgeStats {
 source:ExamSource
 answer_count:number;correct_count:number;accuracy:number
 distinct_question_count:number;repeated_answer_count:number
 first_correct_count:number;first_accuracy:number;latest_correct_count:number;latest_accuracy:number
 entry_count:number;attempt_count:number;first_answered_at:string;last_answered_at:string
}
export interface KnowledgeAnswer {
 entry_id:number;quiz_id:string;question_id:string;attempt_id:string;submitted_at:string
 source:ExamSource;source_revision:number;question_content_key:string
 selected_answers:string[];is_correct:boolean;duration_ms:number
}
export interface KnowledgeStatsApi {
 getKnowledgeStats(query?:Partial<KnowledgeVersion>&{page?:number},signal?:AbortSignal):Promise<BankPage<KnowledgeStats>>
 getKnowledgeHistory(query:KnowledgeVersion&{page?:number},signal?:AbortSignal):Promise<BankPage<KnowledgeAnswer>>
}
