import { SourceOperations } from '../src/client/quiz/services/source-operations.js'
import { ExamOperations } from '../src/client/quiz/services/exam-operations.js'
import { test, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startStandalone } from '../src/standalone/server.js'
import { startFakeProvider, sourceText } from './fixtures/standalone-provider.js'
import { createQuizApi } from '../src/client/quiz/services/api.js'
import { createReviewApi } from '../src/client/quiz/services/review-api.js'
import { GoalSession } from '../src/client/quiz/services/goal-session.js'
import { ReviewSession } from '../src/client/quiz/services/review-session.js'
import { PracticeController, newPractice } from '../src/client/quiz/services/practice.js'

test('browser adapter and controller persist drafts across host restart, grade without AI and request reports explicitly',async()=>{
 const home=await mkdtemp(join(tmpdir(),'practice-frontend-'));const fake=await startFakeProvider()
 const options={home,packageRoot:resolve('.'),pythonExecutable:resolve('.venv-phase1b/bin/python'),quizPythonExecutable:resolve('services/quiz/.venv/bin/python'),port:0}
 let app:Awaited<ReturnType<typeof startStandalone>>|undefined
 try {
  app=await startStandalone(options)
  expect((await fetch(app.url+'/api/settings',{method:'PUT',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({text:{baseUrl:fake.url,model:'fake',apiKey:'fake-only'}})})).status).toBe(200)
  const makeApi=()=>createQuizApi({baseUrl:app!.url+'/nobei/quiz/v1',fetch:(url,init)=>fetch(url,{...init,headers:{...init?.headers,origin:app!.url}})})
  let api=makeApi();await api.connect()
  const generated=await api.generateQuiz({source:{kind:'topic',text:'光合作用'},questionCount:3,difficulty:'easy',generateImages:false})
  let task=await api.getTask(generated.task_id)
  for(let i=0;i<250 && (task.status==='pending'||task.status==='running');i++){await new Promise(r=>setTimeout(r,100));task=await api.getTask(generated.task_id)}
  expect(task.status).toBe('completed');const quiz=task.result!
  const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}}
  const p=new PracticeController(api,storage,quiz.quiz_id);await p.load()
  expect(p.state.error).toBe('');const first=quiz.questions[0]
  await p.answer({question_id:first.id,selected_answers:first.answer,duration_ms:100})
  expect(p.state.error).toBe('');const id=p.state.attempt!.attempt_id
  const calls=fake.calls.length
  await app.close();app=await startStandalone(options);api=makeApi();await api.connect()
  const reopened=new PracticeController(api,storage,quiz.quiz_id);await reopened.load()
  expect(reopened.state.attempt?.attempt_id).toBe(id);expect(reopened.state.attempt?.answer_records).toHaveLength(1)
  for(const q of quiz.questions.slice(1)) await reopened.answer({question_id:q.id,selected_answers:q.answer,duration_ms:100})
  await reopened.submit()
  expect(reopened.state.error).toBe('');expect(reopened.state.attempt).toMatchObject({status:'submitted',accuracy:100,xp_gain:16,report_status:'not_requested'})
  expect(fake.calls.length).toBe(calls)
  const saved=structuredClone(reopened.state.attempt!)
  await reopened.generateReport()
  expect(reopened.state.error).toBe('');expect(reopened.state.attempt?.report_status).toBe('completed')
  expect(fake.calls.length).toBeGreaterThan(calls)
  expect(reopened.state.attempt).toMatchObject({accuracy:saved.accuracy,xp_gain:saved.xp_gain,submitted_at:saved.submitted_at})
  const again=newPractice(api,storage,quiz.quiz_id);await again.load()
  for(const q of quiz.questions) await again.answer({question_id:q.id,selected_answers:q.answer,duration_ms:100})
  await again.submit();expect(again.state.attempt?.xp_gain).toBe(0)
  expect((await api.listAttempts(quiz.quiz_id)).items).toHaveLength(2)
  expect((await api.getHistory()).items[0]).toMatchObject({status:'submitted',attempt_id:again.state.attempt?.attempt_id})
  // Browser bank adapter: wrong/latest semantics, literal search, organizing and immutable history.
  const bankCalls=fake.calls.length
  const wrong=await api.createAttempt(quiz.quiz_id,'wrong-round')
  await api.submitAttempt(wrong.attempt_id,{expected_revision:wrong.revision,answer_records:quiz.questions.map(q=>({question_id:q.id,selected_answers:['B'],duration_ms:200}))})
  expect((await api.getBankEntries({scope:'wrong'})).total).toBe(3)
  expect((await api.getBankEntries({search:'%_'})).total).toBe(0)
  const entry=(await api.getBankEntries()).items[0]
  const category=await api.createBankCategory('待复习')
  await api.setBankBookmark(entry.id,true);await api.setBankCategory(entry.id,category.id,true)
  expect((await api.getBankEntries({scope:'bookmarked',category_id:category.id})).items[0].id).toBe(entry.id)
  expect((await api.getBankHistory(entry.id)).items[0]).toMatchObject({attempt_id:wrong.attempt_id,is_correct:false})
  await api.renameBankCategory(category.id,'重点');expect((await api.getBankCategories()).items[0].name).toBe('重点')
  const corrected=await api.createAttempt(quiz.quiz_id,'corrected-round')
  await api.submitAttempt(corrected.attempt_id,{expected_revision:corrected.revision,answer_records:quiz.questions.map(q=>({question_id:q.id,selected_answers:q.answer,duration_ms:200}))})
  expect((await api.getBankStats())).toMatchObject({wrong:0,ever_wrong:3,bookmarked:1})
  await api.deleteBankCategory(category.id)
  expect((await api.getBankEntry(entry.id)).categories).toEqual([])
  expect((await api.getBankHistory(entry.id)).total).toBe(4)
  expect(fake.calls.length).toBe(bankCalls)

  async function core(path:string,body?:unknown){
    const response=await fetch(app!.url+path,{method:body===undefined?'GET':'POST',headers:{origin:app!.url,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
    const data=await response.json();expect(response.ok,JSON.stringify(data)).toBe(true);return data
  }
  const selection=await core('/api/model')
  const launch=(await core('/nobei/v1/imports',{filename:'review.txt',mediaType:'text/plain',text:sourceText,modelSelection:selection})).result
  for(let i=0;i<100;i++){if((await core('/nobei/v1/runs/'+launch.runId)).result.status==='review_pending')break;await new Promise(r=>setTimeout(r,50))}
  const candidate=(await core('/nobei/v1/runs/'+launch.runId+'/candidates')).result.candidates[0]
  await core('/nobei/v1/candidates/'+candidate.candidateId+'/review',{action:'accept',expectedRevision:candidate.revision,idempotencyKey:'idem_cccccccccccccccccccc'})
  const points=(await core('/nobei/v1/runs/'+launch.runId+'/knowledge-points')).result.knowledgePoints
  const course=(await core('/nobei/v1/learning-courses',{clientBookId:'book-review',title:'复习测试',knowledgePointIds:points.map((p:any)=>p.knowledgePointId)})).result
  const assessment=course.units[0].check.main
  await core('/nobei/v1/learning-assessments/'+assessment.assessmentId+'/attempts',{optionId:assessment.options.find((o:any)=>o.label!==points[0].statement).optionId,idempotencyKey:'idem_dddddddddddddddddddd'})
  const reviewApi=createReviewApi({baseUrl:app!.url+'/nobei/v1',fetch:(url,init)=>fetch(url,{...init,headers:{...init?.headers,origin:app!.url}})})
  const reviewCalls=fake.calls.length
  const due=await reviewApi.queue();expect(due.total).toBe(1);expect(due.items[0].phase).toBe('remediation')
  expect(due.items[0].assessment.attempt).toBeNull()
  const review=new ReviewSession(reviewApi,storage)
  await review.submit(due.items[0],due.items[0].assessment.options.find(o=>o.label===points[0].statement)!.optionId)
  expect(review.state.error).toBe('');expect(review.state.result?.attempt.correct).toBe(true)
  expect(review.state.result?.course.units[0].mastery.dueAt).toBeTruthy();expect((await reviewApi.queue()).total).toBe(0)
  expect(fake.calls.length).toBe(reviewCalls)

  // Goal controller replays a lost creation response and consumes only trusted evidence.
  const goalCalls=fake.calls.length
  const lost=new GoalSession({...api,createGoal:async input=>{await api.createGoal(input);throw Error('lost response')}},storage)
  await lost.create({title:'光合作用目标',source:{courseId:course.courseId,unitId:course.units[0].unitId},target_percent:90,min_distinct_questions:5,due_at:'2099-01-01T00:00:00.000Z'})
  expect(lost.state.pending).toBeDefined()
  const goals=new GoalSession(api,storage);await goals.retry()
  expect(goals.state.error).toBe('');const goal=goals.state.result!
  expect((await api.listGoals()).total).toBe(1)
  expect((await api.getGoal(goal.goal_id)).progress).toMatchObject({evidence_score:null,answer_count:0,criteria_met:false})
  for(const item of (await api.getBankEntries()).items){
    expect(await api.getBankSource(item.id)).toMatchObject({source:null,source_revision:0})
    const response=await api.setBankSource(item.id,{expected_revision:0,source:{courseId:course.courseId,unitId:course.units[0].unitId}})
    expect(response.source_revision).toBe(1)
  }
  const attributed=await api.createAttempt(quiz.quiz_id,'goal-evidence-round')
  await api.submitAttempt(attributed.attempt_id,{expected_revision:0,answer_records:quiz.questions.map(q=>({question_id:q.id,selected_answers:q.answer,duration_ms:100}))})
  expect((await api.getGoal(goal.goal_id)).progress).toMatchObject({evidence_score:1,distinct_question_count:3,criteria_met:false,remaining_distinct_questions:2})
  const knowledgeStats=await api.getKnowledgeStats()
  expect(knowledgeStats.total).toBe(1)
  expect(knowledgeStats.items[0]).toMatchObject({answer_count:3,distinct_question_count:3,repeated_answer_count:0,first_accuracy:100,latest_accuracy:100,attempt_count:1})
  const versionFilter={knowledge_point_id:knowledgeStats.items[0].source.knowledge_point_id,content_version:knowledgeStats.items[0].source.content_version}
  const knowledgeHistory=await api.getKnowledgeHistory(versionFilter)
  expect(knowledgeHistory.total).toBe(3)
  expect(knowledgeHistory.items.every(item=>item.attempt_id===attributed.attempt_id&&item.quiz_id===quiz.quiz_id)).toBe(true)
  expect((await api.getKnowledgeStats({...versionFilter,content_version:'f'.repeat(64)})).total).toBe(0)

  await goals.archive(goal,true)
  expect((await api.listGoals()).total).toBe(0);expect((await api.listGoals('archived')).total).toBe(1)
  const archived=goals.state.result!
  await goals.archive(archived,false)
  expect((await api.getGoal(goal.goal_id)).archived).toBe(false)
  await goals.archive(goal,true)
  expect(goals.state.rejected).toBe(true);expect((await api.getGoal(goal.goal_id)).archived).toBe(false)
  goals.discard()
  expect(fake.calls.length).toBe(goalCalls)

  const examCalls=fake.calls.length
  const source=(await api.getGoal(goal.goal_id)).source
  const config={title:'前端计时自测',duration_seconds:600,allocations:[{knowledge_point_id:source.knowledge_point_id,content_version:source.content_version,count:3}]}
  expect((await api.previewPaper({...config,allocations:[{...config.allocations[0],count:4}]})).coverage[0].missing).toBe(1)
  expect((await api.previewPaper(config)).ready).toBe(true)
  let operations=new ExamOperations(api,storage)
  await operations.run({kind:'create',input:{...config,request_id:crypto.randomUUID()}})
  expect(operations.state.error).toBe('');if(operations.state.result?.kind!=='paper')throw Error('missing paper')
  let paper=operations.state.result.value
  await expect(api.startExam(paper.paper_id,{request_id:crypto.randomUUID(),expected_revision:0})).rejects.toMatchObject({status:409})
  await operations.run({kind:'review',id:paper.paper_id,input:{expected_revision:paper.revision,reviews:paper.items.map(i=>({question_id:i.question.id,approved:true,note:'已核对来源'}))}})
  paper=(await api.getPaper(paper.paper_id));expect(paper.status).toBe('approved')
  const startInput={request_id:crypto.randomUUID(),expected_revision:paper.revision}
  const lostStart=new ExamOperations({...api,startExam:async(id,input)=>{await api.startExam(id,input);throw Error('lost response')}},storage)
  await lostStart.run({kind:'start',id:paper.paper_id,input:startInput})
  operations=new ExamOperations(api,storage);await operations.retry()
  if(operations.state.result?.kind!=='session')throw Error('missing exam')
  const exam=operations.state.result.value
  expect(exam.questions.every(q=>!('answer'in q)&&!('explanation'in q))).toBe(true)
  const answers=paper.items.map(i=>({question_id:i.question.id,selected_answers:i.question.answer,duration_ms:100}))
  await operations.run({kind:'save',id:exam.session_id,input:{expected_revision:0,answer_records:answers.slice(0,1)}})
  expect((await api.getExam(exam.session_id)).answer_records).toHaveLength(1)
  await app.close();app=await startStandalone(options);api=makeApi();await api.connect()
  const resumed=await api.getExam(exam.session_id);expect(resumed.deadline_at).toBe(exam.deadline_at);expect(resumed.revision).toBe(1)
  const result=await api.submitExam(exam.session_id,{expected_revision:resumed.revision,answer_records:answers})
  expect(result.result).toMatchObject({accuracy:100,correct_count:3,xp_gain:0,reason:'submitted'})
  expect(result.result?.by_source[0].accuracy).toBe(100)
  expect((await api.getAttempt(result.result!.attempt_id)).report_status).toBe('not_requested')
  expect((await api.getDetail(result.result!.quiz_id)).summary).toBe('')
  expect((await api.listExams()).total).toBe(1)
  expect(fake.calls.length).toBe(examCalls)

  // A lost source-generation response replays exactly once and auto-binds all new entries.
  const sourceRequest={kind:'generate' as const,input:{request_id:crypto.randomUUID(),source:{courseId:course.courseId,unitId:course.units[0].unitId},user_input:'围绕光合作用出题',question_count:3,difficulty:'easy' as const,generate_images:false}}
  const lostSource=new SourceOperations({...api,generateFromSource:async input=>{await api.generateFromSource(input);throw Error('lost response')}},storage,'source-test')
  await lostSource.run(sourceRequest)
  const recoveredSource=new SourceOperations(api,storage,'source-test');await recoveredSource.retry()
  const sourcePending=recoveredSource.state.pending
  if(sourcePending?.kind!=='generate'||!sourcePending.taskId)throw Error('missing source task')
  let sourceTask=await api.getTask(sourcePending.taskId)
  for(let i=0;i<250&&(sourceTask.status==='pending'||sourceTask.status==='running');i++){await new Promise(r=>setTimeout(r,100));sourceTask=await api.getTask(sourcePending.taskId)}
  expect(sourceTask.status).toBe('completed')
  const linkedEntries=(await api.getBankEntries({quiz_id:sourceTask.result!.quiz_id})).items
  expect(linkedEntries).toHaveLength(3)
  for(const entry of linkedEntries)expect(await api.getBankSource(entry.id)).toMatchObject({source_revision:1,source:{knowledge_point_id:source.knowledge_point_id,content_version:source.content_version}})
  const generatedCalls=fake.calls.length
  expect(await api.generateFromSource(sourceRequest.input)).toEqual({task_id:sourcePending.taskId})
  expect(fake.calls.length).toBe(generatedCalls)
  const unlinked=await api.setBankSource(linkedEntries[0].id,{expected_revision:1,source:null})
  expect(unlinked).toMatchObject({source:null,source_revision:2})
  await expect(api.setBankSource(linkedEntries[0].id,{expected_revision:1,source:sourceRequest.input.source})).rejects.toMatchObject({status:409})

 } finally {await app?.close();await fake.close();await rm(home,{recursive:true,force:true})}
},120000)
