import {useEffect,useMemo,useState} from 'react'
import type {QuizApi} from '../services/contracts.js'
import type {PracticeStorage} from '../services/practice.js'
import type {ExamPaper,ExamSession,ExamSummary,PaperSummary} from '../exam-types.js'
import {getExamOperations} from '../services/exam-operations.js'
import {ExamBuilder} from '../components/ExamBuilder.js'
import {ExamPaperReview} from '../components/ExamPaperReview.js'
import {ExamAttempt} from '../components/ExamAttempt.js'
import {goalTime} from '../services/goal-time.js'
export function ExamsPage({api,storage,onReport}:{api:QuizApi;storage:PracticeStorage;onReport(quizId:string,attemptId:string):void}) {
 const operations=useMemo(()=>getExamOperations(api,storage),[api,storage]);const [state,setState]=useState(operations.state)
 const [tab,setTab]=useState<'papers'|'sessions'>('papers');const [page,setPage]=useState(1);const [revision,setRevision]=useState(0)
 const [papers,setPapers]=useState<PaperSummary[]>([]);const [exams,setExams]=useState<ExamSummary[]>([]);const [total,setTotal]=useState(0)
 const [mode,setMode]=useState<'list'|'build'|'paper'|'session'>('list');const [id,setId]=useState('');const [paper,setPaper]=useState<ExamPaper>();const [exam,setExam]=useState<ExamSession>()
 const [loading,setLoading]=useState(false);const [error,setError]=useState('')
 useEffect(()=>{setState(operations.state);return operations.subscribe(()=>setState(operations.state))},[operations])
 useEffect(()=>{if(state.result){const r=state.result;if(r.kind==='paper'){setMode('paper');setId(r.value.paper_id);setPaper(r.value)}else{setMode('session');setId(r.value.session_id);setExam(r.value)}setRevision(n=>n+1)}},[state.result])
 useEffect(()=>{
  let active=true;setError('');setLoading(true)
  async function read(){try{
   if(mode==='list'){
    const result=tab==='papers'?await api.listPapers(page):await api.listExams(page)
    if(!active)return
    if(page>1&&(page-1)*20>=result.total){setPage(Math.max(1,Math.ceil(result.total/20)));return}
    if(tab==='papers')setPapers(result.items as PaperSummary[]);else setExams(result.items as ExamSummary[]);setTotal(result.total)
   }else if(mode==='paper'){const value=await api.getPaper(id);if(active)setPaper(value)}
   else if(mode==='session'){const value=await api.getExam(id);if(active)setExam(value)}
  }catch(e){if(active)setError(e instanceof Error?e.message:'读取失败')}finally{if(active)setLoading(false)}}
  void read();return()=>{active=false}
 },[api,mode,id,tab,page,revision])
 useEffect(()=>{
  if(typeof window==='undefined'||mode!=='session'||!exam||exam.status==='submitted'||state.pending||state.busy)return
  let active=true;let inFlight=false
  const read=async()=>{if(inFlight)return;inFlight=true;try{const value=await api.getExam(id);if(active){setExam(value);setError('')}}catch{if(active)setError('无法核对考试状态，请检查连接并重新读取。')}finally{inFlight=false}}
  const timer=setInterval(()=>void read(),15000);const focus=()=>void read();window.addEventListener('focus',focus)
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus)}
 },[api,mode,id,exam?.status,state.pending,state.busy])
 const blocked=state.busy||!!state.pending||state.rejected
 function open(next:'paper'|'session',value:string){setPaper(undefined);setExam(undefined);setId(value);setMode(next)}
 return <>
  <header className="zl-heading"><div className="zl-eyebrow">题库自测</div><h1>模拟考试</h1><p>从已有题库组卷，逐题审核后开始计时，交卷保存独立成绩。</p></header>
  <div className="zl-bank-controls"><button className="zl-primary" disabled={blocked} onClick={()=>setMode('build')}>新建试卷</button><button className="zl-secondary" onClick={()=>{setMode('list');setRevision(n=>n+1)}}>试卷与考试列表</button><button className="zl-secondary" disabled={loading||state.busy} onClick={()=>setRevision(n=>n+1)}>重新读取</button></div>
  {error&&<p className="zl-error" role="alert">{error}</p>}{state.error&&<p className="zl-error" role="alert">{state.error}</p>}
  {state.pending&&<section className="zl-notice"><p>有一笔待确认操作：{{create:'创建试卷',review:'保存审核',start:'开考',save:'保存草稿',submit:'交卷'}[state.pending.kind]}。请先处理原请求。</p>{!state.rejected&&<button className="zl-primary" disabled={state.busy} onClick={()=>void operations.retry()}>{state.busy?'正在处理…':'重试原考试请求'}</button>}</section>}
  {state.rejected&&<button className="zl-secondary" disabled={state.busy} onClick={()=>{operations.discard();if(!operations.state.rejected)setRevision(n=>n+1)}}>放弃旧请求并重新读取</button>}
  {mode==='build'&&<ExamBuilder api={api} busy={blocked} onCancel={()=>setMode('list')} onCreate={input=>void operations.run({kind:'create',input:{...input,request_id:crypto.randomUUID()}})}/>}
  {mode==='paper'&&(loading?<p role="status">正在读取试卷…</p>:paper&&!error&&<ExamPaperReview key={`${paper.paper_id}:${paper.revision}`} paper={paper} busy={blocked} onReview={reviews=>void operations.run({kind:'review',id:paper.paper_id,input:{expected_revision:paper.revision,reviews}})} onStart={()=>void operations.run({kind:'start',id:paper.paper_id,input:{request_id:crypto.randomUUID(),expected_revision:paper.revision}})}/>)}
  {mode==='session'&&(loading?<p role="status">正在读取考试…</p>:exam&&<ExamAttempt key={`${exam.session_id}:${exam.revision}:${exam.status}`} session={exam} storage={storage} busy={blocked||!!error} onSave={input=>void operations.run({kind:'save',id:exam.session_id,input})} onSubmit={input=>void operations.run({kind:'submit',id:exam.session_id,input})} onReport={onReport}/>)}
  {mode==='list'&&<><nav className="zl-bank-scopes" aria-label="考试列表类型"><button className="zl-secondary" aria-pressed={tab==='papers'} onClick={()=>{setTab('papers');setPage(1)}}>试卷</button><button className="zl-secondary" aria-pressed={tab==='sessions'} onClick={()=>{setTab('sessions');setPage(1)}}>考试记录</button></nav>
   {loading?<p role="status">正在读取列表…</p>:!error&&<div className="zl-bank-list">{tab==='papers'?papers.map(p=><article className="zl-panel zl-bank-card" key={p.paper_id}><h2>{p.title}</h2><p>{p.duration_seconds/60} 分钟 · {p.approved?'审核已通过':'待审核'}</p><button className="zl-primary" onClick={()=>open('paper',p.paper_id)}>查看覆盖审核</button></article>):exams.map(e=><article className="zl-panel zl-bank-card" key={e.session_id}><h2>{e.title}</h2><p>{e.status==='submitted'?`成绩 ${e.accuracy}%`:e.status==='expired'?'已到期，待结算':'进行中'} · 截止 {goalTime(e.deadline_at)}</p><button className="zl-primary" onClick={()=>open('session',e.session_id)}>{e.status==='submitted'?'查看考试成绩':'继续考试或结算'}</button></article>)}{total===0&&<p className="zl-empty">还没有{tab==='papers'?'试卷，可从题库来源开始组卷。':'考试记录。'}</p>}</div>}
   {total>20&&<div className="zl-pagination"><button className="zl-secondary" disabled={loading||page===1} onClick={()=>setPage(n=>n-1)}>上一页</button><span>第 {page} / {Math.ceil(total/20)} 页</span><button className="zl-secondary" disabled={loading||page*20>=total} onClick={()=>setPage(n=>n+1)}>下一页</button></div>}
  </>}
 </>
}
