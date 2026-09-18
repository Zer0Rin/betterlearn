import {useEffect,useState} from 'react'
import type {BankPage} from '../bank-types.js'
import type {KnowledgeAnswer,KnowledgeStats,KnowledgeStatsApi} from '../knowledge-stats-types.js'
import type {ExamSource} from '../exam-types.js'
import {goalTime,goalTimeZone} from '../services/goal-time.js'
const percent=(value:number)=>`${value.toLocaleString('zh-CN',{maximumFractionDigits:2})}%`
function Pages({page,total,loading,onPage}:{page:number;total:number;loading:boolean;onPage(page:number):void}){
 return total>20?<div className="zl-pagination"><button className="zl-secondary" disabled={loading||page===1} onClick={()=>onPage(page-1)}>统计上一页</button><span>{page} / {Math.ceil(total/20)}</span><button className="zl-secondary" disabled={loading||page*20>=total} onClick={()=>onPage(page+1)}>统计下一页</button></div>:null
}
function KnowledgeHistory({api,source,onBack,onAttempt}:{api:KnowledgeStatsApi;source:ExamSource;onBack():void;onAttempt(quizId:string,attemptId:string):void}){
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<BankPage<KnowledgeAnswer>>(),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setData(undefined)
  api.getKnowledgeHistory({knowledge_point_id:source.knowledge_point_id,content_version:source.content_version,page},controller.signal).then(value=>{
   if(controller.signal.aborted)return
   const last=Math.max(1,Math.ceil(value.total/20));if(page>last){setPage(last);return}setData(value)
  }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'无法读取作答记录')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[api,source.knowledge_point_id,source.content_version,page,revision])
 return <section className="zl-panel zl-goal-detail"><div className="zl-bank-controls"><button className="zl-secondary" onClick={onBack}>返回知识点统计</button><button className="zl-secondary" disabled={loading} onClick={()=>setRevision(n=>n+1)}>重新读取作答记录</button></div>
 <h2>{source.title} · 作答记录</h2><p>{source.statement}</p><details><summary>本次查看的知识点版本</summary><p className="zl-goal-version">{source.content_version}</p></details><p className="zl-muted">按记录入库顺序从新到旧排列；时间显示为 {goalTimeZone()}。</p>
 {error&&<p role="alert" className="zl-error">{error}</p>}{loading?<p role="status">正在读取作答记录…</p>:data?.items.length?<ol className="zl-bank-history">{data.items.map(item=><li key={`${item.entry_id}:${item.attempt_id}`}><div><strong>{item.is_correct?'答对':'答错'}</strong><p>所选答案：{item.selected_answers.join('、')||'未选择答案'} · {Math.round(item.duration_ms/1000)} 秒</p><time>{goalTime(item.submitted_at)}</time></div><button className="zl-secondary" onClick={()=>onAttempt(item.quiz_id,item.attempt_id)}>查看这次成绩</button></li>)}</ol>:!error&&<p>此版本暂无可计入的作答记录。</p>}
 {data&&<><p>共 {data.total} 次作答</p><Pages page={page} total={data.total} loading={loading} onPage={setPage}/></>}
 </section>
}
export function KnowledgeStatistics({api,onAttempt}:{api:KnowledgeStatsApi;onAttempt(quizId:string,attemptId:string):void}){
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<BankPage<KnowledgeStats>>(),[selected,setSelected]=useState<ExamSource>(),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setData(undefined)
  api.getKnowledgeStats({page},controller.signal).then(value=>{
   if(controller.signal.aborted)return
   const last=Math.max(1,Math.ceil(value.total/20));if(page>last){setPage(last);return}setData(value)
  }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'无法读取知识点统计')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[api,page,revision])
 if(selected)return <KnowledgeHistory key={`${selected.knowledge_point_id}:${selected.content_version}`} api={api} source={selected} onBack={()=>setSelected(undefined)} onAttempt={onAttempt}/>
 return <section className="zl-panel zl-goal-detail zl-knowledge-statistics"><div className="zl-bank-controls"><h2>知识点版本统计</h2><button className="zl-secondary" disabled={loading} onClick={()=>setRevision(n=>n+1)}>重新读取知识点统计</button></div>
 <p>仅统计交卷时已关联来源的有效答案。同一知识点的不同版本分别统计；之后绑定或解绑不会改变旧记录。</p>
 <p className="zl-muted">首次／最近正确率分别取每道不同题目的第一次／最后一次答案。相同内容重复作答不增加不同题目数；这些统计不代表课程掌握度。</p>
 {error&&<p role="alert" className="zl-error">{error}</p>}
 {loading?<p role="status">正在读取知识点统计…</p>:data?.items.length?<><p>共 {data.total} 个知识点版本</p><div className="zl-knowledge-stat-list">{data.items.map(item=><article key={`${item.source.knowledge_point_id}:${item.source.content_version}`}><h3>{item.source.title}</h3><p>{item.source.statement}</p>
 <dl className="zl-goal-statistics"><div><dt>首次正确率</dt><dd>{percent(item.first_accuracy)}</dd></div><div><dt>最近正确率</dt><dd>{percent(item.latest_accuracy)}</dd></div><div><dt>不同题目</dt><dd>{item.distinct_question_count} 道</dd></div><div><dt>重复作答</dt><dd>{item.repeated_answer_count} 次</dd></div></dl>
 <p>累计 {item.answer_count} 次作答 · 总正确率 {percent(item.accuracy)} · {item.attempt_count} 轮交卷</p><p className="zl-muted">最近入库的作答：{goalTime(item.last_answered_at)}</p>
 <details><summary>查看历史知识点版本</summary><p className="zl-goal-version">{item.source.content_version}</p><p>这是交卷时保存的历史来源，不一定与当前课程内容相同。</p></details>
 <button className="zl-secondary" onClick={()=>setSelected(item.source)}>查看此版本作答</button></article>)}</div></>:!error&&<p>暂无知识点作答统计。请先按知识点出题，或在题库绑定来源，再完成交卷。已绑定但尚未交卷的题目不会显示为零分。</p>}
 {data&&<Pages page={page} total={data.total} loading={loading} onPage={setPage}/>}
 </section>
}
