import { LocalLink } from '../navigation.js'
import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpenCheck } from 'lucide-react'
import type { QuizApi } from '../services/contracts.js'
import type { QuizHistoryItem } from '../types.js'

export function HistoryPage({ api, onOpen }: { api: QuizApi; onOpen(id: string): void }) {
  const [items, setItems] = useState<QuizHistoryItem[]>([])
  const [page, setPage] = useState(1); const [total, setTotal] = useState(0)
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true; setLoading(true); setError('')
    api.getHistory(page).then(data => { if (active) { setItems(data.items); setTotal(data.total) } }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, page, refresh])
  return <><header className="zl-heading"><div className="zl-eyebrow">练习记录</div><h1>练习历史</h1><p>继续草稿，查看各轮成绩与 AI 报告。</p></header>
    {error && <div className="zl-error" role="alert">{error}<button onClick={() => setRefresh(n => n + 1)}>重试</button></div>}
    <section className="zl-panel zl-history"><div className="zl-section-title"><h2>全部练习</h2><span>{total} 次记录</span></div>{loading ? <p className="zl-empty">加载中…</p> : items.length ? items.map(item => <button className="zl-history-row" key={item.quiz_id} onClick={() => onOpen(item.quiz_id)}><span className="zl-history-icon"><BookOpenCheck size={22}/></span><span className="zl-history-name"><strong>{item.title}</strong><small>{item.submitted_at ?? item.created_at}{item.status === 'submitted' ? ` · ${item.question_count} 道题` : ''}</small></span><span className="zl-history-score">{item.status === 'submitted' ? <>{Math.round(item.accuracy)}<small>%</small></> : '未交卷'}</span><ArrowUpRight size={19}/></button>) : <div className="zl-empty"><h3>还没有练习记录</h3><p>创建练习后，可在这里继续作答和查看成绩。</p><LocalLink className="zl-primary" href="#/">开始第一组练习</LocalLink></div>}</section>
    {total > 10 && <div className="zl-pagination"><button className="zl-secondary" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} / {Math.ceil(total/10)} 页</span><button className="zl-secondary" disabled={page * 10 >= total || loading} onClick={() => setPage(p => p + 1)}>下一页</button></div>}
  </>
}
