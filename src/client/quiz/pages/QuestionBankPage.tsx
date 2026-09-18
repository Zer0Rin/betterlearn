import type {LearningCourse} from '../../types.js'
import type {PracticeStorage} from '../services/practice.js'
import { useEffect, useRef, useState } from 'react'
import type { BankCategory, BankEntry, BankPage, BankQuery, BankScope, BankStats } from '../bank-types.js'
import type { QuizApi } from '../services/contracts.js'
import { BankCategoryManager } from '../components/BankCategoryManager.js'
import { QuestionBankDetail, bankResultLabel } from './QuestionBankDetail.js'
const scopes: {scope:BankScope;label:string;stat:keyof BankStats}[]=[{scope:'all',label:'全部题目',stat:'total'},{scope:'wrong',label:'当前错题',stat:'wrong'},{scope:'ever_wrong',label:'曾经答错',stat:'ever_wrong'},{scope:'bookmarked',label:'我的收藏',stat:'bookmarked'},{scope:'uncategorized',label:'未分类',stat:'uncategorized'}]
interface Props {api:QuizApi;storage?:PracticeStorage;loadCourses?:()=>Promise<LearningCourse[]>;onPractice(quizId:string):void;onAttempt(quizId:string,attemptId:string):void}
export function QuestionBankPage({api,storage,loadCourses,onPractice,onAttempt}:Props) {
  const [query,setQuery]=useState<BankQuery>({page:1,scope:'all',sort:'recent',search:''})
  const [search,setSearch]=useState('');const [entries,setEntries]=useState<BankPage<BankEntry>>()
  const [stats,setStats]=useState<BankStats>();const [categories,setCategories]=useState<BankCategory[]>([])
  const [selected,setSelected]=useState<number>();const [manage,setManage]=useState(false)
  const [revision,setRevision]=useState(0);const [loading,setLoading]=useState(true);const [writing,setWriting]=useState(false)
  const [uncertain,setUncertain]=useState(false);const [error,setError]=useState('');const lock=useRef(false);const mounted=useRef(false)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{
    const controller=new AbortController();setLoading(true)
    Promise.all([api.getBankEntries(query,controller.signal),api.getBankStats(),api.getBankCategories()]).then(([list,counts,folders])=>{
      if(controller.signal.aborted)return
      if(list.total>0 && (query.page??1)>Math.ceil(list.total/20)){setQuery(q=>({...q,page:Math.ceil(list.total/20)}));return}
      if(list.total===0 && query.page!==1){setQuery(q=>({...q,page:1}));return}
      setEntries(list);setStats(counts);setCategories(folders.items);setError('');setUncertain(false)
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[api,query,revision])
  function filter(change:Partial<BankQuery>){setLoading(true);setQuery(q=>({...q,...change,page:1}))}
  async function organize(action:()=>Promise<unknown>,deletedId?:number):Promise<boolean> {
    if(lock.current||loading||uncertain)return false
    lock.current=true;setWriting(true);setError('')
    try {
      await action()
      if(mounted.current){if(deletedId===query.category_id)setQuery(q=>({...q,category_id:undefined,page:1}));setLoading(true);setRevision(n=>n+1)}
      return true
    } catch(e){if(mounted.current){setError(`${e instanceof Error?e.message:'操作未完成'}。请先重新读取分类，核对结果后再操作。`);setUncertain(true)}return false}
    finally{lock.current=false;if(mounted.current)setWriting(false)}
  }
  if(selected!==undefined)return <QuestionBankDetail storage={storage} loadCourses={loadCourses} key={selected} api={api} id={selected} categories={categories} onBack={()=>{setSelected(undefined);setRevision(n=>n+1)}} onChanged={()=>setRevision(n=>n+1)} onPractice={onPractice} onAttempt={onAttempt}/>
  return <>
    <header className="zl-heading"><div className="zl-eyebrow">题库与错题</div><h1>我的题库</h1><p>整理题目，查看每次交卷记录。当前错题以最近一次作答为准，曾经答错保留历史。</p></header>
    <nav className="zl-bank-scopes" aria-label="题目范围">{scopes.map(s=><button type="button" key={s.scope} className="zl-secondary" aria-label={s.label} aria-pressed={query.scope===s.scope} disabled={writing} onClick={()=>filter({scope:s.scope,category_id:s.scope==='uncategorized'?undefined:query.category_id})}>{s.label}<span>{stats?.[s.stat]??'—'}</span></button>)}</nav>
    <section className="zl-panel zl-bank-toolbar"><form className="zl-bank-controls" aria-label="题库搜索" onSubmit={e=>{e.preventDefault();if(!writing)filter({search:search.trim()})}}><input aria-label="搜索题目" maxLength={200} placeholder="搜索题干、解析或题目标签" value={search} disabled={writing} onChange={e=>setSearch(e.target.value)}/><button className="zl-primary" disabled={writing}>搜索</button></form>
      <div className="zl-bank-controls"><label>分类 <select aria-label="筛选分类" value={query.category_id??''} disabled={writing} onChange={e=>filter({category_id:e.target.value?Number(e.target.value):undefined,...(query.scope==='uncategorized'?{scope:'all' as const}:{})})}><option value="">全部分类</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}（{c.entry_count}）</option>)}</select></label>
        <label>排序 <select aria-label="题目排序" value={query.sort} disabled={writing} onChange={e=>filter({sort:e.target.value as BankQuery['sort']})}><option value="recent">最新入库</option><option value="oldest">最早入库</option></select></label>
        <button className="zl-secondary" onClick={()=>setManage(v=>!v)}>{manage?'收起分类管理':'管理分类'}</button><button className="zl-secondary" disabled={writing||loading} onClick={()=>setRevision(n=>n+1)}>重新读取分类与题目</button></div>
    </section>
    {error && <p className="zl-error" role="alert">{error}</p>}
    {manage && <BankCategoryManager categories={categories} busy={writing||loading||uncertain} onCreate={name=>organize(()=>api.createBankCategory(name))} onRename={(id,name)=>organize(()=>api.renameBankCategory(id,name))} onDelete={id=>organize(()=>api.deleteBankCategory(id),id)}/>}
    {loading?<p className="zl-empty" role="status">正在读取题库…</p>:entries?.items.length?<div className="zl-bank-list">{entries.items.map(entry=><article className="zl-panel zl-bank-card" key={entry.id}><div className="zl-bank-card-meta"><span>{bankResultLabel(entry.is_correct)}</span>{entry.bookmarked && <span>已收藏</span>}<span>{entry.attempt_count} 次作答</span></div><h2>{entry.question.stem}</h2><p className="zl-muted">{entry.title} · {entry.categories.map(c=>c.name).join('、')||'未分类'}</p><button className="zl-secondary" onClick={()=>setSelected(entry.id)}>查看题目</button></article>)}</div>:!error && <section className="zl-panel zl-empty"><h2>当前范围没有题目</h2><p>已生成的练习题会进入题库；交卷后更新错题与作答历史。</p></section>}
    {entries && entries.total>20 && <div className="zl-pagination"><button className="zl-secondary" disabled={loading||writing||query.page===1} onClick={()=>setQuery(q=>({...q,page:(q.page??1)-1}))}>上一页</button><span>{query.page} / {Math.ceil(entries.total/20)} · 共 {entries.total} 题</span><button className="zl-secondary" disabled={loading||writing||(query.page??1)*20>=entries.total} onClick={()=>setQuery(q=>({...q,page:(q.page??1)+1}))}>下一页</button></div>}
  </>
}
