import type {ExamApi,ExamPaper,ExamSession,PaperInput,PaperReview} from '../exam-types.js'
import type {AttemptAnswers} from '../types.js'
import type {PracticeStorage} from './practice.js'
export type ExamWrite = {kind:'create';input:PaperInput & {request_id:string}} | {kind:'review';id:string;input:{expected_revision:number;reviews:PaperReview[]}} | {kind:'start';id:string;input:{expected_revision:number;request_id:string}} | {kind:'save'|'submit';id:string;input:AttemptAnswers}
export type ExamWriteResult={kind:'paper';value:ExamPaper}|{kind:'session';value:ExamSession}
interface State {pending?:ExamWrite;result?:ExamWriteResult;busy:boolean;rejected:boolean;error:string}
const key='betterlearn:pending-exam:v1'
export const examDraftKey=(id:string)=>`betterlearn:exam-draft:${id}`
function parse(raw:string|null):ExamWrite|undefined {
 const v=JSON.parse(raw??'null');if(v===null)return undefined
 if(v?.input && ((v.kind==='create'&&typeof v.input.request_id==='string'&&Array.isArray(v.input.allocations)) || (typeof v.id==='string'&&Number.isSafeInteger(v.input.expected_revision)&&((v.kind==='review'&&Array.isArray(v.input.reviews))||(v.kind==='start'&&typeof v.input.request_id==='string')||((v.kind==='save'||v.kind==='submit')&&Array.isArray(v.input.answer_records))))))return v
 throw Error('考试恢复记录无法读取，请放弃旧记录后重新读取。')
}
export class ExamOperations {
 state:State={busy:false,rejected:false,error:''};private listeners=new Set<()=>void>()
 constructor(private api:ExamApi,private storage:PracticeStorage){try{this.state.pending=parse(storage.getItem(key))}catch{this.state.rejected=true;this.state.error='考试恢复记录无法读取，请放弃旧记录后重新读取。'}}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
 private update(p:Partial<State>){this.state={...this.state,...p};this.listeners.forEach(fn=>fn())}
 private persist(v:ExamWrite|null){this.storage.setItem(key,JSON.stringify(v))}
 async run(request:ExamWrite){
  if(this.state.busy||this.state.pending||this.state.rejected)return
  try{
   const previous=parse(this.storage.getItem(key));if(previous){this.update({pending:previous,error:'请先处理上次待确认的考试操作。'});return}
   this.update({pending:structuredClone(request),result:undefined});await this.retry()
  }catch(e){this.update({error:e instanceof Error?e.message:'无法准备请求'})}
 }
 async retry(){
  const p=this.state.pending;if(!p||this.state.busy||this.state.rejected)return
  this.update({busy:true,error:''})
  try{
   const previous=parse(this.storage.getItem(key))
   if(previous&&JSON.stringify(previous)!==JSON.stringify(p)){this.update({rejected:true,error:'另一窗口有新的待确认请求，未覆盖该记录。请放弃当前旧请求并重读。'});return}
   try{this.persist(p)}catch{throw Error('无法保存恢复记录，请保持页面打开，释放浏览器存储空间后重试。')}
   let result:ExamWriteResult
   switch(p.kind){
    case 'create':result={kind:'paper',value:await this.api.createPaper(p.input)};break
    case 'review':result={kind:'paper',value:await this.api.reviewPaper(p.id,p.input)};break
    case 'start':result={kind:'session',value:await this.api.startExam(p.id,p.input)};break
    case 'save':result={kind:'session',value:await this.api.saveExam(p.id,p.input)};break
    case 'submit':result={kind:'session',value:await this.api.submitExam(p.id,p.input)};break
   }
   // Clear only the exact draft used for this write, never a newer tab's edits.
   if(p.kind==='save'||p.kind==='submit'){
    const stored=this.storage.getItem(examDraftKey(p.id))
    if(stored===JSON.stringify(p.input))this.storage.setItem(examDraftKey(p.id),'null')
   }
   this.update({result})
   if(JSON.stringify(parse(this.storage.getItem(key)))===JSON.stringify(p))this.persist(null)
   this.update({pending:undefined})
  }catch(e){
   const status=e && typeof e==='object'&&'status'in e?e.status:undefined
   const rejected=status===400||status===404||status===409||status===422
   this.update({rejected,error:rejected?`操作被拒绝：${e instanceof Error?e.message:'状态已变化'}。请放弃旧请求并重新读取。`:`${e instanceof Error?e.message:'提交结果未知'} 请重试原考试请求，不要重复开考。`})
  }finally{this.update({busy:false})}
 }
 discard(){
  if(this.state.busy||!this.state.rejected)return
  try{
   const raw=this.storage.getItem(key);let previous:ExamWrite|undefined
   try{previous=parse(raw)}catch(e){if(this.state.pending)throw e}
   if(!previous||JSON.stringify(previous)===JSON.stringify(this.state.pending))this.persist(null)
   this.update({pending:undefined,rejected:false,error:''})
  }catch(e){this.update({error:e instanceof Error?e.message:'无法清除记录'})}
 }
}
const sessions=new WeakMap<PracticeStorage,ExamOperations>()
export function getExamOperations(api:ExamApi,storage:PracticeStorage){let value=sessions.get(storage);if(!value){value=new ExamOperations(api,storage);sessions.set(storage,value)}return value}
export function readExamDraft(storage:PracticeStorage,session:ExamSession):{input:AttemptAnswers;conflict:boolean} {
 const fallback={expected_revision:session.revision,answer_records:session.answer_records}
 const raw=storage.getItem(examDraftKey(session.session_id));const value=JSON.parse(raw??'null')
 if(value===null)return{input:fallback,conflict:false}
 if(!Number.isSafeInteger(value.expected_revision)||!Array.isArray(value.answer_records)||value.answer_records.length>100)throw Error('本地草稿无法读取。')
 const seen=new Set<string>()
 for(const record of value.answer_records){
  const question=session.questions.find(q=>q.id===record?.question_id)
  if(!question||seen.has(question.id)||!Array.isArray(record.selected_answers)||record.selected_answers.some((key:unknown)=>!question.options.some(o=>o.key===key))||new Set(record.selected_answers).size!==record.selected_answers.length||(question.type!=='multiple'&&record.selected_answers.length>1)||!Number.isInteger(record.duration_ms)||record.duration_ms<0||record.duration_ms>14400000)throw Error('本地草稿无法读取。')
  seen.add(question.id)
 }
 return{input:value,conflict:value.expected_revision!==session.revision}
}
