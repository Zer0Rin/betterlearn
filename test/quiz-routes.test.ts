import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, expect, test, vi } from 'vitest'
import { registerQuizRoutes } from '../src/product/quiz-routes.js'
import type { QuizServicePort } from '../src/product/quiz-service.js'
const close: Array<()=>Promise<void>>=[]
afterEach(async()=>{await Promise.all(close.splice(0).map(f=>f()))})
async function fixture(sourceResolver?: any){
 let handler:(req:IncomingMessage,res:ServerResponse)=>void=()=>{}
 const server=createServer((req,res)=>handler(req,res))
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 close.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r())}))
 const port=(server.address() as {port:number}).port
 const service:QuizServicePort={start:vi.fn(async()=>{}),dispose:vi.fn(async()=>{}),session:vi.fn(async()=>({user:{id:1}})),request:vi.fn(async(path,init)=>Response.json({code:0,message:'success',data:path.endsWith('/source') && init?.method==='GET'?{source:null,source_revision:0}:{items:[]}}))}
 registerQuizRoutes({webServer:{port,register:(definition:any)=>{handler=definition.handler;return ()=>{}}}} as any,service,sourceResolver)
 return {url:`http://127.0.0.1:${port}`,service}
}
test('exposes a token-free session and refuses cross-origin mutation',async()=>{
 const {url,service}=await fixture()
 expect((await fetch(url+'/nobei/quiz/v1/session',{method:'POST'})).status).toBe(403)
 const response=await fetch(url+'/nobei/quiz/v1/session',{method:'POST',headers:{origin:url}})
 expect(await response.json()).toEqual({code:0,message:'success',data:{user:{id:1}}})
 expect(service.session).toHaveBeenCalledTimes(1)
})
test('forwards only exact business paths and never browser authorization',async()=>{
 const {url,service}=await fixture()
 for(const path of ['/user/local-login','/user/host-session','/docs','/knowledge/documents/doc_a/content?url=evil']){
  expect((await fetch(url+'/nobei/quiz/v1'+path)).status).toBe(404)
 }
 expect((await fetch(url+'/nobei/quiz/v1/user/profile',{headers:{authorization:'Bearer injected'}})).status).toBe(200)
 const call=vi.mocked(service.request).mock.calls[0]
 expect(call[0]).toBe('/user/profile')
 expect(new Headers(call[1]?.headers).has('authorization')).toBe(false)
})
test('forwards multipart document upload with intact bytes and origin checking',async()=>{
 const {url,service}=await fixture()
 const form=new FormData();form.append('file',new Blob(['你好']),'notes.txt')
 const response=await fetch(url+'/nobei/quiz/v1/knowledge/documents',{method:'POST',headers:{origin:url},body:form})
 expect(response.status).toBe(200)
 const call=vi.mocked(service.request).mock.calls[0]
 expect(new Headers(call[1]?.headers).get('content-type')).toContain('multipart/form-data; boundary=')
 expect(Buffer.from(call[1]?.body as ArrayBuffer).toString()).toContain('你好')
})
test('rejects oversized input and incorrect methods before upstream',async()=>{
 const {url,service}=await fixture()
 expect((await fetch(url+'/nobei/quiz/v1/user/profile',{method:'POST',headers:{origin:url}})).status).toBe(405)
 const response=await fetch(url+'/nobei/quiz/v1/quiz/generate/async',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:'x'.repeat(1024*1024+1)})
 expect(response.status).toBe(413)
 expect(service.request).not.toHaveBeenCalled()
})

test('allows owned attempt routes with exact methods and rejects query/path escapes', async () => {
 const {url,service}=await fixture()
 const paths: Array<[string,string]> = [
  ['/quiz/quiz_a/attempts','POST'], ['/quiz/quiz_a/attempts','GET'],
  ['/quiz/attempts/attempt_a','GET'], ['/quiz/attempts/attempt_a/answers','PUT'],
  ['/quiz/attempts/attempt_a/submit','POST'], ['/quiz/attempts/attempt_a/report','POST'],
 ]
 for (const [path,method] of paths) {
  const mutating=method!=='GET'
  const response=await fetch(url+'/nobei/quiz/v1'+path,{method,
   headers:{origin:url,'content-type':'application/json'},body:mutating?'{}':undefined})
  expect(response.status).toBe(200)
  expect(vi.mocked(service.request).mock.calls.at(-1)?.[0]).toBe(path)
 }
 expect((await fetch(url+'/nobei/quiz/v1/quiz/attempts/attempt_a/submit',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(403)
 expect((await fetch(url+'/nobei/quiz/v1/quiz/attempts/attempt_a/submit')).status).toBe(405)
 for (const path of ['/quiz/attempts/attempt_a?user_id=2','/quiz/attempts/attempt_a/report/extra','/quiz/attempts/'+ 'a'.repeat(101)]) {
  expect((await fetch(url+'/nobei/quiz/v1'+path)).status).toBe(404)
 }
})

test('forwards exact question-bank paths and bounded search filters', async () => {
 const {url,service}=await fixture()
 const paths: Array<[string,string]> = [
  ['/question-bank/entries?page=1&page_size=20&scope=wrong&search=RAG','GET'],
  ['/question-bank/stats','GET'], ['/question-bank/entries/1','GET'],
  ['/question-bank/entries/1/history?page=2','GET'], ['/question-bank/entries/1','PUT'],
  ['/question-bank/categories','POST'], ['/question-bank/categories','GET'],
  ['/question-bank/categories/1','PUT'], ['/question-bank/categories/1','DELETE'],
  ['/question-bank/entries/1/categories/2','PUT'], ['/question-bank/entries/1/categories/2','DELETE'],
 ]
 for(const [path,method] of paths){
  const response=await fetch(url+'/nobei/quiz/v1'+path,{method,headers:{origin:url,'content-type':'application/json'},body:['POST','PUT'].includes(method)?'{}':undefined})
  expect(response.status).toBe(200)
  expect(vi.mocked(service.request).mock.calls.at(-1)?.[0]).toBe(path)
 }
 for(const path of ['/question-bank/entries?user_id=2','/question-bank/stats?scope=wrong','/question-bank/entries?search='+ 'a'.repeat(201),'/question-bank/entries?page=1&page=2','/question-bank/entries?scope=invalid','/question-bank/entries/1/history?quiz_id=x']){
  expect((await fetch(url+'/nobei/quiz/v1'+path)).status).toBe(404)
 }
 expect((await fetch(url+'/nobei/quiz/v1/question-bank/entries/1',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:'{}'})).status).toBe(405)
})

test('binds sources from Core snapshots and never accepts browser snapshot content', async () => {
 const courseId='course_'+'1'.repeat(20), unitId='unit_'+'1'.repeat(20)
 const unit={unitId,knowledgePointId:'kp_'+'1'.repeat(20),type:'concept',title:'来源',
  lesson:{explanation:'冻结陈述'},evidence:{kind:'summary',text:'无证据'}}
 const getLearningCourse=vi.fn(async()=>({courseId,status:'active',units:[unit]}))
 const {url,service}=await fixture({getLearningCourse})
 const path=url+'/nobei/quiz/v1/question-bank/entries/1/source'
 const request={expected_revision:0,source:{courseId,unitId}}
 const options={method:'PUT',headers:{origin:url,'content-type':'application/json'}}
 expect((await fetch(path,{...options,body:JSON.stringify(request)})).status).toBe(200)
 expect(getLearningCourse).toHaveBeenCalledWith(courseId,expect.any(AbortSignal))
 const forwarded=JSON.parse(Buffer.from(vi.mocked(service.request).mock.calls.at(-1)![1]!.body as ArrayBuffer).toString())
 expect(forwarded.source).toEqual({schema_version:1,course_id:courseId,unit_id:unitId,
  knowledge_point_id:unit.knowledgePointId,type:'concept',title:'来源',statement:'冻结陈述',
  evidence:unit.evidence,content_version:expect.stringMatching(/^[a-f0-9]{64}$/)})
 for(const source of [{...request.source,title:'forged'}, {...request.source,content_version:'0'.repeat(64)}]){
  expect((await fetch(path,{...options,body:JSON.stringify({...request,source})})).status).toBe(400)
 }
 expect(service.request).toHaveBeenCalledTimes(2)
 expect((await fetch(path,{...options,body:JSON.stringify({...request,source:null})})).status).toBe(200)
 expect(getLearningCourse).toHaveBeenCalledTimes(1)
 expect(JSON.parse(Buffer.from(vi.mocked(service.request).mock.calls.at(-1)![1]!.body as ArrayBuffer).toString())).toEqual({...request,source:null})
})

test('source binding rejects unavailable and archived Core snapshots without writes', async () => {
 const courseId='course_'+'1'.repeat(20),unitId='unit_'+'1'.repeat(20)
 const getLearningCourse=vi.fn(async()=>({courseId,status:'archived',units:[]}))
 const {url,service}=await fixture({getLearningCourse})
 const path=url+'/nobei/quiz/v1/question-bank/entries/1/source'
 const options={method:'PUT',headers:{origin:url,'content-type':'application/json'},
  body:JSON.stringify({expected_revision:0,source:{courseId,unitId}})}
 expect((await fetch(path,options)).status).toBe(409)
 getLearningCourse.mockResolvedValue({courseId,status:'active',units:[]})
 expect((await fetch(path,options)).status).toBe(404)
 expect(vi.mocked(service.request).mock.calls.every(([,init])=>init?.method==='GET')).toBe(true)
 const unavailable=await fixture()
 expect((await fetch(unavailable.url+'/nobei/quiz/v1/question-bank/entries/1/source',
  {...options,headers:{...options.headers,origin:unavailable.url}})).status).toBe(503)
})

test('source digest matches the Python-validated Unicode contract fixture', async () => {
 const {readFileSync}=await import('node:fs')
 const {resolveQuizSource}=await import('../src/product/quiz-source.js')
 const fixture=JSON.parse(readFileSync(new URL('../contracts/quiz-source-v1.json',import.meta.url),'utf8'))
 const course={courseId:fixture.course_id,status:'active',units:[{
  unitId:fixture.unit_id,knowledgePointId:fixture.knowledge_point_id,type:fixture.type,title:fixture.title,
  lesson:{explanation:fixture.statement},evidence:fixture.evidence}]}
 const body=Uint8Array.from(Buffer.from(JSON.stringify({expected_revision:3,
  source:{courseId:fixture.course_id,unitId:fixture.unit_id}}))).buffer
 const result=await resolveQuizSource(body,{getLearningCourse:async()=>course} as any,new AbortController().signal)
 expect(JSON.parse(Buffer.from(result).toString())).toEqual({expected_revision:3,source:fixture})
})

test('source route enforces origin, exact body and Core errors', async () => {
 const {CoreRpcError}=await import('../src/product/core-rpc-client.js')
 const getLearningCourse=vi.fn(async()=>{throw new CoreRpcError('LEARNING_COURSE_NOT_FOUND')})
 const {url,service}=await fixture({getLearningCourse})
 const path=url+'/nobei/quiz/v1/question-bank/entries/1/source'
 const options={method:'PUT',headers:{origin:url,'content-type':'application/json'}}
 for(const body of ['bad','{}',JSON.stringify({expected_revision:true,source:null}),
   JSON.stringify({expected_revision:0,source:null,correct:true})]){
   expect((await fetch(path,{...options,body})).status).toBe(400)
 }
 const body=JSON.stringify({expected_revision:0,source:{courseId:'course_'+'1'.repeat(20),unitId:'unit_'+'1'.repeat(20)}})
 expect((await fetch(path,{...options,body})).status).toBe(404)
 expect((await fetch(path,{...options,headers:{'content-type':'application/json'},body})).status).toBe(403)
 expect(vi.mocked(service.request).mock.calls.every(([,init])=>init?.method==='GET')).toBe(true)
 expect((await fetch(path)).status).toBe(200)
})


test('source PUT replays persisted mapping after Core deletion without overwriting newer revisions', async () => {
 const {readFileSync}=await import('node:fs')
 const snapshot=JSON.parse(readFileSync(new URL('../contracts/quiz-source-v1.json',import.meta.url),'utf8'))
 const getLearningCourse=vi.fn(async()=>{throw new Error('Core deleted')})
 const {url,service}=await fixture({getLearningCourse})
 vi.mocked(service.request).mockImplementation(async(path,init)=>Response.json({code:0,
  data:init?.method==='GET'?{source:snapshot,source_revision:1}:{source:snapshot,source_revision:1}}))
 const path=url+'/nobei/quiz/v1/question-bank/entries/1/source'
 const options={method:'PUT',headers:{origin:url,'content-type':'application/json'},
  body:JSON.stringify({expected_revision:0,source:{courseId:snapshot.course_id,unitId:snapshot.unit_id}})}
 expect((await fetch(path,options)).status).toBe(200)
 expect(getLearningCourse).not.toHaveBeenCalled()
 const forwarded=JSON.parse(Buffer.from(vi.mocked(service.request).mock.calls.at(-1)![1]!.body as ArrayBuffer).toString())
 expect(forwarded).toEqual({expected_revision:0,source:snapshot})
 // A concurrent change between read and replay must still reach Quiz's CAS guard.
 vi.mocked(service.request).mockImplementation(async(path,init)=>init?.method==='GET'
  ?Response.json({code:0,data:{source:snapshot,source_revision:1}})
  :Response.json({code:4090,message:'conflict',data:null},{status:409}))
 expect((await fetch(path,options)).status).toBe(409)
})

test('stale source revision conflicts before consulting a deleted Core course', async () => {
 const getLearningCourse=vi.fn(async()=>{throw new Error('deleted')})
 const {url,service}=await fixture({getLearningCourse})
 vi.mocked(service.request).mockResolvedValue(Response.json({code:0,data:{source:null,source_revision:2}}))
 const response=await fetch(url+'/nobei/quiz/v1/question-bank/entries/1/source',{
  method:'PUT',headers:{origin:url,'content-type':'application/json'},
  body:JSON.stringify({expected_revision:0,source:{courseId:'course_'+'1'.repeat(20),unitId:'unit_'+'1'.repeat(20)}})})
 expect(response.status).toBe(409)
 expect(getLearningCourse).not.toHaveBeenCalled()
 expect(service.request).toHaveBeenCalledTimes(1)
})

test('knowledge statistics allow only bounded read-only version queries', async () => {
 const {url,service}=await fixture()
 const base=url+'/nobei/quiz/v1/question-bank/knowledge-stats'
 const kp='kp_'+'a'.repeat(20), version='b'.repeat(64)
 for(const suffix of ['', '?page=1&page_size=10', '?knowledge_point_id='+kp,
  '?knowledge_point_id='+kp+'&content_version='+version,
  '/history?knowledge_point_id='+kp+'&content_version='+version+'&page_size=1']){
  expect((await fetch(base+suffix)).status).toBe(200)
 }
 const calls=vi.mocked(service.request).mock.calls.length
 for(const suffix of ['?page_size=101','?page=1&page=2','?content_version='+version,
  '?knowledge_point_id=bad','/history','/history?knowledge_point_id='+kp,
  '?user_id=2','?knowledge_point_id='+kp+'&content_version=bad']){
  expect((await fetch(base+suffix)).status).toBe(404)
 }
 expect((await fetch(base,{method:'POST',headers:{origin:url,'content-type':'application/json'},body:'{}'})).status).toBe(405)
 expect(service.request).toHaveBeenCalledTimes(calls)
})

test('source generation resolves Core once and replays persisted requests after deletion', async () => {
 const {readFileSync}=await import('node:fs')
 const snapshot=JSON.parse(readFileSync(new URL('../contracts/quiz-source-v1.json',import.meta.url),'utf8'))
 const getLearningCourse=vi.fn(async()=>({courseId:snapshot.course_id,status:'active',units:[{
  unitId:snapshot.unit_id,knowledgePointId:snapshot.knowledge_point_id,type:snapshot.type,title:snapshot.title,
  lesson:{explanation:snapshot.statement},evidence:snapshot.evidence}]}))
 const {url,service}=await fixture({getLearningCourse})
 let saved:any
 vi.mocked(service.request).mockImplementation(async(path,init)=>{
  if(path.startsWith('/quiz/source-request/')) return saved
    ?Response.json({code:0,data:{task_id:'task_once',request:saved}})
    :Response.json({code:4040},{status:404})
  saved=JSON.parse(Buffer.from(init!.body as ArrayBuffer).toString())
  return Response.json({code:0,data:{task_id:'task_once'}})
 })
 const endpoint=url+'/nobei/quiz/v1/quiz/generate/from-source'
 const body={request_id:'only-once',source:{courseId:snapshot.course_id,unitId:snapshot.unit_id}}
 const options={method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify(body)}
 expect((await fetch(endpoint,options)).status).toBe(200)
 expect(saved.source).toEqual(snapshot)
 expect(saved.question_count).toBe(5)
 getLearningCourse.mockRejectedValue(new Error('deleted'))
 expect((await fetch(endpoint,options)).status).toBe(200)
 expect(getLearningCourse).toHaveBeenCalledTimes(1)
 const calls=vi.mocked(service.request).mock.calls.length
 for(const invalid of [{...body,source:snapshot},{...body,source:{...body.source,title:'forged'}},
   {...body,doc_id:'doc_other'},{...body,question_count:11},{...body,generate_images:'true'}, {...body,request_id:'../escape'}]){
  expect((await fetch(endpoint,{...options,body:JSON.stringify(invalid)})).status).toBe(400)
 }
 expect(service.request).toHaveBeenCalledTimes(calls)
 expect((await fetch(url+'/nobei/quiz/v1/quiz/source-request/only-once')).status).toBe(404)
 expect((await fetch(endpoint,{...options,headers:{'content-type':'application/json'}})).status).toBe(403)
})

test('knowledge assessment requires exactly one version and point and only permits GET', async () => {
 const {url,service}=await fixture()
 const base=url+'/nobei/quiz/v1/question-bank/knowledge-assessment'
 const kp='kp_'+'a'.repeat(20), version='b'.repeat(64)
 const query='?knowledge_point_id='+kp+'&content_version='+version
 expect((await fetch(base+query)).status).toBe(200)
 expect(vi.mocked(service.request).mock.calls[0][0]).toBe('/question-bank/knowledge-assessment'+query)
 for(const suffix of ['', '?knowledge_point_id='+kp, '?content_version='+version,
  '?knowledge_point_id=bad&content_version='+version, '?knowledge_point_id='+kp+'&content_version=bad',
  query+'&content_version='+version, query+'&knowledge_point_id='+kp, query+'&user_id=2', query+'&page=1', query+'&page_size=10']){
  expect((await fetch(base+suffix)).status).toBe(404)
 }
 expect((await fetch(base+query,{headers:{origin:'https://evil.example'}})).status).toBe(403)
 for(const method of ['POST','PUT','DELETE']){
  expect((await fetch(base+query,{method,headers:{origin:url,'content-type':'application/json'},body:'{}'})).status).toBe(405)
 }
 expect(service.request).toHaveBeenCalledTimes(1)
})

test('learning goals freeze only Core IDs and replay stored sources after deletion', async () => {
 const {readFileSync}=await import('node:fs')
 const snapshot=JSON.parse(readFileSync(new URL('../contracts/quiz-source-v1.json',import.meta.url),'utf8'))
 const getLearningCourse=vi.fn(async()=>({courseId:snapshot.course_id,status:'active',units:[{
  unitId:snapshot.unit_id,knowledgePointId:snapshot.knowledge_point_id,type:snapshot.type,title:snapshot.title,
  lesson:{explanation:snapshot.statement},evidence:snapshot.evidence}]}))
 const {url,service}=await fixture({getLearningCourse})
 let saved:any
 vi.mocked(service.request).mockImplementation(async(path,init)=>{
  if(path.startsWith('/learning-goals/request/'))return saved?Response.json({code:0,data:{request:saved}}):Response.json({code:4040},{status:404})
  if(init?.method==='POST')saved=JSON.parse(Buffer.from(init.body as ArrayBuffer).toString())
  return Response.json({code:0,data:{goal_id:'goal_'+'a'.repeat(32)}})
 })
 const base=url+'/nobei/quiz/v1/learning-goals'
 const body={request_id:'AAAAAAAA-1111-2222-3333-444444444444',title:'  学习目标  ',due_at:'2099-01-01T08:00:00+08:00',
  source:{courseId:snapshot.course_id,unitId:snapshot.unit_id}}
 const send=(value:unknown)=>fetch(base,{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify(value)})
 expect((await send(body)).status).toBe(200)
 expect(saved).toMatchObject({source:snapshot,target_percent:90,min_distinct_questions:5,title:'学习目标',due_at:'2099-01-01T00:00:00.000Z',request_id:body.request_id.toLowerCase()})
 getLearningCourse.mockRejectedValue(new Error('deleted'))
 expect((await send(body)).status).toBe(200)
 expect(getLearningCourse).toHaveBeenCalledTimes(1)
 expect((await send({...body,source:{...body.source,unitId:'unit_'+'f'.repeat(20)}})).status).toBe(409)
 const before=vi.mocked(service.request).mock.calls.length
 for(const invalid of [{...body,source:snapshot},{...body,source:{...body.source,content_version:'a'.repeat(64)}},
  {...body,title:' '},{...body,target_percent:true},{...body,min_distinct_questions:2},{...body,request_id:'bad'},
  {...body,due_at:'2099-02-30T00:00:00Z'}, {...body,due_at:'2099-01-01'}, {...body,due_at:'2099-01-01T00:00:00.0001Z'},
  {...body,due_at:'2099-01-01T00:00:00+00:60'},{...body,user_id:2},{...body,criteria_met:true}]){
  expect((await send(invalid)).status).toBe(400)
 }
 expect(service.request).toHaveBeenCalledTimes(before)
 expect((await fetch(base+'/request/'+body.request_id)).status).toBe(404)
 expect((await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).status).toBe(403)
})

test('learning goal allowlist limits list queries and archive methods', async () => {
 const {url,service}=await fixture()
 const base=url+'/nobei/quiz/v1/learning-goals',goal='goal_'+'a'.repeat(32)
 for(const suffix of ['', '?page=1&page_size=50&status=all', '/'+goal]){
  expect((await fetch(base+suffix)).status).toBe(200)
 }
 expect((await fetch(base+'/'+goal+'/archive',{method:'PUT',headers:{origin:url,'content-type':'application/json'},body:'{"expected_revision":0,"archived":true}'})).status).toBe(200)
 const calls=vi.mocked(service.request).mock.calls.length
 for(const suffix of ['?page_size=51','?page=1&page=2','?status=bad','?user_id=2','/'+goal+'?page=1','/goal_bad','/'+goal+'/archive?x=1']){
  expect((await fetch(base+suffix)).status).toBe(404)
 }
 expect((await fetch(base+'/'+goal,{method:'DELETE',headers:{origin:url}})).status).toBe(405)
 expect((await fetch(base+'?page=1',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:'{}'})).status).toBe(404)
 expect(service.request).toHaveBeenCalledTimes(calls)
})

test('new goals reject unavailable or inactive Core sources without creation', async () => {
 const {readFileSync}=await import('node:fs')
 const snapshot=JSON.parse(readFileSync(new URL('../contracts/quiz-source-v1.json',import.meta.url),'utf8'))
 const getLearningCourse=vi.fn(async()=>({courseId:snapshot.course_id,status:'archived',units:[]}))
 const {url,service}=await fixture({getLearningCourse})
 vi.mocked(service.request).mockResolvedValue(Response.json({code:4040},{status:404}))
 const body={request_id:'aaaaaaaa-1111-2222-3333-444444444444',title:'target',due_at:'2099-01-01T00:00:00Z',source:{courseId:snapshot.course_id,unitId:snapshot.unit_id}}
 const options={method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify(body)}
 expect((await fetch(url+'/nobei/quiz/v1/learning-goals',options)).status).toBe(409)
 getLearningCourse.mockResolvedValue({courseId:snapshot.course_id,status:'active',units:[]})
 vi.mocked(service.request).mockImplementation(async()=>Response.json({code:4040},{status:404}))
 expect((await fetch(url+'/nobei/quiz/v1/learning-goals',options)).status).toBe(404)
 getLearningCourse.mockRejectedValue(new Error('private-Core-failure'))
 expect((await fetch(url+'/nobei/quiz/v1/learning-goals',options)).status).toBe(503)
 expect(vi.mocked(service.request).mock.calls.every(([,init])=>init?.method==='GET')).toBe(true)
})

test('exposes bounded paper review and timed exam routes through the trusted Host', async () => {
 const {url,service}=await fixture()
 const paper='paper_'+'1'.repeat(32), exam='exam_'+'2'.repeat(32)
 const paths: Array<[string,string]> = [
  ['/exam-papers/preview','POST'], ['/exam-papers','POST'], ['/exam-papers?page=2&page_size=10','GET'],
  [`/exam-papers/${paper}`,'GET'], [`/exam-papers/${paper}/review`,'PUT'], [`/exam-papers/${paper}/sessions`,'POST'],
  ['/exam-sessions','GET'], [`/exam-sessions/${exam}`,'GET'], [`/exam-sessions/${exam}/answers`,'PUT'], [`/exam-sessions/${exam}/submit`,'POST'],
 ]
 for(const [path,method] of paths){
  const response=await fetch(url+'/nobei/quiz/v1'+path,{method,headers:{origin:url,'content-type':'application/json'},body:method==='GET'?undefined:'{}'})
  expect(response.status).toBe(200)
  expect(vi.mocked(service.request).mock.calls.at(-1)?.[0]).toBe(path)
 }
 for(const path of ['/exam-papers?page=0','/exam-papers?page=1&page=2','/exam-sessions?page_size=101',`/exam-sessions/${exam}?answers=true`,'/exam-papers?user_id=2',`/exam-papers/${paper}/answer-key`]){
  expect((await fetch(url+'/nobei/quiz/v1'+path)).status).toBe(404)
 }
 expect((await fetch(url+`/nobei/quiz/v1/exam-sessions/${exam}/submit`)).status).toBe(405)
 expect((await fetch(url+'/nobei/quiz/v1/exam-papers',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(403)
})
