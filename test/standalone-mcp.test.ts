import { test,expect,vi } from 'vitest'
import { mkdtemp,rm,readFile,stat,readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/mcp/server.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createMcpOperations } from '../src/standalone/mcp-service.js'
import { backupHome,restoreHome } from '../src/standalone/maintenance.js'
import { startStandalone } from '../src/standalone/server.js'
import { startFakeProvider,sourceText } from './fixtures/standalone-provider.js'

test('durable deduplication, input conflicts, ambiguous outcomes and restart',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-unit-'))
 const request=vi.fn(async()=>Response.json({code:0,data:{task_id:'task_one'}}))
 const ports={home,configured:()=>true,request}
 try {
  const call=createMcpOperations(ports),args={request_id:randomUUID(),user_input:'植物'}
  const results=await Promise.all(Array.from({length:5},()=>call('betterlearn_generate_quiz',args)))
  expect(request).toHaveBeenCalledTimes(1);expect(results.every(x=>JSON.stringify(x)===JSON.stringify(results[0]))).toBe(true)
  await expect(call('betterlearn_generate_quiz',{...args,user_input:'改变'})).rejects.toThrow('CONFLICT')
  expect(await createMcpOperations(ports)('betterlearn_generate_quiz',args)).toEqual(results[0])
  request.mockRejectedValueOnce(new Error('secret-provider-key'))
  const uncertain={...args,request_id:randomUUID()}
  await expect(call('betterlearn_generate_quiz',uncertain)).rejects.toThrow('OUTCOME_UNKNOWN')
  await expect(createMcpOperations(ports)('betterlearn_generate_quiz',uncertain)).rejects.toThrow('OUTCOME_UNKNOWN')
  expect(request).toHaveBeenCalledTimes(2)
  await expect(call('betterlearn_read_quiz',{quiz_id:'../../settings.json'})).rejects.toThrow('INVALID_ARGUMENTS')
  await expect(call('betterlearn_generate_quiz',{...args,apiKey:'secret'})).rejects.toThrow('INVALID_ARGUMENTS')
 } finally {await rm(home,{recursive:true,force:true})}
})

test('real stdio MCP shares the running app, generates via own API, reads without charging and reconnects',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-real-')),fake=await startFakeProvider()
 const options={home,packageRoot:resolve('.'),pythonExecutable:resolve('.venv-phase1b/bin/python'),quizPythonExecutable:resolve('services/quiz/.venv/bin/python'),port:0}
 let app:Awaited<ReturnType<typeof startStandalone>>|undefined
 const client=new Client({name:'mcp-integration',version:'1.0'})
 try {
  app=await startStandalone(options)
  const connectionPath=join(home,'mcp-connection.json')
  expect((await stat(connectionPath)).mode&0o777).toBe(0o600)
  const connection=JSON.parse(await readFile(connectionPath,'utf8'))
  const denied=await fetch(app.url+'/api/mcp/call',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:'{}'})
  expect(denied.status).toBe(403)
  for(const [body,status] of [['{',400],['{"name":"a","name":"b"}',400],['x'.repeat(8*1024*1024+1),413]] as const) {
   const response=await fetch(app.url+'/api/mcp/call',{method:'POST',headers:{origin:app.url,authorization:`Bearer ${connection.token}`,'content-type':'application/json'},body})
   expect(response.status).toBe(status)
  }
  const cross=await fetch(app.url+'/api/mcp/call',{method:'POST',headers:{origin:'https://evil.example',authorization:`Bearer ${connection.token}`,'content-type':'application/json'},body:'{}'})
  expect(cross.status).toBe(403)
  await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/standalone/mcp.mjs'),'--home',home],stderr:'pipe'}))
  const tools=await client.listTools();expect(tools.tools).toHaveLength(17)
  expect(tools.tools.find(t=>t.name==='betterlearn_knowledge_assessment')?.annotations).toMatchObject({readOnlyHint:true,openWorldHint:false})
  for(const name of ['betterlearn_list_learning_goals','betterlearn_read_learning_goal'])expect(tools.tools.find(t=>t.name===name)?.annotations?.readOnlyHint).toBe(true)
  for(const name of ['betterlearn_create_learning_goal','betterlearn_set_learning_goal_archived'])expect(tools.tools.find(t=>t.name===name)?.annotations?.readOnlyHint).toBe(false)
  async function call(name:string,args:Record<string,unknown>={}) {
   const result=await client.callTool({name,arguments:args})
   expect(result.isError,JSON.stringify(result)).not.toBe(true)
   const text=(result.content as Array<{text:string}>)[0].text
   expect(text).not.toContain('private-mcp-key')
   return JSON.parse(text)
  }
  expect((await call('betterlearn_status')).text_model_configured).toBe(false)
  const missing=await client.callTool({name:'betterlearn_generate_quiz',arguments:{request_id:randomUUID(),user_input:'光合作用'}})
  expect(missing.isError).toBe(true);expect(fake.calls).toHaveLength(0)
  const settings=await fetch(app.url+'/api/settings',{method:'PUT',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({text:{baseUrl:fake.url,model:'fake',apiKey:'private-mcp-key'}})})
  expect(settings.status).toBe(200)
  const rejectedArgs={request_id:randomUUID(),user_input:'光合作用',doc_id:'missing_document'}
  const rejected=await client.callTool({name:'betterlearn_generate_quiz',arguments:rejectedArgs})
  expect(rejected.isError).toBe(true);expect(JSON.stringify(rejected)).toContain('REQUEST_REJECTED')
  expect(fake.calls).toHaveLength(0)
  const again=await client.callTool({name:'betterlearn_generate_quiz',arguments:rejectedArgs})
  expect(JSON.stringify(again)).toContain('REQUEST_REJECTED')
  const args={request_id:randomUUID(),user_input:'光合作用',question_count:3}
  const started=await call('betterlearn_generate_quiz',args)
  expect(await call('betterlearn_generate_quiz',args)).toEqual(started)
  let task:any
  for(let i=0;i<250;i++) {
   task=await call('betterlearn_get_task',{task_id:started.task_id})
   if(['completed','failed'].includes(task.status))break
   await new Promise(r=>setTimeout(r,100))
  }
  expect(task.status).toBe('completed');expect(fake.calls.length).toBeGreaterThan(0)
  let calls=fake.calls.length
  const history=await call('betterlearn_list_quizzes');expect(history.total).toBe(1)
  await call('betterlearn_read_quiz',{quiz_id:task.result.quiz_id})
  const desktop=await (await fetch(app.url+'/nobei/quiz/v1/user/quizzes')).json()
  expect(desktop.data.total).toBe(1)
  // Discover real Core units, generate through the shared Host codec, then
  // read source-version statistics through actual SDK stdio tools.
  async function api(path:string,body?:unknown,method=body===undefined?'GET':'POST'){
   const response=await fetch(app!.url+path,{method,headers:{origin:app!.url,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
   const value=await response.json();expect(response.ok,JSON.stringify(value)).toBe(true);return value
  }
  expect((await call('betterlearn_list_learning_books')).items).toEqual([])
  expect((await call('betterlearn_knowledge_stats')).total).toBe(0)
  expect(fake.calls.length).toBe(calls)
  const model=await api('/api/model')
  const launch=(await api('/nobei/v1/imports',{filename:'source.txt',mediaType:'text/plain',text:sourceText,modelSelection:model})).result
  for(let i=0;i<100;i++){
   const run=(await api('/nobei/v1/runs/'+launch.runId)).result
   if(run.status==='review_pending')break
   await new Promise(r=>setTimeout(r,50))
  }
  const candidate=(await api('/nobei/v1/runs/'+launch.runId+'/candidates')).result.candidates[0]
  await api('/nobei/v1/candidates/'+candidate.candidateId+'/review',{action:'accept',expectedRevision:candidate.revision,idempotencyKey:'idem_aaaaaaaaaaaaaaaaaaaa'})
  const points=(await api('/nobei/v1/runs/'+launch.runId+'/knowledge-points')).result.knowledgePoints
  const course=(await api('/nobei/v1/learning-courses',{clientBookId:'book-mcp',title:'MCP学习书',knowledgePointIds:points.map((p:any)=>p.knowledgePointId)})).result
  await api('/api/library',{books:[{bookId:'book-mcp',title:'MCP学习书',createdAt:new Date().toISOString(),sourceText,points,courseId:course.courseId}],expectedRevision:0},'PUT')
  expect((await call('betterlearn_list_learning_books')).items[0].course_id).toBe(course.courseId)
  const discovered=await call('betterlearn_read_learning_course',{course_id:course.courseId})
  const goalBody={request_id:randomUUID(),title:'学习目标',source:{courseId:discovered.course_id,unitId:discovered.units[0].unit_id},
   due_at:'2099-01-01T00:00:00Z',min_distinct_questions:3}
  const goalArgs={request_id:goalBody.request_id,title:goalBody.title,due_at:goalBody.due_at,min_distinct_questions:3,
   course_id:goalBody.source.courseId,unit_id:goalBody.source.unitId}
  const goalCalls=fake.calls.length
  const goals=await Promise.all([call('betterlearn_create_learning_goal',goalArgs),call('betterlearn_create_learning_goal',goalArgs)])
  expect(goals[0]).toEqual(goals[1])
  expect(fake.calls.length).toBe(goalCalls)
  const goal=goals[0]
  expect((await api('/nobei/quiz/v1/learning-goals',goalBody)).data).toEqual(goal)
  expect((await call('betterlearn_list_learning_goals')).total).toBe(1)
  const goalPath='/nobei/quiz/v1/learning-goals/'+goal.goal_id
  expect((await api(goalPath)).data.progress).toMatchObject({evidence_score:null,criteria_met:false,remaining_distinct_questions:3})
  const sourceArgs={request_id:randomUUID(),course_id:discovered.course_id,unit_id:discovered.units[0].unit_id,question_count:3}
  const sourceTask=await call('betterlearn_generate_source_quiz',sourceArgs)
  let sourced:any
  for(let i=0;i<100;i++){
   sourced=await call('betterlearn_get_task',{task_id:sourceTask.task_id})
   if(['completed','failed'].includes(sourced.status))break
   await new Promise(r=>setTimeout(r,50))
  }
  expect(sourced.status,JSON.stringify(sourced)).toBe('completed')
  calls=fake.calls.length
  expect(await call('betterlearn_generate_source_quiz',sourceArgs)).toEqual(sourceTask)
  const attempt=(await api('/nobei/quiz/v1/quiz/'+sourced.result.quiz_id+'/attempts',{request_id:'mcp-answer'})).data
  await api('/nobei/quiz/v1/quiz/attempts/'+attempt.attempt_id+'/submit',{expected_revision:0,
   answer_records:sourced.result.questions.map((q:any)=>({question_id:q.id,selected_answers:q.answer,duration_ms:100}))})
  const stats=await call('betterlearn_knowledge_stats')
  expect(stats.total).toBe(1);expect(stats.items[0].answer_count).toBe(3)
  const source=stats.items[0].source
  expect((await call('betterlearn_knowledge_history',{knowledge_point_id:source.knowledge_point_id,content_version:source.content_version})).total).toBe(3)
  const assessmentPath='/nobei/quiz/v1/question-bank/knowledge-assessment?'+new URLSearchParams({knowledge_point_id:source.knowledge_point_id,content_version:source.content_version})
  const assessment=(await api(assessmentPath)).data
  expect(assessment).toMatchObject({policy_version:'distinct_first_v1',answer_count:3,distinct_question_count:3,
   evidence_score:1,window_count:3,small_sample_cap:1,evidence_state:'available',first_accuracy:100,latest_accuracy:100})
  const assessmentArgs={knowledge_point_id:source.knowledge_point_id,content_version:source.content_version}
  expect(await call('betterlearn_knowledge_assessment',assessmentArgs)).toEqual(assessment)
  expect(assessment.basis).toHaveLength(3)
  expect(assessment.source).not.toHaveProperty('evidence')
  expect(JSON.stringify(assessment)).not.toContain('private-mcp-key')
  expect((await api(goalPath)).data.progress).toMatchObject({evidence_score:1,criteria_met:true,remaining_distinct_questions:0})
  expect((await call('betterlearn_read_learning_goal',{goal_id:goal.goal_id})).progress).toMatchObject({criteria_met:true,evidence_score:1})
  const archiveArgs={goal_id:goal.goal_id,expected_revision:0,archived:true}
  const archivedGoal=await call('betterlearn_set_learning_goal_archived',archiveArgs)
  expect(await call('betterlearn_set_learning_goal_archived',archiveArgs)).toEqual(archivedGoal)
  expect((await call('betterlearn_list_learning_goals')).total).toBe(0)
  expect((await call('betterlearn_list_learning_goals',{status:'archived'})).items[0]).toEqual(archivedGoal)
  const archiveConflict=await client.callTool({name:'betterlearn_set_learning_goal_archived',arguments:{...archiveArgs,archived:false}})
  expect(archiveConflict.isError).toBe(true);expect(JSON.stringify(archiveConflict)).toContain('GOAL_CONFLICT')
  await api('/nobei/v1/learning-courses/'+discovered.course_id,undefined,'DELETE')
  expect((await api('/nobei/quiz/v1/learning-goals',goalBody)).data).toEqual(archivedGoal)
  expect(await call('betterlearn_create_learning_goal',goalArgs)).toEqual(archivedGoal)
  const conflict=await fetch(app.url+'/nobei/quiz/v1/learning-goals',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({...goalBody,title:'changed'})})
  expect(conflict.status).toBe(409)

  // Real Host -> Quiz: paper snapshots remain usable after Core deletion.
  const paperRequest={request_id:randomUUID(),title:'来源综合自测',duration_seconds:600,
   allocations:[{...assessmentArgs,count:3}]}
  const {request_id:paperRequestId,...paperPreview}=paperRequest
  expect((await api('/nobei/quiz/v1/exam-papers/preview',paperPreview)).data.ready).toBe(true)
  let paper=(await api('/nobei/quiz/v1/exam-papers',paperRequest)).data
  expect((await api('/nobei/quiz/v1/exam-papers',{...paperPreview,request_id:paperRequestId})).data).toEqual(paper)
  const paperPath='/nobei/quiz/v1/exam-papers/'+paper.paper_id
  paper=(await api(paperPath+'/review',{expected_revision:0,reviews:paper.items.map((i:any)=>({question_id:i.question.id,approved:true,note:'已核对'}))},'PUT')).data
  const examStart={request_id:randomUUID(),expected_revision:paper.revision}
  const exam=(await api(paperPath+'/sessions',examStart)).data
  const examPath='/nobei/quiz/v1/exam-sessions/'+exam.session_id
  expect(exam.status).toBe('running')
  expect(exam.questions.every((q:any)=>!('answer' in q)&&!('explanation' in q))).toBe(true)
  const examAnswers=paper.items.map((i:any)=>({question_id:i.question.id,selected_answers:i.question.answer,duration_ms:100}))
  const examDraft=(await api(examPath+'/answers',{expected_revision:0,answer_records:examAnswers.slice(0,1)},'PUT')).data
  expect(examDraft.revision).toBe(1)

  expect(fake.calls.length).toBe(calls)
  await app.close();app=undefined
  await expect(readFile(connectionPath)).rejects.toThrow()
  const offline=await client.callTool({name:'betterlearn_status',arguments:{}});expect(offline.isError).toBe(true)
  app=await startStandalone(options)
  expect(JSON.parse(await readFile(connectionPath,'utf8')).token).not.toBe(connection.token)
  expect(await call('betterlearn_generate_quiz',args)).toEqual(started)
  expect(await call('betterlearn_generate_source_quiz',sourceArgs)).toEqual(sourceTask)
  expect((await call('betterlearn_list_quizzes')).total).toBe(2)
  expect((await api(assessmentPath)).data).toEqual(assessment)
  expect(await call('betterlearn_knowledge_assessment',assessmentArgs)).toEqual(assessment)
  expect((await api('/nobei/quiz/v1/learning-goals',goalBody)).data).toEqual(archivedGoal)
  expect(await call('betterlearn_create_learning_goal',goalArgs)).toEqual(archivedGoal)
  expect((await call('betterlearn_read_learning_goal',{goal_id:goal.goal_id})).archived).toBe(true)
  expect((await api(examPath)).data).toEqual(examDraft)
  expect((await api(paperPath+'/sessions',examStart)).data).toEqual(examDraft)
  expect(fake.calls.length).toBe(calls)
  await app.close();app=undefined
  await backupHome(home,home+'-backup',options.pythonExecutable)
  await restoreHome(home+'-backup',home+'-restored',options.pythonExecutable)
  app=await startStandalone({...options,home:home+'-restored'})
  expect((await api('/nobei/quiz/v1/learning-goals',goalBody)).data).toEqual(archivedGoal)
  expect((await api(goalPath)).data.progress).toMatchObject({criteria_met:true,distinct_question_count:3})
  expect((await api('/nobei/quiz/v1/learning-goals?status=all')).data.total).toBe(1)
  expect((await api(examPath)).data).toEqual(examDraft)
  const examSubmission={expected_revision:1,answer_records:examAnswers}
  const examResult=(await api(examPath+'/submit',examSubmission)).data
  expect(examResult.result).toMatchObject({accuracy:100,correct_count:3,unanswered_count:0,xp_gain:0})
  expect((await api(examPath+'/submit',examSubmission)).data).toEqual(examResult)
  expect((await api('/nobei/quiz/v1/question-bank/knowledge-assessment?'+new URLSearchParams(assessmentArgs))).data).toMatchObject({answer_count:6,distinct_question_count:3,evidence_score:1})
  expect((await api('/nobei/quiz/v1/exam-sessions')).data.total).toBe(1)
  expect(fake.calls.length).toBe(calls)
 } finally {await client.close();await app?.close();await fake.close();await Promise.all([home,home+'-backup',home+'-restored'].map(path=>rm(path,{recursive:true,force:true})))}
},90000)

test('rejections persist across restart; corrected new IDs work while ambiguous failures remain blocked',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-reject-'))
 const request=vi.fn(async()=>new Response('private-provider-error',{status:404}))
 const ports={home,configured:()=>true,request}
 try {
  const args={request_id:randomUUID(),user_input:'test'}
  await expect(createMcpOperations(ports)('betterlearn_generate_quiz',args)).rejects.toThrow('REQUEST_REJECTED (404)')
  expect(JSON.parse(await readFile(join(home,'mcp-requests',args.request_id+'.json'),'utf8')).status).toBe('rejected')
  await expect(createMcpOperations(ports)('betterlearn_generate_quiz',args)).rejects.toThrow('REQUEST_REJECTED')
  expect(request).toHaveBeenCalledTimes(1)
  request.mockImplementationOnce(async()=>Response.json({code:0,data:{task_id:'task_fixed'}}))
  await expect(createMcpOperations(ports)('betterlearn_generate_quiz',{...args,request_id:randomUUID()})).resolves.toMatchObject({task_id:'task_fixed'})
  for(const response of [new Response('',{status:500}),new Response('',{status:408}),new Response('broken JSON',{status:200})]) {
   request.mockImplementationOnce(async()=>response)
   const uncertain={...args,request_id:randomUUID()}
   await expect(createMcpOperations(ports)('betterlearn_generate_quiz',uncertain)).rejects.toThrow('OUTCOME_UNKNOWN')
   const count=request.mock.calls.length
   await expect(createMcpOperations(ports)('betterlearn_generate_quiz',uncertain)).rejects.toThrow('OUTCOME_UNKNOWN')
   expect(request).toHaveBeenCalledTimes(count)
  }
 }finally{await rm(home,{recursive:true,force:true})}
})

test('learning MCP reads and source generation preserve durable cross-tool deduplication',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-learning-'))
 const courseId='course_'+'1'.repeat(20),unitId='unit_'+'1'.repeat(20)
 const learningCourse=vi.fn(async()=>({courseId,status:'active',title:'课程',units:[{unitId,knowledgePointId:'kp_'+'1'.repeat(20),type:'concept',title:'知识',
  lesson:{explanation:'陈述'},evidence:{kind:'summary',text:'证据'}}]}))
 const request=vi.fn(async(path:string,init?:RequestInit)=>path.startsWith('/quiz/source-request/')
  ?Response.json({code:4040},{status:404})
  :Response.json({code:0,data:init?.method==='POST'?{task_id:'task_source'}:{items:[],total:0}}))
 const ports={home,configured:()=>true,request,learningCourse:learningCourse as any,
  learningBooks:async()=>({books:[{bookId:'book-one',title:'课程',courseId,private:'omit'}]})}
 try{
  const call=createMcpOperations(ports)
  expect(await call('betterlearn_list_learning_books',{})).toEqual({items:[{book_id:'book-one',title:'课程',course_id:courseId}]})
  const course:any=await call('betterlearn_read_learning_course',{course_id:courseId})
  expect(course.units[0].unit_id).toBe(unitId)
  await call('betterlearn_knowledge_stats',{knowledge_point_id:'kp_'+'1'.repeat(20)})
  expect(request.mock.calls.at(-1)?.[0]).toContain('/question-bank/knowledge-stats?')
  await expect(call('betterlearn_knowledge_stats',{content_version:'a'.repeat(64)})).rejects.toThrow('INVALID_ARGUMENTS')
  const args={request_id:randomUUID(),course_id:courseId,unit_id:unitId}
  const results=await Promise.all([call('betterlearn_generate_source_quiz',args),call('betterlearn_generate_source_quiz',args)])
  expect(results[0]).toEqual(results[1])
  expect(request.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1)
  const sent=JSON.parse(request.mock.calls.find(([,init])=>init?.method==='POST')![1]!.body as string)
  expect(sent.source.knowledge_point_id).toBe('kp_'+'1'.repeat(20))
  expect(sent.generate_images).toBe(false)
  await expect(call('betterlearn_generate_quiz',{request_id:args.request_id,user_input:'topic'})).rejects.toThrow('CONFLICT')
  expect(await createMcpOperations(ports)('betterlearn_generate_source_quiz',args)).toEqual(results[0])
  await expect(call('betterlearn_generate_source_quiz',{...args,source:{}})).rejects.toThrow('INVALID_ARGUMENTS')
 }finally{await rm(home,{recursive:true,force:true})}
})

test('source generation ambiguous dispatch stays blocked across MCP restart without new provider dispatch',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-source-unknown-'))
 const request=vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.startsWith('/quiz/source-request/'))return Response.json({code:4040},{status:404})
  if(init?.method==='POST')throw new Error('private-upstream-secret')
  return Response.json({code:0,data:{}})
 })
 const courseId='course_'+'a'.repeat(20),unitId='unit_'+'b'.repeat(20)
 const ports={home,configured:()=>true,request,learningCourse:async()=>({courseId,status:'active',units:[{
  unitId,knowledgePointId:'kp_'+'c'.repeat(20),title:'来源',type:'concept',lesson:{explanation:'陈述'},evidence:{kind:'summary',text:'摘要'}}]}) as any}
 const args={request_id:randomUUID(),course_id:courseId,unit_id:unitId}
 try {
  await expect(createMcpOperations(ports)('betterlearn_generate_source_quiz',args)).rejects.toThrow('REQUEST_OUTCOME_UNKNOWN')
  const count=request.mock.calls.length
  await expect(createMcpOperations(ports)('betterlearn_generate_source_quiz',args)).rejects.toThrow('REQUEST_OUTCOME_UNKNOWN')
  expect(request).toHaveBeenCalledTimes(count)
  const record=JSON.parse(await readFile(join(home,'mcp-requests',args.request_id+'.json'),'utf8'))
  expect(record.status).toBe('dispatching')
  expect(JSON.stringify(record)).not.toContain('private-upstream-secret')
 }finally{await rm(home,{recursive:true,force:true})}
})

test('source preparation failure does not dispatch or create an uncertain MCP journal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-source-prepare-'))
 const request=vi.fn(async()=>Response.json({code:4040},{status:404}))
 const ports={home,configured:()=>true,request,learningCourse:async()=>{throw new Error('private Core error')}}
 const args={request_id:randomUUID(),course_id:'course_'+'a'.repeat(20),unit_id:'unit_'+'b'.repeat(20)}
 try {
  await expect(createMcpOperations(ports)('betterlearn_generate_source_quiz',args)).rejects.toThrow('SOURCE_PREPARATION_FAILED')
  expect(request).toHaveBeenCalledTimes(1)
  await expect(readFile(join(home,'mcp-requests',args.request_id+'.json'))).rejects.toMatchObject({code:'ENOENT'})
  await expect(createMcpOperations({...ports,configured:()=>false})('betterlearn_generate_source_quiz',args)).rejects.toThrow('MODEL_NOT_CONFIGURED')
  expect(request).toHaveBeenCalledTimes(1)
 }finally{await rm(home,{recursive:true,force:true})}
})


test('knowledge assessment MCP is strict, readonly without a model, and preserves null versus zero',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-assessment-'))
 const args={knowledge_point_id:'kp_'+'a'.repeat(20),content_version:'b'.repeat(64)}
 const request=vi.fn(async()=>Response.json({code:0,data:{evidence_score:null,basis:[]}}))
 const configured=vi.fn(()=>false)
 const call=createMcpOperations({home,configured,request})
 try{
  expect(await call('betterlearn_knowledge_assessment',args)).toEqual({evidence_score:null,basis:[]})
  expect(request.mock.calls[0]).toEqual(['/question-bank/knowledge-assessment?'+new URLSearchParams(args),undefined])
  request.mockImplementationOnce(async()=>Response.json({code:0,data:{evidence_score:0,basis:[{is_correct:false}]}}))
  expect(await call('betterlearn_knowledge_assessment',args)).toEqual({evidence_score:0,basis:[{is_correct:false}]})
  for(const invalid of [{},{knowledge_point_id:args.knowledge_point_id},{content_version:args.content_version},
   {...args,knowledge_point_id:'../../private'}, {...args,content_version:'bad'}, {...args,page:1}, {...args,page_size:1},
   {...args,user_id:2},{...args,source:{}},{...args,request_id:randomUUID()}]){
   await expect(call('betterlearn_knowledge_assessment',invalid)).rejects.toThrow('INVALID_ARGUMENTS')
  }
  expect(request).toHaveBeenCalledTimes(2)
  expect(configured).not.toHaveBeenCalled()
  expect(await readdir(home)).toEqual([])
  request.mockImplementationOnce(async()=>new Response('private-provider-secret',{status:500}))
  await expect(call('betterlearn_knowledge_assessment',args)).rejects.toThrow(/^BETTERLEARN_OPERATION_FAILED$/)
 }finally{await rm(home,{recursive:true,force:true})}
})


test('official SDK rejects unknown fields before any tool callback',async()=>{
 const invoked=vi.fn(async()=>({evidence_score:null}))
 const server=createMcpServer(invoked)
 const client=new Client({name:'mcp-strict-input',version:'1.0'})
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair()
 try{
  await Promise.all([server.connect(serverTransport),client.connect(clientTransport)])
  const point={knowledge_point_id:'kp_'+'a'.repeat(20),content_version:'b'.repeat(64)}
  for(const extra of [{page:1},{user_id:2},{source:{}},{request_id:randomUUID()}]){
   const result=await client.callTool({name:'betterlearn_knowledge_assessment',arguments:{...point,...extra}})
   expect(result.isError).toBe(true)
  }
  for(const [name,args] of [
   ['betterlearn_list_learning_goals',{user_id:2}],
   ['betterlearn_read_learning_goal',{goal_id:'goal_'+'a'.repeat(32),page:1}],
   ['betterlearn_create_learning_goal',{request_id:randomUUID(),title:'目标',course_id:'course_'+'a'.repeat(20),unit_id:'unit_'+'b'.repeat(20),due_at:'2099-01-01T00:00:00Z',source:{}}],
   ['betterlearn_set_learning_goal_archived',{goal_id:'goal_'+'a'.repeat(32),expected_revision:0,archived:true,title:'edit'}],
   ['betterlearn_status',{user_id:2}],
   ['betterlearn_generate_quiz',{request_id:randomUUID(),user_input:'topic',generate_images:true}],
   ['betterlearn_generate_source_quiz',{request_id:randomUUID(),course_id:'course_'+'a'.repeat(20),unit_id:'unit_'+'b'.repeat(20),source:{}}],
  ] as const){
   expect((await client.callTool({name,arguments:args})).isError).toBe(true)
  }
  expect(invoked).not.toHaveBeenCalled()
  expect((await client.callTool({name:'betterlearn_knowledge_assessment',arguments:point})).isError).not.toBe(true)
  expect(invoked).toHaveBeenCalledTimes(1)
 }finally{await client.close();await server.close()}
})


test('goal MCP adapters validate input, need no model and never write generation journals',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-goals-'))
 const snapshot=JSON.parse(await readFile(resolve('contracts/quiz-source-v1.json'),'utf8'))
 const goalId='goal_'+'a'.repeat(32)
 const configured=vi.fn(()=>false)
 const learningCourse=vi.fn(async()=>({courseId:snapshot.course_id,status:'active',units:[{
  unitId:snapshot.unit_id,knowledgePointId:snapshot.knowledge_point_id,type:snapshot.type,title:snapshot.title,
  lesson:{explanation:snapshot.statement},evidence:snapshot.evidence}]}))
 let stored:any
 const request=vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.startsWith('/learning-goals/request/'))return stored?Response.json({code:0,data:{request:stored}}):Response.json({code:4040},{status:404})
  if(init?.method==='POST')stored=JSON.parse(init.body as string)
  return Response.json({code:0,data:{goal_id:goalId,revision:1,archived:true,progress:{evidence_score:null},items:[],total:0}})
 })
 const ports={home,configured,request,learningCourse:learningCourse as any}
 const call=createMcpOperations(ports)
 const args={request_id:randomUUID(),course_id:snapshot.course_id,unit_id:snapshot.unit_id,title:'  目标  ',due_at:'2099-01-01T08:00:00+08:00'}
 try{
  await call('betterlearn_list_learning_goals',{})
  expect(request.mock.calls.at(-1)?.[0]).toBe('/learning-goals?page=1&page_size=20&status=active')
  expect(await call('betterlearn_read_learning_goal',{goal_id:goalId})).toMatchObject({progress:{evidence_score:null}})
  const first=await call('betterlearn_create_learning_goal',args)
  expect(stored).toMatchObject({source:snapshot,title:'目标',target_percent:90,min_distinct_questions:5,due_at:'2099-01-01T00:00:00.000Z'})
  learningCourse.mockRejectedValue(new Error('private-deleted'))
  expect(await createMcpOperations(ports)('betterlearn_create_learning_goal',args)).toEqual(first)
  expect(learningCourse).toHaveBeenCalledTimes(1)
  await call('betterlearn_set_learning_goal_archived',{goal_id:goalId,expected_revision:0,archived:false})
  expect(JSON.parse(request.mock.calls.at(-1)![1]!.body as string)).toEqual({expected_revision:0,archived:false})
  const before=request.mock.calls.length
  for(const [name,invalid] of [
   ['betterlearn_list_learning_goals',{user_id:2}], ['betterlearn_list_learning_goals',{page_size:51}],
   ['betterlearn_read_learning_goal',{goal_id:'../escape'}], ['betterlearn_create_learning_goal',{...args,source:snapshot}],
   ['betterlearn_create_learning_goal',{...args,target_percent:101}], ['betterlearn_create_learning_goal',{...args,min_distinct_questions:2}],
   ['betterlearn_set_learning_goal_archived',{goal_id:goalId,expected_revision:true,archived:true}],
   ['betterlearn_set_learning_goal_archived',{goal_id:goalId,expected_revision:0,archived:'true'}],
  ] as const)await expect(call(name,invalid)).rejects.toThrow('INVALID_ARGUMENTS')
  await expect(call('betterlearn_create_learning_goal',{...args,due_at:'2099-02-30T00:00:00Z'})).rejects.toThrow('GOAL_PREPARATION_FAILED')
  expect(request).toHaveBeenCalledTimes(before)
  expect(configured).not.toHaveBeenCalled()
  expect(await readdir(home)).toEqual([])
 }finally{await rm(home,{recursive:true,force:true})}
})

test('goal MCP uncertain writes never retry or adjust request IDs and revisions',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-goal-errors-'))
 const snapshot=JSON.parse(await readFile(resolve('contracts/quiz-source-v1.json'),'utf8'))
 const args={request_id:randomUUID(),course_id:snapshot.course_id,unit_id:snapshot.unit_id,title:'目标',due_at:'2099-01-01T00:00:00Z'}
 const request=vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.startsWith('/learning-goals/request/'))return Response.json({code:0,data:{request:{source:snapshot}}})
  throw new Error('private-transport-key')
 })
 const ports={home,configured:()=>false,request}
 try{
  await expect(createMcpOperations(ports)('betterlearn_create_learning_goal',args)).rejects.toThrow('GOAL_RESULT_UNKNOWN')
  expect(request).toHaveBeenCalledTimes(2)
  request.mockImplementationOnce(async()=>new Response('private-upstream-message',{status:409}))
  const archive={goal_id:'goal_'+'a'.repeat(32),expected_revision:7,archived:true}
  await expect(createMcpOperations(ports)('betterlearn_set_learning_goal_archived',archive)).rejects.toThrow(/^GOAL_CONFLICT/)
  expect(JSON.parse(request.mock.calls.at(-1)![1]!.body as string).expected_revision).toBe(7)
  request.mockImplementationOnce(async()=>new Response('private-upstream-message',{status:500}))
  await expect(createMcpOperations(ports)('betterlearn_set_learning_goal_archived',archive)).rejects.toThrow('GOAL_RESULT_UNKNOWN')
  expect(request).toHaveBeenCalledTimes(4)
  request.mockImplementationOnce(async()=>new Response('private-upstream-message',{status:404}))
  await expect(createMcpOperations(ports)('betterlearn_read_learning_goal',{goal_id:archive.goal_id})).rejects.toThrow(/^GOAL_NOT_FOUND$/)
  expect(await readdir(home)).toEqual([])
 }finally{await rm(home,{recursive:true,force:true})}
})


test('goal MCP preparation failure cannot dispatch and lost create response can replay the same request',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-goal-replay-'))
 const snapshot=JSON.parse(await readFile(resolve('contracts/quiz-source-v1.json'),'utf8'))
 const args={request_id:randomUUID(),course_id:snapshot.course_id,unit_id:snapshot.unit_id,title:'目标',due_at:'2099-01-01T00:00:00Z'}
 const learningCourse=vi.fn(async()=>{throw new Error('private-Core-error')})
 let stored:any,posts=0
 const goal={goal_id:'goal_'+'a'.repeat(32),archived:false,revision:0}
 const request=vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.startsWith('/learning-goals/request/'))return stored?Response.json({code:0,data:{request:stored}}):Response.json({code:4040},{status:404})
  posts++
  stored=JSON.parse(init!.body as string)
  if(posts===1)throw new Error('response lost after save')
  return Response.json({code:0,data:goal})
 })
 const ports={home,configured:()=>false,request,learningCourse}
 try{
  await expect(createMcpOperations(ports)('betterlearn_create_learning_goal',args)).rejects.toThrow('GOAL_PREPARATION_FAILED')
  expect(posts).toBe(0)
  // Simulate an already accepted request found by the private lookup; no Core needed.
  stored={source:snapshot}
  await expect(createMcpOperations(ports)('betterlearn_create_learning_goal',args)).rejects.toThrow('GOAL_RESULT_UNKNOWN')
  expect(posts).toBe(1)
  expect(await createMcpOperations(ports)('betterlearn_create_learning_goal',args)).toEqual(goal)
  expect(posts).toBe(2)
  expect(stored.request_id).toBe(args.request_id)
  expect(learningCourse).toHaveBeenCalledTimes(1)
  expect(await readdir(home)).toEqual([])
 }finally{await rm(home,{recursive:true,force:true})}
})
