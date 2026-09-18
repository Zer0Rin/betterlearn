import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createMcpOperations, McpOperationError } from './mcp-service.js'
import { atomicJson } from './config.js'
import { readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SettingsStore } from './config.js'
import { acquireHomeLock, initializeCore } from './home.js'
import { NativeSubprocess } from './subprocess.js'
import { LibraryStore, LibraryConflictError } from './library.js'
import { loadCandidateContract } from '../product/contract.js'
import { CoreSupervisor } from '../product/core-supervisor.js'
import { GenerationCoordinator } from '../product/generation-coordinator.js'
import { StandaloneGenerationAdapter } from './model.js'
import { ModelSelectionResolutionError } from '../product/model-selection-port.js'
import { createProductOperations } from '../product/operations.js'
import { registerProductRoutes } from '../product/routes.js'
import { registerQuizRoutes } from '../product/quiz-routes.js'
import { QuizService, type QuizServicePort } from '../product/quiz-service.js'
import { KnowledgeBaseSource } from '../product/knowledge-base-source.js'
import { authorizeProductRequest, parseProductJsonBody, ProductRequestError } from '../product/request-security.js'
import type { RouteContext } from '../product/http-port.js'
export interface StandaloneOptions { home:string;packageRoot:string;pythonExecutable:string;quizPythonExecutable:string;port?:number;quiz?:boolean }
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value))}
export async function startStandalone(options:StandaloneOptions){
 const token=randomBytes(32).toString('hex')
 const connectionPath=join(options.home,'mcp-connection.json')
 const unlock=await acquireHomeLock(options.home,options.pythonExecutable)
 let core:CoreSupervisor|undefined;let coordinator:GenerationCoordinator|undefined;let quiz:QuizService|undefined
 const routes:Array<{path:string;handler(req:IncomingMessage,res:ServerResponse):void|Promise<void>}>=[]
 const unregister:Array<()=>void>=[]
 let stopped=false;let settingsBusy=false;let requests=0
 const handlers=new Set<Promise<void>>()
 const server=createServer((req,res)=>{if(stopped){json(res,503,{message:'应用正在关闭'});return}requests++;res.once('close',()=>{requests--});const handler=handle(req,res).catch(()=>{if(!res.headersSent)json(res,500,{message:'本机服务处理失败，请检查服务状态'});else res.end()});handlers.add(handler);void handler.finally(()=>handlers.delete(handler))})
 let closing:Promise<void>|undefined
 const close=():Promise<void>=>closing??=(async()=>{stopped=true;unregister.forEach(fn=>fn());server.close();server.closeAllConnections();await Promise.allSettled([...handlers]);try{await coordinator?.dispose()}finally{try{await core?.dispose()}finally{try{await quiz?.dispose()}finally{try{await rm(connectionPath,{force:true})}finally{await unlock()}}}}})()
 let settings:SettingsStore;let library:LibraryStore
 const port=()=>{const address=server.address();return address&&typeof address!=='string'?address.port:0}
 const ctx:RouteContext={webServer:{get port(){return port()},register(route){routes.push(route);return()=>{const i=routes.indexOf(route);if(i>=0)routes.splice(i,1)}}}}
 const makeQuiz=()=>new QuizService({pythonExecutable:options.quizPythonExecutable,envFile:join(options.home,'quiz.env'),dataRoot:join(options.home,'quiz-data'),packageRoot:options.packageRoot})
 const quizPort:QuizServicePort={start:()=>quiz!.start(),session:()=>quiz!.session(),request:(p,i)=>quiz!.request(p,i),dispose:async()=>{await quiz?.dispose()}}
 const mcpCall=createMcpOperations({home:options.home,learningBooks:()=>library.read(),learningCourse:(courseId,signal)=>core!.withReadyClient(client=>client.getLearningCourse({courseId},signal)),configured:()=>!!settings.selection(),request:(path,init)=>quiz ? quizPort.request(path,init) : Promise.reject(new Error('QUIZ_UNAVAILABLE'))})
 async function deleteCourse(id:string){try{await core!.withReadyClient(client=>client.deleteLearningCourse({courseId:id}))}catch(error){if((error as {code?:string}).code!=='LEARNING_COURSE_NOT_FOUND')throw error}}
 async function handle(req:IncomingMessage,res:ServerResponse){
  const pathname=new URL(req.url??'/','http://127.0.0.1').pathname
  // Same-origin applies to every private endpoint; top-level document navigation is allowed.
  const api=pathname.startsWith('/api/')||pathname.startsWith('/nobei/')
  const trust=authorizeProductRequest(api?req:{headers:{host:req.headers.host},socket:req.socket},req.method!=='GET',port())
  if(!trust.ok)return json(res,403,{message:trust.code})
  if(settingsBusy)return json(res,503,{message:'正在应用设置，请稍后重试'})
  if(pathname==='/api/mcp/call') {
   const auth=req.headers.authorization
   const supplied=typeof auth==='string'&&auth.startsWith('Bearer ')?auth.slice(7):''
   if(!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return json(res,403,{message:'UNAUTHORIZED'})
   if(req.method!=='POST')return json(res,405,{message:'METHOD_NOT_ALLOWED'})
   if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,415,{message:'JSON_REQUIRED'})
   try {
    const body=await parseProductJsonBody(req) as {name?:unknown;args?:unknown}
    return json(res,200,{data:await mcpCall(body?.name,body?.args)})
   } catch(error) {
    if(error instanceof ProductRequestError)return json(res,error.status,{error:error.code})
    return json(res,200,{error:error instanceof McpOperationError?error.message:'BETTERLEARN_OPERATION_FAILED'})
   }
  }
  if(pathname==='/api/settings'){
   if(req.method==='GET')return json(res,200,settings.public())
   if(req.method!=='PUT')return json(res,405,{message:'METHOD_NOT_ALLOWED'})
   if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{message:'JSON_REQUIRED'})
   if(coordinator!.activeCount||requests>1)return json(res,409,{message:'请等待当前操作完成后再修改设置'})
   settingsBusy=true
   try{
    const patch=await parseProductJsonBody(req)
    if(quiz){
     const docsResponse=await quiz.request('/knowledge/documents');if(!docsResponse.ok)throw new Error('无法确认知识库状态，设置未修改')
     const docs=await docsResponse.json() as {data?:{items?:Array<{status:string}>}}
     if(docs.data?.items?.some(d=>d.status==='processing'))throw new Error('请等待文档处理完成后再修改设置')
     const p=patch as {embedding?:{baseUrl?:string;model?:string}}
     if(docs.data?.items?.length&&p.embedding&&((p.embedding.baseUrl!==undefined&&p.embedding.baseUrl!==settings.public().embedding.baseUrl)||(p.embedding.model!==undefined&&p.embedding.model!==settings.public().embedding.model)))throw new Error('知识库已有向量，请先删除文档并重新上传后再切换向量模型')
     // Persistent jobs outlive HTTP requests. Do not interrupt them for a config change.
     const busy=await quiz.request('/user/active-tasks');if(!busy.ok)throw new Error('无法确认练习状态，设置未修改');if((await busy.json() as {data?:{active:boolean}}).data?.active)throw new Error('练习仍在生成，请完成后再修改设置')
    }
    await settings.update(patch)
    await quiz?.dispose();await settings.writeQuizEnv();if(options.quiz!==false)quiz=makeQuiz()
    return json(res,200,settings.public())
   }catch(error){return json(res,400,{message:error instanceof Error?error.message:'无效设置'})}finally{settingsBusy=false}
  }
  if(pathname==='/api/model'&&req.method==='GET')return json(res,200,settings.selection())
  if(pathname.startsWith('/api/library/books/')&&req.method==='DELETE'){
   try{const body=await parseProductJsonBody(req) as {expectedRevision?:number};if(!Number.isSafeInteger(body.expectedRevision))return json(res,400,{message:'缺少书库版本'});const saved=await library.deleteBook(decodeURIComponent(pathname.slice('/api/library/books/'.length)),body.expectedRevision!,deleteCourse);return json(res,200,saved)}catch(error){return json(res,error instanceof LibraryConflictError?409:400,{message:error instanceof LibraryConflictError?error.message:'删除未完成，请重启应用恢复后重试'})}
  }
  if(pathname==='/api/library'){
   if(req.method==='GET')return json(res,200,await library.read())
   if(req.method==='PUT')try{return json(res,200,await library.write(await parseProductJsonBody(req)))}catch(error){return json(res,error instanceof LibraryConflictError?409:400,{message:error instanceof LibraryConflictError?error.message:'学习书数据无效或保存失败'})}
   return json(res,405,{message:'METHOD_NOT_ALLOWED'})
  }
  if(pathname.startsWith('/api/images/')&&req.method==='GET'){
   const name=pathname.slice('/api/images/'.length)
   if(!/^[a-f0-9]{32}\.(png|jpg|webp)$/.test(name))return json(res,404,{message:'NOT_FOUND'})
   try{const root=await realpath(join(options.home,'quiz-data','images'));const file=await realpath(join(root,name));if(file!==join(root,name))throw new Error();const data=await readFile(file);res.writeHead(200,{'content-type':name.endsWith('.png')?'image/png':name.endsWith('.jpg')?'image/jpeg':'image/webp','x-content-type-options':'nosniff'});res.end(data);return}catch{return json(res,404,{message:'NOT_FOUND'})}
  }
  const route=routes.find(r=>pathname===r.path||pathname.startsWith(r.path+'/'))
  if(route)return route.handler(req,res)
  if(api||req.method!=='GET')return json(res,404,{message:'NOT_FOUND'})
  if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return}
  const files:Record<string,string>={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/app.css':'app.css'}
  const file=files[pathname];if(!file)return json(res,404,{message:'NOT_FOUND'})
  try{const data=await readFile(join(options.packageRoot,'public',file));res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"});res.end(data)}catch{json(res,503,{message:'页面尚未构建，请先运行 build:web'})}
 }
 try{
  settings=await SettingsStore.open(options.home);library=new LibraryStore(options.home)
  const identity=await initializeCore(options.home,options.pythonExecutable,options.packageRoot)
  const contract=loadCandidateContract(options.packageRoot)
  core=new CoreSupervisor(new NativeSubprocess(options.packageRoot),{...identity,pythonExecutable:options.pythonExecutable},contract)
  coordinator=new GenerationCoordinator(core,new StandaloneGenerationAdapter(contract,async selection=>settings.connection(selection)),{async resolve(selection){try{settings.connection(selection);return {...selection}}catch{throw new ModelSelectionResolutionError()}}})
  await settings.writeQuizEnv();if(options.quiz!==false)quiz=makeQuiz()
  const knowledgeBaseSource=quiz?new KnowledgeBaseSource({baseUrl:'http://127.0.0.1',token:'managed',fetch:(input,init)=>quizPort.request(new URL(String(input)).pathname.replace(/^\/api\/v1/,''),{signal:init?.signal})}):undefined
  const operations=createProductOperations({supervisor:core,coordinator,knowledgeBaseSource})
  unregister.push(registerProductRoutes(ctx,core,operations),registerQuizRoutes(ctx,quiz?quizPort:undefined,operations))
  await core.start()
  await library.recoverDelete(deleteCourse)
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??3210,'127.0.0.1',resolve)})
  await atomicJson(connectionPath,{url:`http://127.0.0.1:${port()}`,token})
  return {url:`http://127.0.0.1:${port()}`,close}
 }catch(error){await close();throw error}
}
