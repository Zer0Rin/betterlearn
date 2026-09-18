import assert from 'node:assert/strict'

// Called only by the temporary-home desktop verifier. All model calls use its fake provider.
async function request(page, path, body) {
  return page.evaluate(async ({path,body}) => {
    const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
    const data=await response.json()
    if(!response.ok)throw Error(`${path}: HTTP ${response.status}`)
    return data
  },{path,body})
}
export async function verifyDesktopLearning(page, sourceText) {
  // Seed one reviewed Core course through the public APIs, then exercise the new renderer flows.
  const selection=await request(page,'/api/model')
  const {runId}= (await request(page,'/nobei/v1/imports',{filename:'desktop-learning.txt',mediaType:'text/plain',text:sourceText,modelSelection:selection})).result
  await page.waitForFunction(async id=>(await (await fetch('/nobei/v1/runs/'+id)).json()).result.status==='review_pending',runId,{timeout:60000})
  const candidate=(await request(page,`/nobei/v1/runs/${runId}/candidates`)).result.candidates[0]
  await request(page,`/nobei/v1/candidates/${candidate.candidateId}/review`,{action:'accept',expectedRevision:candidate.revision,idempotencyKey:'idem_dddddddddddddddddddd'})
  const points=(await request(page,`/nobei/v1/runs/${runId}/knowledge-points`)).result.knowledgePoints
  const course=(await request(page,'/nobei/v1/learning-courses',{clientBookId:'book-desktop',title:'桌面验收学习书',knowledgePointIds:points.map(p=>p.knowledgePointId)})).result
  await page.evaluate(async ({course,points,sourceText})=>{
    const response=await fetch('/api/library',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:0,books:[{bookId:'book-desktop',title:course.title,createdAt:new Date().toISOString(),sourceText,points,courseId:course.courseId,progress:course.progress}]})})
    if(!response.ok)throw Error('Failed to seed desktop library')
  },{course,points,sourceText})
  await page.reload()
  await page.getByRole('button',{name:/桌面验收学习书，/}).waitFor()
  await page.getByRole('button',{name:'知识点出题',exact:true}).click()
  await page.getByLabel('来源课程',{exact:true}).selectOption(course.courseId)
  await page.getByLabel('来源知识点',{exact:true}).selectOption(course.units[0].unitId)
  await page.getByLabel('知识点题目数量',{exact:true}).fill('3')
  await page.getByRole('button',{name:'生成知识点练习',exact:true}).click()
  await page.getByRole('button',{name:'打开这份练习',exact:true}).waitFor({timeout:60000})
  const pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('betterlearn:source-generation:v1')))
  assert.ok(pending.taskId)
  const task=(await request(page,`/nobei/quiz/v1/quiz/task/${pending.taskId}`)).data
  assert.equal(task.status,'completed')
  const entries=(await request(page,`/nobei/quiz/v1/question-bank/entries?quiz_id=${task.result.quiz_id}`)).data.items
  assert.equal(entries.length,3)
  assert.ok(entries.every(e=>e.source?.course_id===course.courseId&&e.source_revision===1))
  await page.getByRole('button',{name:'题库',exact:true}).click()
  await page.getByRole('button',{name:'查看题目',exact:true}).first().click()
  await page.getByRole('heading',{name:'题目来源',exact:true}).waitFor()
  await page.getByText(course.units[0].title,{exact:true}).first().waitFor()
  await page.getByRole('button',{name:'到期复习',exact:true}).click()
  await page.getByRole('heading',{name:'到期复习',exact:true}).waitFor()
  await page.getByRole('button',{name:'学习目标',exact:true}).click()
  await page.getByRole('button',{name:'创建目标',exact:true}).click()
  await page.getByLabel('目标课程',{exact:true}).selectOption(course.courseId)
  await page.getByLabel('目标知识点',{exact:true}).selectOption(course.units[0].unitId)
  await page.getByLabel('目标名称',{exact:true}).fill('桌面端学习目标')
  await page.getByLabel('目标截止时间',{exact:true}).fill('2099-01-01T12:00')
  await page.getByRole('button',{name:'保存目标',exact:true}).click()
  await page.getByRole('heading',{name:'桌面端学习目标',exact:true}).waitFor()
  assert.equal((await request(page,'/nobei/quiz/v1/learning-goals')).data.total,1)
  await page.getByRole('button',{name:'模拟考试',exact:true}).click()
  await page.getByRole('button',{name:'新建试卷',exact:true}).click()
  await page.getByLabel('试卷名称',{exact:true}).fill('桌面恢复考试')
  await page.getByLabel('考试时长',{exact:true}).fill('30')
  await page.getByRole('checkbox',{name:/选择来源：/}).first().check()
  await page.getByLabel('来源题数 1',{exact:true}).fill('3')
  await page.getByRole('button',{name:'预览组卷缺口',exact:true}).click()
  await page.getByRole('button',{name:'创建冻结试卷',exact:true}).click()
  const start=page.getByRole('button',{name:'开始计时考试',exact:true})
  await start.waitFor()
  assert.equal(await start.isEnabled(),false)
  for(let i=1;i<=3;i++)await page.getByLabel(`通过第 ${i} 题审核`,{exact:true}).check()
  await page.getByRole('button',{name:'保存覆盖审核',exact:true}).click()
  await start.click()
  await page.getByRole('button',{name:'确认开考',exact:true}).click()
  await page.getByRole('group',{name:'第 1 题选项',exact:true}).getByRole('button',{name:'A 化学能',exact:true}).click()
  await page.getByRole('button',{name:'保存考试草稿',exact:true}).click()
  await page.getByText(/已保存 1 \/ 3 道/).waitFor()
  const exam=(await request(page,'/nobei/quiz/v1/exam-sessions')).data.items[0]
  const saved=(await request(page,`/nobei/quiz/v1/exam-sessions/${exam.session_id}`)).data
  assert.equal(saved.answer_records.length,1)
  assert.equal(saved.revision,1)
  assert.ok(saved.questions.every(q=>!('answer'in q)&&!('explanation'in q)))
  const headingStyle=await page.locator('.zl-heading').first().evaluate(el=>({fill:getComputedStyle(el).backgroundColor,opacity:getComputedStyle(el).opacity}))
  assert.equal(headingStyle.fill,'rgba(255, 255, 255, 0.9)')
  assert.equal(headingStyle.opacity,'1')
  await page.screenshot({path:'dist/desktop-verification/exam-draft.png'})
  return {sessionId:exam.session_id,deadline:saved.deadline_at,taskId:pending.taskId,quizId:task.result.quiz_id}
}

export async function verifyDesktopLearningRestart(page, saved) {
  await page.getByRole('button',{name:'知识点出题',exact:true}).click()
  await page.getByRole('button',{name:'打开这份练习',exact:true}).waitFor()
  const pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('betterlearn:source-generation:v1')))
  assert.equal(pending.taskId,saved.taskId)
  await page.getByRole('button',{name:'模拟考试',exact:true}).click()
  await page.getByRole('button',{name:'考试记录',exact:true}).click()
  await page.getByRole('button',{name:'继续考试或结算',exact:true}).click()
  await page.getByText(/已保存 1 \/ 3 道/).waitFor()
  assert.equal(await page.getByRole('group',{name:'第 1 题选项',exact:true}).getByRole('button',{name:'A 化学能',exact:true}).getAttribute('aria-pressed'),'true')
  const before=(await request(page,`/nobei/quiz/v1/exam-sessions/${saved.sessionId}`)).data
  assert.equal(before.deadline_at,saved.deadline)
  await page.getByRole('button',{name:'交卷',exact:true}).click()
  await page.getByRole('button',{name:'确认交卷',exact:true}).click()
  await page.getByRole('button',{name:'查看本次成绩与独立 AI 报告',exact:true}).waitFor()
  const result=(await request(page,`/nobei/quiz/v1/exam-sessions/${saved.sessionId}`)).data.result
  assert.equal(result.correct_count,1)
  assert.equal(result.total_questions,3)
  assert.equal(result.xp_gain,0)
  await page.getByRole('button',{name:'查看本次成绩与独立 AI 报告',exact:true}).click()
  await page.getByRole('button',{name:'生成 AI 报告',exact:true}).waitFor()
  assert.equal((await request(page,`/nobei/quiz/v1/quiz/attempts/${result.attempt_id}`)).data.report_status,'not_requested')
  await page.getByRole('button',{name:'学习统计',exact:true}).click()
  await page.getByRole('button',{name:'查看此版本作答',exact:true}).click()
  await page.getByRole('button',{name:'查看这次成绩',exact:true}).first().waitFor()
  assert.equal(await page.getByRole('button',{name:'查看这次成绩',exact:true}).count(),3)
  await page.screenshot({path:'dist/desktop-verification/knowledge-history.png'})
}
