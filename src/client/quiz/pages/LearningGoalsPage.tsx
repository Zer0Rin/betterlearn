import {useEffect,useMemo,useState} from 'react'
import type {LearningCourse} from '../../types.js'
import type {GoalApi,GoalDetail,GoalStatus,GoalSummary} from '../goal-types.js'
import type {PracticeStorage} from '../services/practice.js'
import {getGoalSession} from '../services/goal-session.js'
import {GoalCreateForm} from '../components/GoalCreateForm.js'
import {goalTime,goalTimeZone} from '../services/goal-time.js'
import {GoalProgressPanel} from '../components/GoalProgressPanel.js'
export const noGoalCourses=async():Promise<LearningCourse[]>=>[]
export function LearningGoalsPage({api,storage,loadCourses=noGoalCourses}:{api:GoalApi;storage:PracticeStorage;loadCourses?:()=>Promise<LearningCourse[]>}) {
 const session=useMemo(()=>getGoalSession(api,storage),[api,storage]);const [state,setState]=useState(session.state)
 const [status,setStatus]=useState<GoalStatus>('active');const [page,setPage]=useState(1);const [revision,setRevision]=useState(0)
 const [items,setItems]=useState<GoalSummary[]>([]);const [total,setTotal]=useState(0);const [loading,setLoading]=useState(true);const [error,setError]=useState('')
 const [creating,setCreating]=useState(false);const [selected,setSelected]=useState<string>();const [detail,setDetail]=useState<GoalDetail>();const [reading,setReading]=useState(false);const [detailError,setDetailError]=useState('')
 useEffect(()=>{setState(session.state);return session.subscribe(()=>setState(session.state))},[session])
 useEffect(()=>{if(state.result){setCreating(false);setSelected(state.result.goal_id);setRevision(n=>n+1)}},[state.result])
 useEffect(()=>{
  const abort=new AbortController();setLoading(true);setError('')
  api.listGoals(status,page,abort.signal).then(result=>{
   if(abort.signal.aborted)return
   if(page>1&&(page-1)*20>=result.total){setPage(Math.max(1,Math.ceil(result.total/20)));return}
   setItems(result.items);setTotal(result.total)
  }).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)})
  return()=>abort.abort()
 },[api,status,page,revision])
 useEffect(()=>{
  if(!selected){setDetail(undefined);return}
  const abort=new AbortController();setReading(true);setDetail(undefined);setDetailError('')
  api.getGoal(selected,abort.signal).then(value=>{if(!abort.signal.aborted)setDetail(value)}).catch(e=>{if(!abort.signal.aborted)setDetailError(e.message)}).finally(()=>{if(!abort.signal.aborted)setReading(false)})
  return()=>abort.abort()
 },[api,selected,revision])
 const blocked=state.busy||!!state.pending||state.rejected
 function refresh(){setRevision(n=>n+1)}
 return <>
  <header className="zl-heading"><div className="zl-eyebrow">学习计划</div><h1>学习目标</h1><p>为一个知识点版本设定期限，按有效练习证据检查进度。</p></header>
  <div className="zl-bank-controls"><button className="zl-primary" disabled={blocked} onClick={()=>{setCreating(true);setSelected(undefined)}}>创建目标</button><button className="zl-secondary" disabled={loading||reading||state.busy} onClick={refresh}>刷新目标</button></div>
  {state.error && <p className="zl-error" role="alert">{state.error}</p>}
  {state.pending && <section className="zl-notice" aria-label="待确认目标操作"><h2>{state.pending.kind==='create'?'待确认创建':'待确认归档操作'}</h2><p>{state.pending.kind==='create'?state.pending.input.title:state.pending.title}</p>{state.pending.kind==='create'&&<p>分数 ≥ {state.pending.input.target_percent}% · 至少 {state.pending.input.min_distinct_questions} 道不同题目 · 截止 {goalTime(state.pending.input.due_at)}（{goalTimeZone()}）</p>}{!state.rejected&&<button className="zl-primary" disabled={state.busy} onClick={()=>void session.retry()}>{state.busy?'正在保存…':'重试原目标请求'}</button>}</section>}
  {state.rejected&&<button className="zl-secondary" disabled={state.busy} onClick={()=>{session.discard();if(!session.state.rejected)refresh()}}>放弃旧请求并重新读取目标</button>}
  {creating&&<GoalCreateForm loadCourses={loadCourses} busy={blocked} onCreate={input=>void session.create(input)} onCancel={()=>setCreating(false)}/>}
  {selected&&<><button className="zl-secondary" onClick={()=>setSelected(undefined)}>返回目标列表</button>{reading?<p role="status">正在读取目标进度…</p>:detailError?<p className="zl-error" role="alert">读取失败：{detailError}</p>:detail&&<GoalProgressPanel goal={detail} busy={blocked} onArchive={()=>void session.archive(detail,!detail.archived)}/>}</>}
  {!selected&&!creating&&<>
   <nav className="zl-bank-scopes" aria-label="目标状态">{([['active','进行中'],['archived','已归档'],['all','全部']] as const).map(([value,label])=><button className="zl-secondary" aria-pressed={status===value} key={value} onClick={()=>{setStatus(value);setPage(1)}}>{label}</button>)}</nav>
   {error&&<p className="zl-error" role="alert">目标列表读取失败：{error}</p>}
   {loading?<p role="status">正在读取目标…</p>:!error&&items.length===0?<section className="zl-panel zl-empty"><h2>这里还没有目标</h2><p>设置知识点的证据要求与截止时间，之后可随时查看进度。</p></section>:!error&&<div className="zl-bank-list">{items.map(goal=><article className="zl-panel zl-bank-card" key={goal.goal_id}><div className="zl-bank-card-meta"><span>{goal.archived?'已归档':'未归档'}</span><span>{goal.source.title}</span></div><h2>{goal.title}</h2><p>证据分数 ≥ {goal.target_percent}% · 至少 {goal.min_distinct_questions} 道不同题目</p><p className="zl-muted">截止 {goalTime(goal.due_at)}（{goalTimeZone()}）</p><button className="zl-primary" onClick={()=>setSelected(goal.goal_id)}>查看进度</button></article>)}</div>}
   {total>20&&<div className="zl-pagination"><button className="zl-secondary" disabled={loading||page===1} onClick={()=>setPage(n=>n-1)}>上一页</button><span>第 {page} / {Math.ceil(total/20)} 页</span><button className="zl-secondary" disabled={loading||page*20>=total} onClick={()=>setPage(n=>n+1)}>下一页</button></div>}
  </>}
 </>
}
