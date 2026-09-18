import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnswerRecord, QuizData } from '../types.js'
import type { QuizApi } from '../services/contracts.js'
import { getPractice, type PracticeController, type PracticeStorage } from '../services/practice.js'
import { isAnswerCorrect } from './quiz-logic.js'
import { QuizPlayer } from './QuizPlayer.js'
import { QuizReport } from './QuizReport.js'

interface Props {
  api: QuizApi; storage: PracticeStorage; quiz: QuizData; attemptId?: string
  controller?: PracticeController; onRestart(): void; onSubmitted?(): void
}
export function PracticePanel({ api, storage, quiz, attemptId, controller: supplied, onRestart, onSubmitted }: Props) {
  const controller=useMemo(()=>supplied ?? getPractice(api,storage,quiz.quiz_id,attemptId),[api,storage,quiz.quiz_id,attemptId,supplied])
  const [state,setState]=useState(controller.state)
  const [index,setIndex]=useState(0)
  const [pollRound,setPollRound]=useState(0)
  const [pollExpired,setPollExpired]=useState(false)
  useEffect(()=>{
    setIndex(0);setState(controller.state)
    const unsubscribe=controller.subscribe(()=>setState(controller.state))
    void controller.load()
    return unsubscribe
  },[controller])
  const submittedCallback=useRef(onSubmitted)
  submittedCallback.current=onSubmitted
  const a=state.attempt
  useEffect(()=>{ if(a?.status==='submitted') submittedCallback.current?.() },[a?.attempt_id,a?.status])
  useEffect(()=>{
    if(a?.report_status!=='running') return
    let active=true;let timer:ReturnType<typeof setTimeout>;const started=Date.now()
    setPollExpired(false)
    const poll=async()=>{
      if(!active) return
      if(Date.now()-started>=120000){setPollExpired(true);return}
      await controller.load()
      if(active && controller.state.attempt?.report_status==='running') timer=setTimeout(poll,2500)
    }
    timer=setTimeout(poll,2500)
    return ()=>{active=false;clearTimeout(timer)}
  },[controller,a?.report_status,pollRound])
  const error=(state.error || a?.report_error) && <p className="zl-error" role="alert">{state.error || a?.report_error}{!state.pending && <button disabled={state.busy} onClick={()=>void controller.load()}>重新读取状态</button>}</p>
  if(!a) return <section className="zl-panel zl-empty"><h2>{quiz.title}</h2>{error}<p>{state.busy ? '正在读取作答记录…' : '暂时无法打开练习。'}</p>{!state.busy && <button className="zl-primary" onClick={()=>void controller.load()}>重新读取</button>}</section>
  const frozenQuiz={...quiz,title:a.title,questions:a.questions}
  const pendingNotice=(state.pending && <section className="zl-panel zl-pending-answers"><h3>本地待保存答案</h3><ul>{state.pending.input.answer_records.map(r=><li key={r.question_id}>第 {a.questions.findIndex(q=>q.id===r.question_id)+1} 题：{r.selected_answers.join('、')}</li>)}</ul>
      <div className="zl-footer-actions"><button className="zl-secondary" disabled={state.busy} onClick={()=>void controller.load()}>重新读取状态</button>
      {!state.conflict && <button className="zl-primary" disabled={state.busy} onClick={()=>void controller.retry()}>重试原请求</button>}
      <button className="zl-secondary" disabled={state.busy} onClick={()=>void controller.discardLocal()}>使用服务端记录并舍弃本地待保存答案</button></div>
    </section>)
  if(a.status==='submitted') {
    const score=a.accuracy!==null && a.correct_count!==null && a.total_questions!==null ? {accuracy:a.accuracy,correct_count:a.correct_count,total_questions:a.total_questions,xp_gain:a.xp_gain,submitted_at:a.submitted_at} : undefined
    return <>{error}{pendingNotice}<QuizReport quiz={frozenQuiz} records={a.answer_records.map(r=>({...r,is_correct:r.is_correct===true}))} score={score} legacy={!score} report={a.report ?? undefined} reportStatus={a.report_status} busy={state.busy} onRetry={()=>void controller.generateReport()} onRestart={onRestart}/>
      {a.report_status==='running' && <p role="status">{pollExpired ? '报告仍在处理中，可稍后继续查询。' : '报告正在生成，正在查询进度…'}<button className="zl-secondary" disabled={state.busy} onClick={()=>{setPollRound(n=>n+1);void controller.load()}}>继续查询报告</button></p>}
    </>
  }
  const records:AnswerRecord[]=a.answer_records.map(r=>({...r,is_correct:isAnswerCorrect(r.selected_answers,a.questions.find(q=>q.id===r.question_id)?.answer ?? [])}))
  // Persisted records drive feedback; uncertain local choices are shown separately, never as saved.
  return <>
    <div className="zl-practice-status" role="status">{state.busy ? '正在保存或读取作答…' : state.pending ? '有答案尚未确认保存' : '草稿已保存到本机服务'} · 正式成绩将在交卷后保存</div>
    {error}
    {pendingNotice}
    <QuizPlayer quiz={frozenQuiz} records={records} index={Math.min(index,a.questions.length-1)} busy={state.busy || !!state.pending || !state.ready} onAnswer={record=>void controller.answer(record)} onIndexChange={setIndex} onFinish={()=>void controller.submit()}/>
  </>
}
