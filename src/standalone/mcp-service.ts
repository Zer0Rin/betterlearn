import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicJson } from './config.js'
import { resolveSourceGeneration } from '../product/source-generation.js'
import type { LearningCourseSnapshot } from '../product/types.js'
import { toolDefinitions, type ToolName } from '../mcp/tools.js'
import { McpOperationError } from './mcp-errors.js'
import { createMcpGoalOperations } from './mcp-goals.js'
export { McpOperationError } from './mcp-errors.js'
class RejectedRequest extends Error { constructor(readonly status:number){super('REQUEST_REJECTED')} }
const rejection = (status:number) => new McpOperationError(`REQUEST_REJECTED (${status}): 未创建任务；修正输入或配置后可用新的 request_id 重试`)
interface Ports {
 home:string
 learningBooks?():Promise<{books:Array<{bookId:string;title:string;courseId?:string}>}>
 learningCourse?(courseId:string,signal?:AbortSignal):Promise<LearningCourseSnapshot>
 configured():boolean
 request(path:string, init?:RequestInit):Promise<Response>
}
// Journal intent before dispatch. An ambiguous outcome is never automatically replayed.
export function createMcpOperations(ports:Ports) {
 const active = new Map<string,Promise<unknown>>()
 const goals = createMcpGoalOperations(ports)
 async function read(path:string,init?:RequestInit):Promise<any> {
  const response = await ports.request(path,init)
  if(init?.method==='POST' && response.status>=400 && response.status<500 && response.status!==408)throw new RejectedRequest(response.status)
  if(!response.ok)throw new McpOperationError('BETTERLEARN_OPERATION_FAILED')
  const body = await response.json() as {code?:number;data?:unknown}
  if(body.code !== 0)throw new McpOperationError('BETTERLEARN_OPERATION_FAILED')
  return body.data
 }
 async function generate(args:any, sourceGeneration=false) {
  const {request_id,...input} = args
  const digest=createHash('sha256').update(JSON.stringify(sourceGeneration?{operation:'source-generation-v1',...input}:input)).digest('hex')
  const folder=join(ports.home,'mcp-requests'), path=join(folder,request_id+'.json')
  await mkdir(folder,{recursive:true,mode:0o700})
  try {
   const record=JSON.parse(await readFile(path,'utf8'))
   if(record.digest!==digest)throw new McpOperationError('REQUEST_ID_CONFLICT')
   if(record.status==='rejected')throw rejection(record.http_status)
   if(record.task_id)return {request_id,task_id:record.task_id}
   throw new McpOperationError('REQUEST_OUTCOME_UNKNOWN: 查看练习历史，勿自动创建新请求')
  } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error }
  if(!ports.configured())throw new McpOperationError('MODEL_NOT_CONFIGURED: 请在 BetterLearn 设置中配置 API')
  let target='/quiz/generate/async'
  let payload=JSON.stringify({...input,generate_images:false})
  if(sourceGeneration) {
   target='/quiz/generate/from-source'
   const {course_id,unit_id,...options}=input
   const selection=Uint8Array.from(Buffer.from(JSON.stringify({request_id,...options,source:{courseId:course_id,unitId:unit_id},generate_images:false}))).buffer
   try {
    const resolved=await resolveSourceGeneration(selection,
     ports.learningCourse?{getLearningCourse:ports.learningCourse}:undefined,new AbortController().signal,
     async id=>{
      const response=await ports.request('/quiz/source-request/'+id)
      if(response.status===404){await response.body?.cancel();return undefined}
      if(!response.ok)throw new Error()
      const result=await response.json()
      if(result.code!==0||!result.data?.request?.source)throw new Error()
      return result.data.request
     })
    payload=Buffer.from(resolved).toString('utf8')
   }catch{throw new McpOperationError('SOURCE_PREPARATION_FAILED: 未发送生成请求，请检查课程来源或请求编号；勿自动换 ID')}
  }
  await atomicJson(path,{digest,status:'dispatching'})
  try {
   const data=await read(target,{method:'POST',headers:{'content-type':'application/json'},body:payload})
   if(typeof data?.task_id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.task_id))throw new Error()
   await atomicJson(path,{digest,status:'accepted',task_id:data.task_id})
   return {request_id,task_id:data.task_id}
  } catch(error) {
   if(error instanceof RejectedRequest) {
    // Only a persisted terminal rejection permits an explicitly corrected new request.
    try { await atomicJson(path,{digest,status:'rejected',http_status:error.status}) }
    catch { throw new McpOperationError('REQUEST_OUTCOME_UNKNOWN: 查看练习历史，勿自动创建新请求') }
    throw rejection(error.status)
   }
   throw new McpOperationError('REQUEST_OUTCOME_UNKNOWN: 查看练习历史，勿自动创建新请求')
  }
 }
 return async (name:unknown, input:unknown):Promise<unknown> => {
  if(typeof name!=='string'||!Object.hasOwn(toolDefinitions,name))throw new McpOperationError('UNKNOWN_TOOL')
  const result=toolDefinitions[name as ToolName].schema.safeParse(input)
  if(!result.success)throw new McpOperationError('INVALID_ARGUMENTS')
  const args=result.data as any
  switch(name as ToolName) {
   case 'betterlearn_list_learning_goals': return goals.list(args)
   case 'betterlearn_read_learning_goal': return goals.read(args)
   case 'betterlearn_create_learning_goal': return goals.create(args)
   case 'betterlearn_set_learning_goal_archived': return goals.archive(args)
   case 'betterlearn_list_learning_books': {
    if(!ports.learningBooks)throw new McpOperationError('CORE_UNAVAILABLE')
    const library=await ports.learningBooks()
    return {items:library.books.map(book=>({book_id:book.bookId,title:book.title,course_id:book.courseId??null}))}
   }
   case 'betterlearn_read_learning_course': {
    if(!ports.learningCourse)throw new McpOperationError('CORE_UNAVAILABLE')
    const course=await ports.learningCourse(args.course_id)
    return {course_id:course.courseId,title:course.title,status:course.status,
     units:course.units.map(unit=>({unit_id:unit.unitId,knowledge_point_id:unit.knowledgePointId,type:unit.type,title:unit.title,statement:unit.lesson.explanation}))}
   }
   case 'betterlearn_knowledge_assessment': {
    const query=new URLSearchParams({knowledge_point_id:args.knowledge_point_id,content_version:args.content_version})
    return read('/question-bank/knowledge-assessment?'+query)
   }
   case 'betterlearn_knowledge_stats':
   case 'betterlearn_knowledge_history': {
    if(args.content_version&&!args.knowledge_point_id)throw new McpOperationError('INVALID_ARGUMENTS')
    const query=new URLSearchParams({page:String(args.page),page_size:String(args.page_size)})
    if(args.knowledge_point_id)query.set('knowledge_point_id',args.knowledge_point_id)
    if(args.content_version)query.set('content_version',args.content_version)
    return read('/question-bank/knowledge-stats'+(name==='betterlearn_knowledge_history'?'/history':'')+'?'+query)
   }
   case 'betterlearn_status':return {running:true,text_model_configured:ports.configured()}
   case 'betterlearn_list_documents':return read('/knowledge/documents')
   case 'betterlearn_read_document':return read(`/knowledge/documents/${args.document_id}/content`)
   case 'betterlearn_list_quizzes':return read(`/user/quizzes?page=${args.page}&page_size=${args.page_size}`)
   case 'betterlearn_read_quiz':return read(`/user/quizzes/${args.quiz_id}`)
   case 'betterlearn_get_task': {
    const data=await read(`/quiz/task/${args.task_id}`)
    return {task_id:data.task_id,status:data.status,result:data.result,error_message:data.status==='failed'?'生成失败，请在 BetterLearn 中检查配置与任务':null}
   }
   case 'betterlearn_generate_quiz':
   case 'betterlearn_generate_source_quiz': {
    // Serialize equal IDs, then re-read the persisted digest to detect different inputs.
    const prior=active.get(args.request_id)
    const operation=(prior ?? Promise.resolve()).catch(()=>{}).then(()=>generate(args,name==='betterlearn_generate_source_quiz'));active.set(args.request_id,operation)
    try {return await operation}finally{if(active.get(args.request_id)===operation)active.delete(args.request_id)}
   }
  }
 }
}
