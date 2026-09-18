import { useEffect, useRef, useState } from 'react'
import type { AnswerRecord, QuizData } from '../types.js'
import type { QuizApi } from '../services/contracts.js'
import { PracticeController, type PracticeStorage } from '../services/practice.js'

export function LegacyPractice({api,storage,quiz,records,onRecovered,onHistory}:{api:QuizApi;storage:PracticeStorage;quiz:QuizData;records:AnswerRecord[];onRecovered(id:string):void;onHistory():void}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [count,setCount]=useState<number>()
  const lock=useRef(false);const mounted=useRef(false)
  const [controller]=useState(()=>new PracticeController(api,storage,quiz.quiz_id,undefined,{pointerKey:`betterlearn:quiz:legacy:${quiz.quiz_id}`,createNew:true}))
  useEffect(()=>{
    mounted.current=true
    api.listAttempts(quiz.quiz_id).then(result=>{if(mounted.current)setCount(result.items.length)}).catch(()=>{if(mounted.current)setError('暂时无法查询既有轮次，可稍后从历史记录查看。')})
    return()=>{mounted.current=false}
  },[api,quiz.quiz_id])
  async function restore() {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try {
      await controller.load()
      if(controller.state.pending) await controller.retry()
      else await controller.importAnswers(records)
      const a=controller.state.attempt
      const matches=a && records.length===a.answer_records.length && records.every(r=>a.answer_records.some(saved=>saved.question_id===r.question_id && saved.duration_ms===r.duration_ms && [...saved.selected_answers].sort().join('\0')===[...r.selected_answers].sort().join('\0')))
      if(!matches || controller.state.pending) throw Error(controller.state.error || '旧进度暂时无法恢复，原始本地答案仍保留。')
      if(mounted.current) onRecovered(a.attempt_id)
    } catch(e) {if(mounted.current)setError(e instanceof Error?e.message:'恢复失败，原始答案仍保留。')}
    finally {lock.current=false;if(mounted.current)setBusy(false)}
  }
  return <section className="zl-panel zl-empty"><h2>发现旧版本地答题进度</h2><p>{quiz.title} · 已答 {records.length} 题{count!==undefined ? ` · 服务端已有 ${count} 轮记录` : ''}</p><p>可以先查看服务端记录，或将这些答案恢复为独立的新一轮草稿。原记录会保留，恢复不会自动交卷或生成报告。</p>
    {error && <p className="zl-error" role="alert">{error}</p>}
    <ul>{records.map((r,i)=><li key={`${r.question_id}-${i}`}>{r.question_id}：{r.selected_answers.join('、')}</li>)}</ul>
    <button className="zl-primary" disabled={busy} onClick={()=>void restore()}>恢复本地答案为新一轮</button><button className="zl-secondary" onClick={onHistory}>查看服务端记录</button>
  </section>
}
