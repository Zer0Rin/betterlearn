import type {Question,AnswerRecord,AttemptAnswers} from './types.js'
import type {GoalSummary} from './goal-types.js'
export type ExamSource=GoalSummary['source']
export interface Allocation {knowledge_point_id:string;content_version:string;count:number}
export interface PaperInput {title:string;duration_seconds:number;allocations:Allocation[]}
export interface PaperItem {question:Question;entry_id:number;allocation_index:number;source_revision:number;source:ExamSource}
export interface PaperPreview {ready:boolean;total_questions:number;coverage:(Allocation & {selected:number;missing:number;available_distinct:number;invalid_count:number})[];items:PaperItem[]}
export interface PaperReview {question_id:string;approved:boolean;note:string}
export interface ExamPaper extends PaperInput {paper_id:string;revision:number;status:'draft'|'approved';created_at:string;items:PaperItem[];reviews:PaperReview[]}
export interface PaperSummary {paper_id:string;title:string;duration_seconds:number;revision:number;approved:number;created_at:string}
export interface ExamResult {attempt_id:string;quiz_id:string;xp_gain:number;total_questions:number;correct_count:number;accuracy:number;reason:'submitted'|'timeout';submitted_at:string;finalized_at:string;unanswered_count:number;by_source:(Allocation & {correct_count:number;accuracy:number})[];answer_records:AnswerRecord[];questions:Question[]}
export interface ExamSummary {session_id:string;paper_id:string;title:string;paper_revision:number;revision:number;status:'running'|'expired'|'submitted';started_at:string;deadline_at:string;accuracy:number|null}
export interface ExamSession extends Omit<ExamSummary,'accuracy'> {questions:Pick<Question,'id'|'type'|'stem'|'options'|'image_url'>[];answer_records:AttemptAnswers['answer_records'];result:ExamResult|null}
export interface ExamPage<T> {items:T[];total:number;page:number;page_size:number}
export interface ExamApi {
 previewPaper(input:PaperInput):Promise<PaperPreview>
 createPaper(input:PaperInput & {request_id:string}):Promise<ExamPaper>
 listPapers(page?:number):Promise<ExamPage<PaperSummary>>
 getPaper(id:string):Promise<ExamPaper>
 reviewPaper(id:string,input:{expected_revision:number;reviews:PaperReview[]}):Promise<ExamPaper>
 startExam(id:string,input:{request_id:string;expected_revision:number}):Promise<ExamSession>
 listExams(page?:number):Promise<ExamPage<ExamSummary>>
 getExam(id:string):Promise<ExamSession>
 saveExam(id:string,input:AttemptAnswers):Promise<ExamSession>
 submitExam(id:string,input:AttemptAnswers):Promise<ExamSession>
}
