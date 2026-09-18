export interface GoalCreate {
  request_id: string
  title: string
  source: {courseId:string;unitId:string}
  target_percent: number
  min_distinct_questions: number
  due_at: string
}
export interface GoalSummary {
  goal_id:string;request_id:string;title:string;target_percent:number;min_distinct_questions:number
  due_at:string;policy_version:string;revision:number;created_at:string;archived:boolean
  source:{course_id:string;unit_id:string;knowledge_point_id:string;content_version:string;title:string;statement:string;type:string}
}
export interface GoalProgress {
  evaluated_at:string;evidence_cutoff_at:string;deadline_passed:boolean;criteria_met:boolean;remaining_distinct_questions:number
  answer_count:number;distinct_question_count:number;repeated_answer_count:number
  first_accuracy:number|null;latest_accuracy:number|null;evidence_score:number|null
  window_count:number;window_limit:number;small_sample_cap:number|null;evidence_state:string
  basis:{question_content_key:string;entry_id:number;attempt_id:string;is_correct:boolean;submitted_at:string}[]
}
export interface GoalDetail extends GoalSummary {progress:GoalProgress}
export type GoalStatus='active'|'archived'|'all'
export interface GoalApi {
  listGoals(status?:GoalStatus,page?:number,signal?:AbortSignal):Promise<{items:GoalSummary[];total:number;page:number;page_size:number}>
  getGoal(id:string,signal?:AbortSignal):Promise<GoalDetail>
  createGoal(input:GoalCreate):Promise<GoalSummary>
  archiveGoal(id:string,input:{expected_revision:number;archived:boolean}):Promise<GoalSummary>
}
