import type {SourceApi,SourceGeneration,SourceSelection} from '../source-types.js'
import type {PracticeStorage} from './practice.js'
export type SourceWrite={kind:'bind';id:number;input:{expected_revision:number;source:SourceSelection|null}}|{kind:'generate';input:SourceGeneration;taskId?:string}
interface State {pending?:SourceWrite;busy:boolean;rejected:boolean;error:string;completed:number}
function parse(raw:string|null):SourceWrite|undefined {
 const v=JSON.parse(raw??'null');if(v===null)return undefined
 const source=v?.input?.source
 const selected=source&&typeof source.courseId==='string'&&typeof source.unitId==='string'
 if(v?.kind==='bind'&&Number.isSafeInteger(v.id)&&Number.isSafeInteger(v.input?.expected_revision)&&(source===null||selected))return v
 if(v?.kind==='generate'&&selected&&typeof v.input.request_id==='string'&&typeof v.input.user_input==='string'&&Number.isInteger(v.input.question_count)&&['easy','medium','hard','mixed'].includes(v.input.difficulty)&&typeof v.input.generate_images==='boolean'&&(v.taskId===undefined||typeof v.taskId==='string'))return v
 throw Error('来源操作恢复记录无法读取。请清除损坏记录后核对题库与练习历史。')
}
export class SourceOperations {
 state:State={busy:false,rejected:false,error:'',completed:0};private listeners=new Set<()=>void>();private raw:string|null
 constructor(private api:SourceApi,private storage:PracticeStorage,private key:string){
  this.raw=null
  try{this.raw=storage.getItem(key);this.state.pending=parse(this.raw)}catch(e){this.state.rejected=true;this.state.error=String(e)}
 }
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
 private update(p:Partial<State>){this.state={...this.state,...p};this.listeners.forEach(fn=>fn())}
 private persist(value:SourceWrite|null){
  if(this.storage.getItem(this.key)!==this.raw)throw Error('另一窗口更新了恢复记录，请刷新页面后重新核对。')
  const raw=JSON.stringify(value);this.storage.setItem(this.key,raw);this.raw=raw
 }
 async run(p:SourceWrite){
  if(this.state.busy||this.state.pending||this.state.rejected)return
  try{this.persist(p);this.update({pending:structuredClone(p)});await this.retry()}catch(e){this.update({error:String(e)})}
 }
 async retry(){
  const p=this.state.pending;if(!p||this.state.busy||this.state.rejected||(p.kind==='generate'&&p.taskId))return
  this.update({busy:true,error:''})
  try{
   this.persist(p)
   if(p.kind==='bind'){
    await this.api.setBankSource(p.id,p.input);this.persist(null);this.update({pending:undefined,completed:this.state.completed+1})
   }else{
    const result=await this.api.generateFromSource(p.input);const next={...p,taskId:result.task_id};this.persist(next);this.update({pending:next})
   }
  }catch(e){
   const status=e&&typeof e==='object'&&'status'in e?e.status:undefined
   const rejected=[400,404,409,422].includes(status as number)
   this.update({rejected,error:`${e instanceof Error?e.message:'操作未确认'}。${rejected?'请清除旧请求并重新读取。':'请重试原请求，不要重复操作。'}`})
  }finally{this.update({busy:false})}
 }
 clearFinished(){
  if(this.state.busy||(!this.state.rejected&&!(this.state.pending?.kind==='generate'&&this.state.pending.taskId)))return
  try{this.persist(null);this.update({pending:undefined,rejected:false,error:''})}catch(e){this.update({error:String(e)})}
}
}
const stores=new WeakMap<PracticeStorage,Map<string,SourceOperations>>()
export function getSourceOperations(api:SourceApi,storage:PracticeStorage,id?:number){
 let sessions=stores.get(storage);if(!sessions){sessions=new Map();stores.set(storage,sessions)}
 const key=id===undefined?'betterlearn:source-generation:v1':`betterlearn:source-binding:${id}:v1`
 let session=sessions.get(key);if(!session){session=new SourceOperations(api,storage,key);sessions.set(key,session)}return session
}
