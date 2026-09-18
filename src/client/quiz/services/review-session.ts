import type {ReviewApi,ReviewItem,LearningReviewParams,LearningReviewResult} from './review-api.js'
import type {PracticeStorage} from './practice.js'
interface PendingReview {item:ReviewItem;request:LearningReviewParams}
interface ReviewState {pending?:PendingReview;result?:LearningReviewResult;resultItem?:ReviewItem;busy:boolean;conflict:boolean;error:string}
const key='betterlearn:core:pending-review'
const keyForRequest=()=>`idem_${Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>b.toString(16).padStart(2,'0')).join('')}`
function readPending(storage:PracticeStorage):PendingReview|undefined {
  return parsePending(storage.getItem(key))
}
function parsePending(raw:string|null):PendingReview|undefined {
  const value=JSON.parse(raw??'null')
  if(value===null)return undefined
  if(!value?.item?.assessment?.options || typeof value?.request?.idempotencyKey!=='string' || typeof value.request.optionId!=='string' || value.item.unitId!==value.request.unitId || value.item.assessment.assessmentId!==value.request.assessmentId)throw Error('本地复习恢复记录无法读取。请保留页面并检查浏览器存储。')
  return value as PendingReview
}
export class ReviewSession {
  state:ReviewState={busy:false,conflict:false,error:''}
  private listeners=new Set<()=>void>()
  constructor(private api:ReviewApi,private storage:PracticeStorage){
    try{this.state.pending=readPending(storage)}catch(e){this.state.error=e instanceof Error?e.message:'本地恢复记录无法读取';this.state.conflict=true}
  }
  subscribe=(callback:()=>void)=>{this.listeners.add(callback);return()=>{this.listeners.delete(callback)}}
  private update(patch:Partial<ReviewState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener()}
  private persist(value:PendingReview|null){try{this.storage.setItem(key,JSON.stringify(value))}catch{throw Error('无法保存复习恢复记录，请释放浏览器存储空间后重试。')}}
  async submit(item:ReviewItem,optionId:string){
    if(this.state.busy||this.state.pending||this.state.conflict||!item.assessment.options.some(o=>o.optionId===optionId))return
    try{
      const existing=readPending(this.storage)
      if(existing){this.update({pending:existing,error:'发现一笔待确认的复习，请先处理原请求。'});return}
      const request:LearningReviewParams={unitId:item.unitId,assessmentId:item.assessment.assessmentId,optionId,expectedAttemptId:item.expectedAttemptId,idempotencyKey:keyForRequest()}
      this.update({pending:{item:structuredClone(item),request},result:undefined})
      await this.retry()
    }catch(e){this.update({error:e instanceof Error?e.message:'无法准备复习请求'})}
  }
  async retry(){
    const pending=this.state.pending
    if(this.state.busy||this.state.conflict||!pending)return
    this.update({busy:true,error:''})
    try{
      const other=readPending(this.storage)
      if(other && other.request.idempotencyKey!==pending.request.idempotencyKey){
        this.update({conflict:true,error:'另一窗口有新的待提交复习，未覆盖该记录。请放弃当前旧请求后重新读取队列。'})
        return
      }
      this.persist(pending)
      const result=await this.api.submit(pending.request)
      this.update({result,resultItem:pending.item})
      // Do not clear another window's different request.
      const stored=readPending(this.storage)
      if(stored?.request.idempotencyKey===pending.request.idempotencyKey)this.persist(null)
      this.update({pending:undefined})
    }catch(e){
      const status=typeof e==='object'&&e!==null&&'status' in e ? e.status : undefined
      const conflict=status===409||status===400||status===404||status===422
      this.update({conflict,error:conflict?'本次复习已不可提交，可能已在另一处完成或课程状态已变化。请重新读取队列。':`${e instanceof Error?e.message:'提交结果暂未确认'} 答案与请求编号已保留，请重试原请求。`})
    }finally{this.update({busy:false})}
  }
  discardConflict(){
    if(this.state.busy||!this.state.conflict)return
    try{
      const raw=this.storage.getItem(key)
      let stored:PendingReview|undefined
      try{stored=parsePending(raw)}catch(e){
        // Explicitly discard unreadable data only when there is no recoverable
        // in-memory request. Storage access failures still leave it untouched.
        if(this.state.pending)throw e
      }
      if(!stored||stored.request.idempotencyKey===this.state.pending?.request.idempotencyKey)this.persist(null)
      this.update({pending:undefined,conflict:false,error:''})
    }catch(e){this.update({error:e instanceof Error?e.message:'无法清除待提交记录'})}
  }
  clearResult(){if(!this.state.busy&&!this.state.pending)this.update({result:undefined,error:''})}
}
const sessions=new WeakMap<PracticeStorage,ReviewSession>()
export function getReviewSession(api:ReviewApi,storage:PracticeStorage){let session=sessions.get(storage);if(!session){session=new ReviewSession(api,storage);sessions.set(storage,session)}return session}
