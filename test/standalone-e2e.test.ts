import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { test,expect } from 'vitest'
import { startStandalone } from '../src/standalone/server.js'
import { startFakeProvider,sourceText } from './fixtures/standalone-provider.js'
import { backupHome,restoreHome } from '../src/standalone/maintenance.js'
const delay=()=>new Promise(r=>setTimeout(r,100))
test('real services independently run extraction, library, RAG quiz, report and restore',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bl-e2e-'));const home=join(root,'home');const fake=await startFakeProvider()
 const options={home,packageRoot:resolve('.'),pythonExecutable:resolve('.venv-phase1b/bin/python'),quizPythonExecutable:resolve('services/quiz/.venv/bin/python'),port:0}
 let app:Awaited<ReturnType<typeof startStandalone>>|undefined
 try{
  app=await startStandalone(options)
  async function request(path:string,body?:unknown,method=body===undefined?'GET':'POST'){
   const response=await fetch(app!.url+path,{method,headers:{origin:app!.url,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)})
   const value=await response.json();expect(response.status,JSON.stringify(value)).toBeLessThan(300);return value
  }
  await request('/api/settings',{text:{baseUrl:fake.url,model:'fake',apiKey:'fake'},embedding:{baseUrl:fake.url,model:'fake-embedding',apiKey:'fake'}},'PUT')
  const selection=await request('/api/model')
  const launch=(await request('/nobei/v1/imports',{filename:'植物.txt',mediaType:'text/plain',text:sourceText,modelSelection:selection})).result
  let run:any
  for(let i=0;i<100;i++){run=(await request(`/nobei/v1/runs/${launch.runId}`)).result;if(!['awaiting_generation','generating','validating'].includes(run.status))break;await delay()}
  expect(run.status).toBe('review_pending')
  const candidate=(await request(`/nobei/v1/runs/${launch.runId}/candidates`)).result.candidates[0]
  await request(`/nobei/v1/candidates/${candidate.candidateId}/review`,{action:'accept',expectedRevision:candidate.revision,idempotencyKey:'idem_aaaaaaaaaaaaaaaaaaaa'})
  const points=(await request(`/nobei/v1/runs/${launch.runId}/knowledge-points`)).result.knowledgePoints
  expect(points).toHaveLength(1)
  const book={bookId:'book-web',title:'植物学习书',createdAt:new Date().toISOString(),sourceText,points}
  await request('/api/library',{books:[book]},'PUT')
  const course=(await request('/nobei/v1/learning-courses',{clientBookId:book.bookId,title:book.title,knowledgePointIds:points.map((p:any)=>p.knowledgePointId)})).result
  expect(course.courseId).toBeTruthy()
  const session=await request('/nobei/quiz/v1/session',undefined,'POST');expect(session.code).toBe(0)
  const form=new FormData();form.append('file',new Blob([sourceText],{type:'text/plain'}),'植物.txt')
  const uploaded=await (await fetch(app.url+'/nobei/quiz/v1/knowledge/documents',{method:'POST',headers:{origin:app.url},body:form})).json()
  expect(uploaded.code,JSON.stringify(uploaded)).toBe(0);const docId=uploaded.data.doc_id
  let doc:any;for(let i=0;i<250;i++){doc=(await request(`/nobei/quiz/v1/knowledge/documents/${docId}`)).data;if(doc.status!=='processing')break;await delay()}
  expect(doc.status,JSON.stringify(doc)).toBe('ready')
  const preview=(await request('/nobei/v1/knowledge-base/preview',{docIds:[docId]})).result;expect(preview.text).toContain(sourceText)
  const generated=await request('/nobei/quiz/v1/quiz/generate/async',{user_input:'光合作用',question_count:3,doc_id:docId,generate_images:false})
  let task:any;for(let i=0;i<250;i++){task=(await request(`/nobei/quiz/v1/quiz/task/${generated.data.task_id}`)).data;if(['completed','failed'].includes(task.status))break;await delay()}
  expect(task.status,JSON.stringify(task)).toBe('completed');const quiz=task.result
  const records=quiz.questions.map((q:any)=>({question_id:q.id,selected_answers:q.answer,is_correct:true,duration_ms:1000}))
  const report=await request('/nobei/quiz/v1/report/generate',{quiz_id:quiz.quiz_id,topic:quiz.title,questions:quiz.questions,answer_records:records})
  expect(report.data.accuracy).toBe(100)
  const calls=fake.calls.length
  await request('/nobei/quiz/v1/report/generate',{quiz_id:quiz.quiz_id,topic:quiz.title,questions:quiz.questions,answer_records:records})
  expect(fake.calls.length).toBe(calls)
  await app.close();app=undefined
  const backup=join(root,'backup'),restored=join(root,'restored');await backupHome(home,backup,options.pythonExecutable);await restoreHome(backup,restored,options.pythonExecutable)
  app=await startStandalone({...options,home:restored})
  expect((await request('/api/library')).books[0].title).toBe(book.title)
  expect((await request('/nobei/quiz/v1/user/quizzes')).data.total).toBe(1)
  expect((await request(`/nobei/quiz/v1/user/quizzes/${quiz.quiz_id}`)).data.report.accuracy).toBe(100)
  expect(fake.calls.length).toBe(calls)
 }finally{await app?.close();await fake.close();await rm(root,{recursive:true,force:true})}
},90000)
