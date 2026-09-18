import {useEffect,useRef,useState} from 'react'
import type {ExamSession} from '../exam-types.js'
import type {AttemptAnswers} from '../types.js'
import type {PracticeStorage} from '../services/practice.js'
import {examDraftKey,readExamDraft} from '../services/exam-operations.js'
import {goalTime,goalTimeZone} from '../services/goal-time.js'
export function ExamAttempt({session,storage,busy,onSave,onSubmit,onReport}:{session:ExamSession;storage:PracticeStorage;busy:boolean;onSave(input:AttemptAnswers):void;onSubmit(input:AttemptAnswers):void;onReport(quizId:string,attemptId:string):void}) {
 const [initial]=useState(()=>{try{return{...readExamDraft(storage,session),error:''}}catch{return{input:{expected_revision:session.revision,answer_records:session.answer_records},conflict:true,error:'本地草稿无法读取，请明确丢弃后恢复服务端草稿。'}}})
 const draftRaw=useRef<string|null>(null)
 useEffect(()=>{try{draftRaw.current=storage.getItem(examDraftKey(session.session_id))}catch{}},[storage,session.session_id])
 const [input,setInput]=useState<AttemptAnswers>(initial.input);const [conflict,setConflict]=useState(initial.conflict);const [error,setError]=useState(initial.error)
 const [now,setNow]=useState(Date.now());const [confirm,setConfirm]=useState(false)
 useEffect(()=>{if(session.status==='submitted')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[session.status])
 const remaining=Math.max(0,Math.ceil((Date.parse(session.deadline_at)-now)/1000));const expired=session.status==='expired'
 const dirty=session.status!=='submitted'&&JSON.stringify(input.answer_records)!==JSON.stringify(session.answer_records)
 useEffect(()=>{if(!dirty||typeof window==='undefined')return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
 function choose(question:ExamSession['questions'][number],key:string){
  if(busy||conflict||expired)return
  const old=input.answer_records.find(r=>r.question_id===question.id)?.selected_answers??[]
  const answers=question.type==='multiple'?(old.includes(key)?old.filter(k=>k!==key):[...old,key]):old.includes(key)?[]:[key]
  const next={expected_revision:session.revision,answer_records:[...input.answer_records.filter(r=>r.question_id!==question.id),{question_id:question.id,selected_answers:answers,duration_ms:0}]}
  setInput(next);setConfirm(false)
  try{if(storage.getItem(examDraftKey(session.session_id))!==draftRaw.current){setConflict(true);setError('另一窗口更新了本地草稿，未覆盖该记录。请重新读取考试。');return}const raw=JSON.stringify(next);storage.setItem(examDraftKey(session.session_id),raw);draftRaw.current=raw;setError('')}catch{setError('本地草稿保存失败，请保持页面打开并释放浏览器存储空间。')}
 }
 function discard(){try{if(storage.getItem(examDraftKey(session.session_id))!==draftRaw.current){setError('另一窗口更新了草稿，请先重新读取考试。');return}storage.setItem(examDraftKey(session.session_id),'null');draftRaw.current='null';setInput({expected_revision:session.revision,answer_records:session.answer_records});setConflict(false);setError('')}catch{setError('无法清除本地草稿，请检查浏览器存储。')}}
 const result=session.result
 if(result)return <section className="zl-panel zl-exam-panel"><h2>{session.title} · 考试成绩</h2><div className="zl-goal-metrics"><div><span>正确率</span><strong>{result.accuracy}%</strong><small>{result.correct_count} / {result.total_questions} 道正确</small></div><div><span>未作答</span><strong>{result.unanswered_count} 道</strong><small>{result.reason==='timeout'?'已按截止前保存草稿结算':'已交卷'} · 经验值 {result.xp_gain}</small></div></div><p>交卷时间：{goalTime(result.submitted_at)}（{goalTimeZone()}）</p>
  <h3>各来源成绩</h3><ul>{result.by_source.map((s,i)=><li key={`${s.knowledge_point_id}:${s.content_version}`}>来源 {i+1}：{s.correct_count} / {s.count} · {s.accuracy}%<small className="zl-exam-version">知识点 {s.knowledge_point_id} · 版本 {s.content_version.slice(0,12)}</small></li>)}</ul>
  <button className="zl-primary" onClick={()=>onReport(result.quiz_id,result.attempt_id)}>查看本次成绩与独立 AI 报告</button><p className="zl-muted">报告由你另外发起，生成失败不影响成绩。考试结果不会自动改写学习书掌握度。</p>
  {result.questions.map((q,i)=>{const answer=result.answer_records.find(r=>r.question_id===q.id);return <details className="zl-exam-question" key={q.id}><summary>{i+1}. {q.stem} · {answer?.is_correct?'答对':'答错或未答'}</summary><p>你的答案：{answer?.selected_answers.join('、')||'未作答'} · 标准答案：{q.answer.join('、')}</p><ul>{q.options.map(o=><li key={o.key}>{o.key} · {o.text}</li>)}</ul><p>{q.explanation}</p></details>})}
 </section>
 return <section className="zl-panel zl-exam-panel"><h2>{session.title}</h2><div className="zl-exam-clock" aria-label="考试倒计时">{expired?'已到截止时间':remaining===0?'本机倒计时已归零，等待服务端核对':`剩余 ${Math.floor(remaining/60)} 分 ${remaining%60} 秒`}</div><p>截止：{goalTime(session.deadline_at)}（{goalTimeZone()}）</p><p className="zl-muted">倒计时按本机时钟估算，以服务端截止为准。退出或刷新不会延长时限；到期只结算此前已保存到服务端的草稿。</p>
  <p role="status">{dirty?'有本地修改尚未保存到服务端':'当前答案与服务端草稿一致'} · 已保存 {session.answer_records.filter(r=>r.selected_answers.length).length} / {session.questions.length} 道</p>
  {error&&<p className="zl-error" role="alert">{error}</p>}{conflict&&<div className="zl-notice"><p>服务端版本与本地草稿不同，请核对后丢弃旧草稿。不会自动覆盖服务端。</p><button className="zl-secondary" disabled={busy} onClick={discard}>丢弃本地修改，使用服务端草稿</button></div>}
  {expired&&<p className="zl-notice">已停止编辑。未保存的本地修改不计入到期成绩，请结算已保存的草稿。</p>}
  {session.questions.map((q,i)=><article className="zl-exam-question" key={q.id}><h3>{i+1}. {q.stem}</h3><p className="zl-muted">{q.type==='multiple'?'多选题，请选择全部正确选项':'单选题，选择一项；再次点击可清空'}</p>{q.image_url&&<img className="zl-question-image" src={q.image_url} alt="题目配图"/>}<div role="group" aria-label={`第 ${i+1} 题选项`} className="zl-options">{q.options.map(o=><button type="button" className={`zl-option ${input.answer_records.find(r=>r.question_id===q.id)?.selected_answers.includes(o.key)?'selected':''}`} aria-pressed={!!input.answer_records.find(r=>r.question_id===q.id)?.selected_answers.includes(o.key)} disabled={busy||conflict||expired} key={o.key} onClick={()=>choose(q,o.key)}><span className="zl-option-key">{o.key}</span>{o.text}</button>)}</div></article>)}
  <div className="zl-bank-controls"><button className="zl-secondary" disabled={busy||conflict||expired} onClick={()=>onSave(input)}>保存考试草稿</button><button className="zl-primary" disabled={busy||(!expired&&conflict)} onClick={()=>setConfirm(true)}>{expired?'结算到期成绩':'交卷'}</button></div>
  {confirm&&<div className="zl-notice"><p>{expired?'仅使用截止前服务端已保存答案结算。':'确认交卷后不能再修改答案，未答题计为错误。'}</p><button className="zl-primary" disabled={busy} onClick={()=>onSubmit(expired?{expected_revision:session.revision,answer_records:session.answer_records}:input)}>确认交卷</button><button className="zl-secondary" disabled={busy} onClick={()=>setConfirm(false)}>继续检查</button></div>}
 </section>
}
