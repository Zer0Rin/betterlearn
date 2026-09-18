import type {LearningCourse} from '../../types.js'
import type {PracticeStorage} from '../services/practice.js'
import {SourceBinding} from '../components/SourceBinding.js'
import { useEffect, useRef, useState } from 'react'
import type { BankCategory, BankEntry, BankHistoryItem, BankPage } from '../bank-types.js'
import type { QuizApi } from '../services/contracts.js'
export const bankResultLabel=(value:boolean|null)=>value===null?'未作答':value?'最近答对':'最近答错'
interface Props {api:QuizApi;storage?:PracticeStorage;loadCourses?:()=>Promise<LearningCourse[]>;id:number;categories:BankCategory[];onBack():void;onChanged():void;onPractice(quizId:string):void;onAttempt(quizId:string,attemptId:string):void}
export function QuestionBankDetail({api,storage,loadCourses,id,categories,onBack,onChanged,onPractice,onAttempt}:Props) {
  const [entry,setEntry]=useState<BankEntry>();const [history,setHistory]=useState<BankPage<BankHistoryItem>>()
  const [page,setPage]=useState(1);const [revision,setRevision]=useState(0)
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [uncertain,setUncertain]=useState(false)
  const [error,setError]=useState('');const lock=useRef(false);const mounted=useRef(false)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{
    let active=true;setLoading(true)
    Promise.all([api.getBankEntry(id),api.getBankHistory(id,page)]).then(([next,records])=>{if(active){setEntry(next);setHistory(records);setUncertain(false);setError('')}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[api,id,page,revision])
  async function mutate(action:()=>Promise<unknown>) {
    if(lock.current || loading || uncertain)return
    lock.current=true;setBusy(true);setError('')
    try {await action();if(mounted.current){setLoading(true);setRevision(n=>n+1);onChanged()}}
    catch(e){if(mounted.current){setError(`${e instanceof Error?e.message:'操作未完成'}。请重新读取题目，核对服务端结果后再操作。`);setUncertain(true)}}
    finally{lock.current=false;if(mounted.current)setBusy(false)}
  }
  const disabled=busy||loading||uncertain
  return <>
    <div className="zl-bank-controls"><button className="zl-secondary" onClick={onBack}>返回题库</button><button className="zl-secondary" disabled={busy||loading} onClick={()=>{setRevision(n=>n+1);onChanged()}}>重新读取题目</button></div>
    {error && <p className="zl-error" role="alert">{error}</p>}
    {!entry ? <p className="zl-empty">{loading?'正在读取题目…':'暂时无法读取题目。'}</p> : <>
      <header className="zl-heading"><div className="zl-eyebrow">{entry.title} · {bankResultLabel(entry.is_correct)}</div><h1>{entry.question.stem}</h1><p>已答 {entry.attempt_count} 次 · 答错 {entry.wrong_count} 次</p></header>
      <section className="zl-panel zl-bank-detail">
        {entry.question.image_url && <img className="zl-question-image" src={entry.question.image_url} alt="题目配图"/>}
        <ul className="zl-bank-options">{entry.question.options.map(o=><li key={o.key}><strong>{o.key}</strong> {o.text}</li>)}</ul>
        <details><summary>查看答案与解析</summary><p>参考答案：{entry.question.answer.join('、')}</p><p>{entry.question.explanation}</p><p className="zl-muted">题目标签：{entry.question.knowledge_point}</p></details>
        <div className="zl-bank-controls"><button className="zl-secondary" disabled={disabled} aria-pressed={entry.bookmarked} onClick={()=>void mutate(()=>api.setBankBookmark(id,!entry.bookmarked))}>{entry.bookmarked?'取消收藏':'收藏题目'}</button><button className="zl-primary" onClick={()=>onPractice(entry.quiz_id)}>练习这份题卷</button></div>
        <fieldset disabled={disabled}><legend>所属分类</legend>{categories.length?categories.map(c=><label className="zl-bank-category-choice" key={c.id}><input type="checkbox" aria-label={`分类：${c.name}`} checked={entry.categories.some(x=>x.id===c.id)} onChange={e=>{const linked=e.target.checked;void mutate(()=>api.setBankCategory(id,c.id,linked))}}/>{c.name}</label>):<p className="zl-muted">返回题库可新建分类。</p>}</fieldset>
      </section>
      {storage && <SourceBinding api={api} storage={storage} id={id} loadCourses={loadCourses} onChanged={onChanged}/>}
      <section className="zl-panel zl-bank-detail"><h2>作答历史</h2>{loading?<p role="status">正在读取…</p>:history?.items.length?<ol className="zl-bank-history">{history.items.map(h=><li key={h.attempt_id}><div><strong>{h.is_correct?'答对':'答错'}</strong><p>所选答案：{h.selected_answers.join('、')} · {Math.round(h.duration_ms/1000)} 秒</p><small>{h.submitted_at} UTC</small></div><button className="zl-secondary" onClick={()=>onAttempt(entry.quiz_id,h.attempt_id)}>查看本轮成绩</button></li>)}</ol>:<p className="zl-empty">还没有交卷记录。确认单题答案后的草稿不计入作答历史。</p>}
        {history && history.total>20 && <div className="zl-pagination"><button className="zl-secondary" disabled={busy||loading||page===1} onClick={()=>setPage(n=>n-1)}>历史上一页</button><span>{page} / {Math.ceil(history.total/20)}</span><button className="zl-secondary" disabled={busy||loading||page*20>=history.total} onClick={()=>setPage(n=>n+1)}>历史下一页</button></div>}
      </section>
    </>}
  </>
}
