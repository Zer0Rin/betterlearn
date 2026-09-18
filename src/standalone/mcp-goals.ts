import { resolveLearningGoal } from '../product/learning-goal.js'
import type { LearningCourseSnapshot } from '../product/types.js'
import { McpOperationError } from './mcp-errors.js'

interface GoalPorts {
 request(path:string, init?:RequestInit):Promise<Response>
 learningCourse?(courseId:string, signal?:AbortSignal):Promise<LearningCourseSnapshot>
}

/** Local goal operations: backend UUID/CAS rules, never the provider journal. */
export function createMcpGoalOperations(ports:GoalPorts) {
 async function request(path:string,init?:RequestInit):Promise<any> {
  const writes=init?.method==='POST'||init?.method==='PUT'
  const uncertain=()=>new McpOperationError(writes
   ?'GOAL_RESULT_UNKNOWN: 结果未确认，请读取目标核对；若重试只复用原编号、修订号和参数，勿自动更换'
   :'GOAL_READ_FAILED')
  let response
  try{response=await ports.request(path,init)}catch{throw uncertain()}
  if(!response.ok){
   await response.body?.cancel().catch(()=>{})
   if(response.status===409)throw new McpOperationError('GOAL_CONFLICT: 请重新读取目标；勿自动换请求编号或增加修订号')
   if(response.status===404)throw new McpOperationError('GOAL_NOT_FOUND')
   if(response.status>=400&&response.status<500&&response.status!==408){
    throw new McpOperationError(`GOAL_REQUEST_REJECTED (${response.status}): 请检查目标与参数`)
   }
   throw uncertain()
  }
  let body
  try{body=await response.json()}catch{throw uncertain()}
  if(body?.code!==0||body.data===undefined||body.data===null
   ||(writes&&(typeof body.data.goal_id!=='string'||!/^goal_[0-9a-f]{32}$/.test(body.data.goal_id))))throw uncertain()
  return body.data
 }
 async function create(args:any){
  const {course_id,unit_id,...conditions}=args
  const publicBody=Uint8Array.from(Buffer.from(JSON.stringify({...conditions,source:{courseId:course_id,unitId:unit_id}}))).buffer
  let resolved:ArrayBuffer
  try{
   resolved=await resolveLearningGoal(publicBody,ports.learningCourse?{getLearningCourse:ports.learningCourse}:undefined,
    new AbortController().signal,async id=>{
     const response=await ports.request('/learning-goals/request/'+id,{method:'GET'})
     if(response.status===404){await response.body?.cancel();return undefined}
     if(!response.ok){await response.body?.cancel();throw new Error()}
     const result=await response.json()
     if(result.code!==0||!result.data?.request?.source)throw new Error()
     return result.data.request
    })
  }catch{throw new McpOperationError('GOAL_PREPARATION_FAILED: 未发送创建请求，请检查来源、期限和请求编号；勿自动换编号')}
  return request('/learning-goals',{method:'POST',headers:{'content-type':'application/json'},body:Buffer.from(resolved).toString('utf8')})
 }
 return {
  list:(args:any)=>request('/learning-goals?'+new URLSearchParams({page:String(args.page),page_size:String(args.page_size),status:args.status})),
  read:(args:any)=>request('/learning-goals/'+args.goal_id),
  create,
  archive:(args:any)=>request('/learning-goals/'+args.goal_id+'/archive',{
   method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expected_revision:args.expected_revision,archived:args.archived}),
  }),
 }
}
