import {useEffect,useRef,useState} from 'react'
import type {QuizApi} from '../services/contracts.js'
import type {ExamSource,PaperInput,PaperPreview} from '../exam-types.js'
const sourceKey=(s:ExamSource)=>`${s.knowledge_point_id}:${s.content_version}`
export function ExamBuilder({api,busy,onCreate,onCancel}:{api:QuizApi;busy:boolean;onCreate(input:PaperInput):void;onCancel():void}) {
 const [title,setTitle]=useState('');const [minutes,setMinutes]=useState('30');const [page,setPage]=useState(1);const [total,setTotal]=useState(0)
 const [sources,setSources]=useState<ExamSource[]>([]);const [selected,setSelected]=useState<{source:ExamSource;count:number}[]>([])
 const [loading,setLoading]=useState(false);const [checking,setChecking]=useState(false);const [error,setError]=useState('');const [preview,setPreview]=useState<{key:string;data:PaperPreview}>();const [refresh,setRefresh]=useState(0)
 const input:PaperInput={title:title.trim(),duration_seconds:Number(minutes)*60,allocations:selected.map(({source,count})=>({knowledge_point_id:source.knowledge_point_id,content_version:source.content_version,count}))}
 const signature=JSON.stringify(input);const current=useRef(signature);current.current=signature
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');api.getBankEntries({page,page_size:20},abort.signal).then(result=>{if(!abort.signal.aborted){setSources([...new Map(result.items.flatMap(e=>e.source?[[sourceKey(e.source),e.source] as const]:[])).values()]);setTotal(result.total)}}).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return()=>abort.abort()},[api,page,refresh])
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 async function check(){
  if(checking||busy)return
  setError('');setPreview(undefined)
  if(!input.title||[...input.title].length>120||!Number.isInteger(input.duration_seconds)||input.duration_seconds<60||input.duration_seconds>14400||!selected.length||selected.length>20||input.allocations.some(a=>!Number.isInteger(a.count)||a.count<1||a.count>100)||input.allocations.reduce((n,a)=>n+a.count,0)>100){setError('请填写名称、1～240 分钟时长、1～20 个来源，每来源 1～100 题且总数不超过 100。');return}
  const key=signature;setChecking(true)
  try{const data=await api.previewPaper(input);if(mounted.current&&current.current===key)setPreview({key,data})}catch(e){if(mounted.current&&current.current===key)setError(e instanceof Error?e.message:'预览失败')}finally{if(mounted.current)setChecking(false)}
 }
 const checked=preview?.key===signature?preview.data:undefined
 return <section className="zl-panel zl-exam-panel"><h2>多来源组卷</h2><p>按题库里已绑定的知识点版本分配题数。全卷会去除内容完全相同的题目，不会自动调用模型补题。</p>
  {error&&<p className="zl-error" role="alert">{error}</p>}
  <fieldset className="zl-goal-form" disabled={busy}><label>试卷名称<input aria-label="试卷名称" maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>考试时长（分钟）<input aria-label="考试时长" type="number" min={1} max={240} step={1} value={minutes} onChange={e=>setMinutes(e.target.value)}/></label></fieldset>
  <h3>选择题库来源</h3><p className="zl-muted">按题库每 20 道题浏览其来源；未绑定知识点的题目不显示为来源。同一版本可以跨页出现，但只选择一次。</p>
  <button className="zl-secondary" disabled={loading||busy} onClick={()=>{setPreview(undefined);setRefresh(n=>n+1)}}>刷新题库来源</button>
  {loading?<p role="status">正在读取题库来源…</p>:sources.length?sources.map(s=><label className="zl-exam-source" key={sourceKey(s)}><input type="checkbox" aria-label={`选择来源：${s.title} ${s.content_version.slice(0,8)}`} checked={selected.some(x=>sourceKey(x.source)===sourceKey(s))} disabled={busy||(!selected.some(x=>sourceKey(x.source)===sourceKey(s))&&selected.length>=20)} onChange={e=>setSelected(rows=>e.target.checked?[...rows,{source:s,count:1}]:rows.filter(x=>sourceKey(x.source)!==sourceKey(s)))}/><span>{s.title}<small>版本 {s.content_version.slice(0,12)} · {s.statement}</small></span></label>):<p>本页没有已绑定的知识点来源。可浏览下一页；来源出题或题库关联完成后再刷新。</p>}
  {total>20&&<div className="zl-pagination"><button className="zl-secondary" disabled={loading||busy||page===1} onClick={()=>setPage(n=>n-1)}>上一页来源</button><span>题库第 {page} / {Math.ceil(total/20)} 页</span><button className="zl-secondary" disabled={loading||busy||page*20>=total} onClick={()=>setPage(n=>n+1)}>下一页来源</button></div>}
  <h3>来源配额</h3>{selected.map(({source,count},i)=><div className="zl-exam-allocation" key={sourceKey(source)}><label>{source.title} · {source.content_version.slice(0,8)}<input aria-label={`来源题数 ${i+1}`} type="number" min={1} max={100} value={count} disabled={busy} onChange={e=>setSelected(rows=>rows.map((row,index)=>index===i?{...row,count:Number(e.target.value)}:row))}/></label><button className="zl-secondary" disabled={busy} onClick={()=>setSelected(rows=>rows.filter((_,index)=>index!==i))}>移除此来源</button></div>)}
  <div className="zl-bank-controls"><button className="zl-primary" disabled={busy||checking||loading} onClick={()=>void check()}>{checking?'正在预览…':'预览组卷缺口'}</button><button className="zl-secondary" disabled={busy} onClick={onCancel}>返回列表</button></div>
  {checked&&<section aria-label="组卷预览"><h3>{checked.ready?'题数已满足，可以创建试卷':'题目不足，请调整配额或补充题库'}</h3><ul>{checked.coverage.map((c,i)=><li key={`${c.knowledge_point_id}:${c.content_version}`}>{selected[i]?.source.title}：需要 {c.count}，选中 {c.selected}，缺少 {c.missing}，可用不同内容 {c.available_distinct}，无效候选 {c.invalid_count}</li>)}</ul><p className="zl-muted">跨来源的重复内容仅能占一个名额。创建会冻结当时选中的题目，之后还需逐题审核。</p><button className="zl-primary" disabled={busy||!checked.ready} onClick={()=>onCreate(input)}>创建冻结试卷</button></section>}
 </section>
}
