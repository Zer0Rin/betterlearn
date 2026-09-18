import type {GoalApi,GoalCreate,GoalSummary} from '../goal-types.js'
import type {PracticeStorage} from './practice.js'
type PendingGoal = {kind:'create';input:GoalCreate} | {kind:'archive';id:string;title:string;input:{expected_revision:number;archived:boolean}}
interface State {pending?:PendingGoal;result?:GoalSummary;busy:boolean;rejected:boolean;error:string}
const key='betterlearn:pending-goal:v1'
function parse(raw:string|null):PendingGoal|undefined {
  const value=JSON.parse(raw??'null')
  if(value===null)return undefined
  if(value?.kind==='create' && typeof value.input?.request_id==='string' && typeof value.input.title==='string' && typeof value.input.source?.courseId==='string' && typeof value.input.source?.unitId==='string' && typeof value.input.due_at==='string' && Number.isInteger(value.input.target_percent) && Number.isInteger(value.input.min_distinct_questions))return value
  if(value?.kind==='archive' && typeof value.id==='string' && typeof value.title==='string' && Number.isSafeInteger(value.input?.expected_revision) && typeof value.input.archived==='boolean')return value
  throw Error('目标恢复记录无法读取，请放弃旧记录后重新读取目标。')
}
export class GoalSession {
  state:State={busy:false,rejected:false,error:''}
  private listeners=new Set<()=>void>()
  constructor(private api:GoalApi,private storage:PracticeStorage){try{this.state.pending=parse(storage.getItem(key))}catch{this.state.rejected=true;this.state.error='目标恢复记录无法读取，请放弃旧记录后重新读取目标。'}}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  private update(patch:Partial<State>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn())}
  private save(pending:PendingGoal|null){try{this.storage.setItem(key,JSON.stringify(pending))}catch{throw Error('无法保存恢复记录；请保持页面打开，释放浏览器存储空间后重试。')}}
  private async start(pending:PendingGoal){
    if(this.state.busy||this.state.pending||this.state.rejected)return
    try{
      const existing=parse(this.storage.getItem(key))
      if(existing){this.update({pending:existing,error:'已有待确认操作，请先处理原请求。'});return}
      this.update({pending:structuredClone(pending),result:undefined});await this.retry()
    }catch(e){this.update({error:e instanceof Error?e.message:'无法准备目标操作'})}
  }
  create(input:Omit<GoalCreate,'request_id'>){return this.start({kind:'create',input:{...input,request_id:crypto.randomUUID()}})}
  archive(goal:Pick<GoalSummary,'goal_id'|'revision'|'title'>,archived:boolean){return this.start({kind:'archive',id:goal.goal_id,title:goal.title,input:{expected_revision:goal.revision,archived}})}
  async retry(){
    const pending=this.state.pending
    if(!pending||this.state.busy||this.state.rejected)return
    this.update({busy:true,error:''})
    try{
      const existing=parse(this.storage.getItem(key))
      if(existing && JSON.stringify(existing)!==JSON.stringify(pending)){this.update({rejected:true,error:'另一窗口保存了新的操作；未覆盖该记录，请放弃当前旧请求后重新读取。'});return}
      this.save(pending)
      const result=pending.kind==='create'?await this.api.createGoal(pending.input):await this.api.archiveGoal(pending.id,pending.input)
      this.update({result})
      if(JSON.stringify(parse(this.storage.getItem(key)))===JSON.stringify(pending))this.save(null)
      this.update({pending:undefined})
    }catch(e){
      const status=e && typeof e==='object' && 'status' in e?e.status:undefined
      const rejected=status===400||status===404||status===409||status===422
      this.update({rejected,error:rejected?'操作未被接受，来源或目标状态可能已变化。请放弃旧请求后重新读取。':`${e instanceof Error?e.message:'操作结果未确认'} 请重试原请求，勿重复创建。`})
    }finally{this.update({busy:false})}
  }
  discard(){
    if(this.state.busy||!this.state.rejected)return
    try{
      const raw=this.storage.getItem(key);let stored:PendingGoal|undefined
      try{stored=parse(raw)}catch(e){if(this.state.pending)throw e}
      if(!stored||JSON.stringify(stored)===JSON.stringify(this.state.pending))this.save(null)
      this.update({pending:undefined,rejected:false,error:''})
    }catch(e){this.update({error:e instanceof Error?e.message:'无法清除旧请求'})}
  }
}
const sessions=new WeakMap<PracticeStorage,GoalSession>()
export function getGoalSession(api:GoalApi,storage:PracticeStorage){let session=sessions.get(storage);if(!session){session=new GoalSession(api,storage);sessions.set(storage,session)}return session}
