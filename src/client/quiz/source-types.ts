import type {ExamSource} from './exam-types.js'
export interface SourceSelection {courseId:string;unitId:string}
export interface SourceMapping {source:ExamSource|null;source_revision:number}
export interface SourceGeneration {request_id:string;source:SourceSelection;user_input:string;question_count:number;difficulty:'easy'|'medium'|'hard'|'mixed';generate_images:boolean}
export interface SourceApi {
 getBankSource(id:number):Promise<SourceMapping>
 setBankSource(id:number,input:{expected_revision:number;source:SourceSelection|null}):Promise<SourceMapping>
 generateFromSource(input:SourceGeneration):Promise<{task_id:string}>
}
