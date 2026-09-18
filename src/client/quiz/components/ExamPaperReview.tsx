import {useState} from 'react'
import type {ExamPaper,PaperReview} from '../exam-types.js'
export function ExamPaperReview({paper,busy,onReview,onStart}:{paper:ExamPaper;busy:boolean;onReview(reviews:PaperReview[]):void;onStart():void}) {
 const [reviews,setReviews]=useState<PaperReview[]>(()=>paper.items.map(item=>paper.reviews.find(r=>r.question_id===item.question.id)??{question_id:item.question.id,approved:false,note:''}))
 const [confirm,setConfirm]=useState(false)
 const dirty=JSON.stringify(reviews)!==JSON.stringify(paper.items.map(item=>paper.reviews.find(r=>r.question_id===item.question.id)??{question_id:item.question.id,approved:false,note:''}))
 const approved=paper.status==='approved'&&!dirty
 return <section className="zl-panel zl-exam-panel"><h2>{paper.title}</h2><p>{paper.items.length} 道题 · {paper.duration_seconds/60} 分钟 · {paper.status==='approved'?'审核已通过':'待覆盖审核'}</p><p className="zl-muted">逐题核对题意、答案和来源，再明确勾选通过。配额满足不代表语义覆盖；这是一份可查原题库的本机自测。</p>
  {paper.items.map((item,i)=><article className="zl-exam-question" key={item.question.id}><h3>{i+1}. {item.question.stem}</h3>{item.question.image_url&&<img className="zl-question-image" src={item.question.image_url} alt="题目配图"/>}<ul>{item.question.options.map(o=><li key={o.key}>{o.key} · {o.text}</li>)}</ul><p>标准答案：{item.question.answer.join('、')}</p><p>{item.question.explanation}</p><aside className="zl-notice"><strong>来源：{item.source.title}</strong><p>{item.source.statement}</p><small>版本 {item.source.content_version.slice(0,12)}</small></aside>
   <label className="zl-exam-source"><input aria-label={`通过第 ${i+1} 题审核`} type="checkbox" checked={reviews[i].approved} disabled={busy} onChange={e=>{setConfirm(false);setReviews(rows=>rows.map((r,n)=>n===i?{...r,approved:e.target.checked}:r))}}/>已核对，本题覆盖该来源</label><label>审核备注<textarea aria-label={`第 ${i+1} 题审核备注`} maxLength={1000} disabled={busy} value={reviews[i].note} onChange={e=>{setConfirm(false);setReviews(rows=>rows.map((r,n)=>n===i?{...r,note:e.target.value}:r))}}/></label>
  </article>)}
  <div className="zl-bank-controls"><button className="zl-secondary" disabled={busy} onClick={()=>onReview(reviews)}>保存覆盖审核</button><button className="zl-primary" disabled={busy||!approved} onClick={()=>setConfirm(true)}>开始计时考试</button></div>
  {dirty&&<p className="zl-muted">审核修改尚未保存。</p>}<p className="zl-muted">全部题目通过并保存后才能开考。首次开考后此卷审核锁定，调整请重新组卷。</p>
  {confirm&&<div className="zl-notice"><p>确认后立即开始 {paper.duration_seconds/60} 分钟计时；退出或刷新不会延长截止时间。</p><button className="zl-primary" disabled={busy||!approved} onClick={onStart}>确认开考</button><button className="zl-secondary" disabled={busy} onClick={()=>setConfirm(false)}>暂不开考</button></div>}
 </section>
}
