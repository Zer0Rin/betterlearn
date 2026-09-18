import { useEffect, useRef, useState } from 'react'
import type { QuizApi } from '../services/contracts.js'
import type { AttemptSummary, QuizDetailResponse } from '../types.js'
import { newPractice, type PracticeController, type PracticeStorage } from '../services/practice.js'
import { PracticePanel } from '../components/PracticePanel.js'
import { QuizReport } from '../components/QuizReport.js'

export function AttemptHistory({api,storage,quizId,onRestart,initialAttemptId}:{initialAttemptId?:string;api:QuizApi;storage:PracticeStorage;quizId:string;onRestart():void}) {
  const [detail,setDetail]=useState<QuizDetailResponse>()
  const [items,setItems]=useState<AttemptSummary[]>([])
  const [selected,setSelected]=useState(initialAttemptId ?? '')
  const [controller,setController]=useState<PracticeController>()
  const [error,setError]=useState('')
  const [refresh,setRefresh]=useState(0)
  const [busy,setBusy]=useState(false)
  const creating=useRef(false)
  const mounted=useRef(false)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{
    let active=true;setError('')
    Promise.all([api.getDetail(quizId),api.listAttempts(quizId)]).then(([quiz,rounds])=>{
      if(!active)return
      setDetail(quiz);setItems(rounds.items);setSelected(previous=>previous || rounds.items[0]?.attempt_id || '')
    }).catch(e=>{if(active)setError(e.message)})
    return()=>{active=false}
  },[api,quizId,refresh])
  async function start() {
    if(creating.current)return
    creating.current=true;setBusy(true);setError('')
    try {
      const next=newPractice(api,storage,quizId)
      setController(next);setSelected('')
      await next.load()
      if(mounted.current) {
        if(next.state.attempt) {setSelected(next.state.attempt.attempt_id);setRefresh(n=>n+1)}
        else setError(next.state.error)
      }
    } catch(e){if(mounted.current)setError(e instanceof Error?e.message:'无法开始新一轮')}
    finally{creating.current=false;if(mounted.current)setBusy(false)}
  }
  return <>
    {error && <div className="zl-error" role="alert">{error}<button onClick={()=>setRefresh(n=>n+1)}>重新读取记录</button></div>}
    {!detail ? <p className="zl-empty">正在读取练习记录…</p> : <>
      <section className="zl-panel zl-attempt-toolbar">
        <label>作答轮次 <select aria-label="作答轮次" value={selected} disabled={busy} onChange={e=>{setController(undefined);setSelected(e.target.value)}}>
          {!selected && <option value="">{controller?'正在打开新一轮':'暂无作答记录'}</option>}
          {items.map((a,i)=><option key={a.attempt_id} value={a.attempt_id}>第 {items.length-i} 轮 · {a.status==='draft' ? '草稿' : `${Math.round(a.accuracy ?? 0)}%`} · {a.submitted_at ?? a.created_at} UTC</option>)}
        </select></label>
        <button className="zl-secondary" disabled={busy} onClick={()=>void start()}>开始新一轮练习</button>
        <p className="zl-muted">各轮成绩独立保存，同一题卷仅首次交卷获得经验值。</p>
      </section>
      {(selected || controller) ? <PracticePanel key={controller ? 'new' : selected} api={api} storage={storage} quiz={detail} attemptId={selected || undefined} controller={controller} onRestart={onRestart} onSubmitted={()=>setRefresh(n=>n+1)}/>
        : detail.report ? <><p className="zl-notice">旧版报告，仅供回看；没有对应作答成绩，不补记经验值。</p><QuizReport legacy quiz={detail} records={detail.answer_records ?? []} report={detail.report} onRestart={onRestart}/></>
        : <section className="zl-panel zl-empty"><h2>{detail.title}</h2><p>尚未开始作答，可开始新一轮练习。</p></section>}
    </>}
  </>
}
