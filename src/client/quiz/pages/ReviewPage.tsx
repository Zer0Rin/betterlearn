import {useEffect,useMemo,useState} from 'react'
import type {ReviewApi,ReviewItem,LearningReviewQueue} from '../services/review-api.js'
import {getReviewSession} from '../services/review-session.js'
import type {PracticeStorage} from '../services/practice.js'
const time=(value:string)=>value.replace('T',' ').replace('Z',' UTC')
export function ReviewPage({api,storage}:{api:ReviewApi;storage:PracticeStorage}) {
  const session=useMemo(()=>getReviewSession(api,storage),[api,storage])
  const [state,setState]=useState(session.state)
  const [queue,setQueue]=useState<LearningReviewQueue>();const [offset,setOffset]=useState(0);const [revision,setRevision]=useState(0)
  const [loading,setLoading]=useState(true);const [loadError,setLoadError]=useState('')
  const [selected,setSelected]=useState<ReviewItem>();const [option,setOption]=useState('')
  useEffect(()=>{setState(session.state);return session.subscribe(()=>setState(session.state))},[session])
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setLoadError('')
    api.queue({offset,limit:20},controller.signal).then(next=>{
      if(controller.signal.aborted)return
      if(offset>0 && offset>=next.total){setOffset(Math.max(0,Math.ceil(next.total/20)-1)*20);return}
      setQueue(next)
      setSelected(current=>current && next.items.find(item=>item.unitId===current.unitId&&item.expectedAttemptId===current.expectedAttemptId))
    }).catch(e=>{if(!controller.signal.aborted)setLoadError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[api,offset,revision,state.result?.attempt.attemptId])
  const item=state.pending?.item ?? selected
  const selectedOption=state.pending?.request.optionId ?? option
  const result=state.result
  const unit=result?.course.units.find(unit=>unit.unitId===state.resultItem?.unitId)
  const blocked=state.busy || !!state.pending || state.conflict
  function reload(){setSelected(undefined);setOption('');setRevision(n=>n+1)}
  return <>
    <header className="zl-heading"><div className="zl-eyebrow">学习书复习</div><h1>到期复习</h1><p>汇总所有进行中的课程，优先补救，再复习到期知识点。题库收藏和练习成绩不会自动改写这里的复习进度。</p></header>
    <div className="zl-bank-controls"><span>{queue?`待复习 ${queue.total} 项`:'正在读取队列…'}</span><button className="zl-secondary" disabled={loading||state.busy} onClick={reload}>刷新复习队列</button></div>
    {queue && <p className="zl-muted">按服务端时间 {time(queue.asOf)} 统计</p>}
    {loadError && <p className="zl-error" role="alert">无法读取队列：{loadError}</p>}
    {state.error && <p className="zl-error" role="alert">{state.error}</p>}
    {state.conflict && <button className="zl-secondary" disabled={state.busy} onClick={()=>{session.discardConflict();if(!session.state.conflict)reload()}}>放弃旧请求并重新读取队列</button>}
    {result && <section className="zl-panel zl-review-result" role="status"><h2>{result.attempt.correct?'复习通过':'需要继续补救'}</h2><p>本次判分和学习进度已保存。</p>{unit?.mastery.dueAt && <p>下次复习：{time(unit.mastery.dueAt)}</p>}{!result.attempt.correct && <p>在队列中打开补救任务，结合证据再试一次。</p>}<button className="zl-primary" disabled={!!state.pending||state.busy} onClick={()=>{session.clearResult();reload()}}>继续复习</button></section>}
    {item && (!result||state.pending) && <section className="zl-panel zl-review-task"><p className="zl-eyebrow">{item.courseTitle} · {item.phase==='remediation'?'补救练习':'到期复习'}</p><h2>{item.title}</h2>
      {item.remediation && <aside className="zl-notice"><h3>{item.remediation.title}</h3><p>{item.remediation.body}</p></aside>}
      <h3>{item.assessment.prompt}</h3><div className="zl-options" role="radiogroup" aria-label="复习选项">{item.assessment.options.map((o,i)=><button className={`zl-option ${selectedOption===o.optionId?'selected':''}`} type="button" role="radio" aria-checked={selectedOption===o.optionId} disabled={blocked} key={o.optionId} onClick={()=>setOption(o.optionId)}><span className="zl-option-key">{String.fromCharCode(65+i)}</span>{o.label}</button>)}</div>
      <div className="zl-bank-controls">{state.pending ? !state.conflict && <button className="zl-primary" disabled={state.busy} onClick={()=>void session.retry()}>{state.busy?'正在提交…':'重试原复习请求'}</button> : <button className="zl-primary" disabled={!option||blocked||loading} onClick={()=>void session.submit(item,option)}>提交复习答案</button>}<button className="zl-secondary" disabled={blocked} onClick={()=>{setSelected(undefined);setOption('')}}>返回复习列表</button></div>
    </section>}
    {!item && !result && <>{loading?<p className="zl-empty" role="status">正在读取跨课程复习…</p>:queue?.items.length?<div className="zl-bank-list">{queue.items.map(task=><article className="zl-panel zl-bank-card" key={`${task.unitId}:${task.expectedAttemptId}`}><div className="zl-bank-card-meta"><span>{task.phase==='remediation'?'需要补救':'已到期'}</span><span>{task.courseTitle}</span></div><h2>{task.title}</h2><p className="zl-muted">{task.dueAt?`复习时间：${time(task.dueAt)}`:'先完成证据补救，再安排下次复习。'}</p><button className="zl-primary" disabled={blocked} onClick={()=>{setSelected(task);setOption('')}}>{task.phase==='remediation'?'开始补救':'开始复习'}</button></article>)}</div>:!loadError && <section className="zl-panel zl-empty"><h2>当前没有待复习任务</h2><p>已掌握的知识点到期后会出现在这里；需要补救的知识点会优先显示。</p></section>}
      {queue && queue.total>20 && <div className="zl-pagination"><button className="zl-secondary" disabled={loading||blocked||offset===0} onClick={()=>setOffset(n=>n-20)}>上一页</button><span>第 {offset/20+1} / {Math.ceil(queue.total/20)} 页</span><button className="zl-secondary" disabled={loading||blocked||offset+20>=queue.total} onClick={()=>setOffset(n=>n+20)}>下一页</button></div>}
    </>}
  </>
}
