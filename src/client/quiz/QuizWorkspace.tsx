import { RouteProvider, LocalLink, useNavigate } from './navigation.js'
import css from './styles.css'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, ChartNoAxesCombined, ChevronRight, CircleHelp, History, Layers3, LoaderCircle, Plus, Sparkles, Target, UserRound } from 'lucide-react'
import { QuizSetup } from './components/QuizSetup.js'
import { QuizPlayer } from './components/QuizPlayer.js'
import { QuizReport } from './components/QuizReport.js'
import { KnowledgePage } from './pages/KnowledgePage.js'
import { HistoryPage } from './pages/HistoryPage.js'
import { ProfilePage } from './pages/ProfilePage.js'
import type { QuizApi, GenerateInput } from './services/contracts.js'
import { emptySession, readSession, saveSession } from './services/session.js'
import type { KnowledgeDocumentItem, QuizDetailResponse, QuizHistoryItem, UserProfile } from './types.js'

// Creation outlives a panel mount: keep the pending promise per injected storage.
const pendingCreations = new WeakMap<object, Promise<ReturnType<typeof emptySession>>>()
const memorySessions = new WeakMap<object, ReturnType<typeof emptySession>>()

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'

export function Home({ api, docId, onGenerate, busy, profile }: { api: QuizApi; docId?: string; onGenerate(input: GenerateInput): void; busy: boolean; profile?: UserProfile }) {
  const [documents, setDocuments] = useState<KnowledgeDocumentItem[]>([])
  const [history, setHistory] = useState<QuizHistoryItem[]>([])
  const [error, setError] = useState('')
  const [refresh,setRefresh] = useState(0)
  useEffect(() => { let active = true
    Promise.allSettled([api.getDocuments(), api.getHistory()]).then(([docs, records]) => {
      if (!active) return
      if (docs.status === 'fulfilled') setDocuments(docs.value.items)
      if (records.status === 'fulfilled') setHistory(records.value.items.slice(0,3))
      setError([docs.status === 'rejected' ? `知识库：${errorMessage(docs.reason)}` : '', records.status === 'rejected' ? `历史记录：${errorMessage(records.reason)}` : ''].filter(Boolean).join('；'))
    })
    return () => { active = false }
  }, [api,refresh])
  return <><header className="zl-heading"><div className="zl-eyebrow"><span className="zl-small-line"/>练习</div><h1>创建练习</h1><p>输入主题或选择资料，生成一组练习题。</p></header>
    <div className="zl-home-grid"><div><QuizSetup key={docId ?? 'topic'} documents={documents} initialDocId={docId} busy={busy} onGenerate={onGenerate}/>{error && <p className="zl-error" role="alert">资料加载失败：{error}<button onClick={()=>setRefresh(n=>n+1)}>重试</button></p>}
      <div className="zl-section-title zl-recent-title"><h2>最近练习</h2><LocalLink href="#/history">全部记录<ArrowRight size={14}/></LocalLink></div>
      {history.length ? <div className="zl-recent-list">{history.map(item => <LocalLink href={`#/history/${encodeURIComponent(item.quiz_id)}`} key={item.quiz_id} className="zl-recent-item"><span className="zl-recent-icon"><BookOpen size={18}/></span><span><strong>{item.title}</strong><small>{item.question_count} 道题 · 正确率 {Math.round(item.accuracy)}%</small></span><ChevronRight size={16}/></LocalLink>)}</div> : <div className="zl-panel zl-empty-history"><BookOpen size={22}/><div><strong>暂无练习记录</strong><p>完成练习并生成报告后，可在这里查看。</p></div></div>}
    </div><aside className="zl-home-aside"><section className="zl-learning-note"><div className="zl-note-top"><span>使用步骤</span><Sparkles size={18}/></div><h2>创建、答题与复盘</h2><div className="zl-learning-path"><div><span>01</span><p><b>选择内容</b><small>输入主题，或选择自己的资料</small></p></div><div><span>02</span><p><b>逐题作答</b><small>逐题作答，即时查看讲解</small></p></div><div><span>03</span><p><b>查看复盘</b><small>查看答题结果与知识点分析</small></p></div></div><div className="zl-note-bottom"><Target size={15}/>完成后的报告保存到练习记录</div></section>
      <section className="zl-panel zl-week-card"><div><ChartNoAxesCombined size={18}/><span>练习统计</span></div><p><b>{profile?.quiz_count ?? 0}</b><span>次练习</span><b>{profile?.total_xp ?? 0}</b><span>经验值</span></p></section>
      <LocalLink href="#/knowledge" className="zl-knowledge-link"><Layers3 size={22}/><div><strong>从知识库出题</strong><small>打开我的知识库</small></div><ArrowRight size={17}/></LocalLink>
    </aside></div>
  </>
}
function HistoricalReport({ api, id }: { api: QuizApi; id: string }) {
  const navigate = useNavigate()
  const [detail,setDetail] = useState<QuizDetailResponse>(); const [error,setError] = useState(''); const [revision,setRevision] = useState(0)
  useEffect(() => { let active = true; setError(''); api.getDetail(id).then(data => { if (active) setDetail(data) }).catch(e => { if (active) setError(errorMessage(e)) }); return () => { active = false } }, [api,id,revision])
  if (error) return <div className="zl-error" role="alert">{error}<button onClick={() => setRevision(n=>n+1)}>重试</button></div>
  if (!detail) return <div className="zl-empty">正在读取报告…</div>
  if (!detail.report) return <div className="zl-panel zl-empty"><h2>{detail.title}</h2><p>这组练习尚未保存复盘报告。</p><LocalLink href="#/history">返回记录</LocalLink></div>
  return <QuizReport quiz={detail} records={detail.answer_records ?? []} report={detail.report} onRestart={() => navigate('/')}/>
}
export function QuizWorkspace({ api, storage, onExit, onOpenExtraction, initialRoute = '/' }: { api: QuizApi; storage: Pick<Storage, 'getItem' | 'setItem'>; onExit(): void; onOpenExtraction?(): void; initialRoute?: string }) {
  const [route,setRoute] = useState(initialRoute)
  const navigate = (path: string) => { setRoute(path); setError('') }
  const [ready,setReady] = useState(false); const [loginError,setLoginError] = useState(''); const [loginAttempt,setLoginAttempt] = useState(0)
  const [profile,setProfile] = useState<UserProfile>()
  const [session,setSession] = useState(() => memorySessions.get(storage) ?? readSession(storage))
  const [error,setError] = useState(''); const [creating,setCreating] = useState(() => pendingCreations.has(storage))
  const [reportBusy,setReportBusy] = useState(false); const [reportError,setReportError] = useState('')
  const [taskError,setTaskError] = useState(''); const [pollRevision,setPollRevision] = useState(0)
  const [taskStatus,setTaskStatus] = useState('正在准备学习内容…')
  const reportLock = useRef(false); const createLock = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const pending = pendingCreations.get(storage)
    if (pending) {
      setCreating(true)
      void pending.then(next => { if (mounted.current) { setSession(next); setRoute('/quiz') } })
        .catch(e => { if (mounted.current) setError(errorMessage(e)) })
        .finally(() => { if (mounted.current) setCreating(false) })
    }
    return () => { mounted.current = false }
  }, [storage])
  useEffect(() => {
    try { saveSession(storage,session); memorySessions.delete(storage) }
    catch { memorySessions.set(storage,session); setError('浏览器存储空间不足，刷新可能丢失当前答题进度。') }
  }, [session,storage])
  useEffect(() => { let active = true; setLoginError(''); api.connect().then(() => api.getProfile()).then(data => { if (active) { setProfile(data); setReady(true) } }).catch(e => { if (active) setLoginError(errorMessage(e)) }); return () => { active = false } }, [api,loginAttempt])
  useEffect(() => {
    if (!session.taskId || !ready) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; const started = Date.now()
    setTaskError('')
    async function poll() {
      try {
        const result = await api.getTask(session.taskId!,controller.signal)
        if (controller.signal.aborted) return
        if (result.status === 'failed') { setTaskError(result.error_message || '生成失败，请重新创建练习'); return }
        if (result.status === 'completed' && result.result) {
          if (!result.result.questions.length) { setTaskError('生成结果没有题目，请重新创建练习'); return }
          setSession({ quiz: result.result, records: [], index: 0 }); navigate('/quiz'); return
        }
        setTaskStatus(result.status === 'running' ? '正在读取资料并生成题目…' : '任务已创建，正在准备…')
        if (Date.now() - started > 15 * 60 * 1000) { setTaskError('等待时间较长，可以继续查询，或稍后回来。'); return }
        timer = setTimeout(poll,2500)
      } catch (e) { if (!controller.signal.aborted) setTaskError(errorMessage(e)) }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [api,session.taskId,ready,pollRevision])
  async function generate(input: GenerateInput) {
    if (createLock.current || pendingCreations.has(storage)) return
    if (session.quiz && !session.report && session.records.length && !window.confirm('开始新的练习将替换当前标签页未完成的答题进度，继续吗？')) return
    createLock.current = true; setCreating(true); setError('')
    const pending = api.generateQuiz(input).then(result => {
      const next = { ...emptySession(), taskId: result.task_id, taskStartedAt: Date.now() }
      try { saveSession(storage, next); memorySessions.delete(storage) } catch { memorySessions.set(storage, next) }
      return next
    }).finally(() => { pendingCreations.delete(storage) })
    pendingCreations.set(storage, pending)
    try { const next = await pending; if (mounted.current) { setSession(next); setTaskError(''); navigate('/quiz') } }
    catch (e) { if (mounted.current) setError(errorMessage(e)) }
    finally { createLock.current = false; if (mounted.current) setCreating(false) }
  }
  async function finish() {
    navigate('/report')
    if (!session.quiz || session.report || reportLock.current) return
    if (session.records.length !== session.quiz.questions.length) { setReportError('请先完成全部题目。'); return }
    reportLock.current = true; setReportBusy(true); setReportError('')
    try {
      // A previous request may have completed while this tab was reloaded.
      const existing = await api.getDetail(session.quiz.quiz_id).catch(() => null)
      const report = existing?.report ?? await api.generateReport({ quiz_id: session.quiz.quiz_id, topic: session.quiz.title, questions: session.quiz.questions, answer_records: session.records })
      setSession(previous => ({ ...previous, report }))
      api.getProfile().then(setProfile).catch(() => {})
    } catch (e) { setReportError(errorMessage(e)) }
    finally { reportLock.current = false; setReportBusy(false) }
  }
  const view = route.split('?')[0]
  const docId = new URLSearchParams(route.split('?')[1]).get('doc') ?? undefined
  const nav = [{ href:'/',label:'开始练习',icon:Plus }, { href:'/knowledge',label:'我的知识库',icon:BookOpen }, { href:'/history',label:'练习记录',icon:History }, { href:'/profile',label:'个人中心',icon:UserRound }]
  let content
  if (!ready) content = <div className="zl-panel zl-connection"><div className="zl-brand-mark"><Sparkles size={26}/></div><h1>{loginError ? '连接学习空间' : '正在打开学习空间…'}</h1><p>{loginError || '正在连接本机服务，读取你的学习资料。'}</p>{loginError && <><p className="zl-muted">请在 BetterLearn 设置中检查练习服务地址并重试。</p><button className="zl-primary" onClick={() => setLoginAttempt(n=>n+1)}>重新连接</button></>}</div>
  else if (view === '/knowledge') content = <>{onOpenExtraction && <button className="zl-secondary" type="button" onClick={onOpenExtraction}>从资料提取知识点</button>}<KnowledgePage api={api} onPractice={id=>navigate(`/?doc=${encodeURIComponent(id)}`)}/></>
  else if (view === '/history') content = <HistoryPage api={api} onOpen={id=>navigate(`/history/${encodeURIComponent(id)}`)}/>
  else if (view.startsWith('/history/')) content = <HistoricalReport key={view} api={api} id={decodeURIComponent(view.slice('/history/'.length))}/>
  else if (view === '/profile') content = <ProfilePage api={api} onSaved={()=> { api.getProfile().then(setProfile).catch(()=>{}) }}/>
  else if ((view === '/quiz' || view === '/report') && session.taskId) content = <div className="zl-panel zl-generation"><div className="zl-generating-orbit"><Sparkles size={35}/></div><div className="zl-eyebrow">生成练习</div><h1>{taskError ? '暂时无法获取生成结果' : taskStatus}</h1><p>正在处理资料、题目和讲解，完成后可开始答题。</p>{taskError ? <><p className="zl-error" role="alert">{taskError}</p><button className="zl-primary" onClick={()=>setPollRevision(n=>n+1)}>继续查询</button><button className="zl-secondary" onClick={()=> { setSession(emptySession()); navigate('/') }}>返回重新出题</button></> : <p className="zl-generating-status"><LoaderCircle size={18} className="zl-spin"/>正在处理 · 刷新页面后可继续等待</p>}</div>
  else if (view === '/quiz' && session.quiz) content = <QuizPlayer quiz={session.quiz} records={session.records} index={session.index} onAnswer={record=>setSession(previous=>({ ...previous, records:[...previous.records.filter(r=>r.question_id!==record.question_id),record] }))} onIndexChange={index=>setSession(previous=>({ ...previous,index }))} onFinish={()=>void finish()}/>
  else if (view === '/report' && session.quiz) content = <QuizReport quiz={session.quiz} records={session.records} report={session.report} busy={reportBusy} error={reportError} onRetry={()=>void finish()} onRestart={()=>navigate('/')}/>
  else content = <Home api={api} docId={docId} onGenerate={input=>void generate(input)} busy={creating || !!session.taskId || reportBusy} profile={profile}/>
  return <RouteProvider value={navigate}><div className="zl-module"><style>{css}</style><div className="zl-app"><aside className="zl-sidebar"><button className="zl-back" type="button" onClick={onExit}>返回 BetterLearn</button><LocalLink className="zl-brand" href="#/"><span className="zl-brand-mark"><Layers3 size={24}/></span><span>BetterLearn<small>练习与知识库</small></span></LocalLink><div className="zl-nav-label">学习工作台</div><nav aria-label="主导航">{nav.map(({href,label,icon:Icon}) => <LocalLink href={`#${href}`} key={href} aria-current={view === href ? 'page' : undefined}><Icon size={19}/><span>{label}</span>{view===href && <span className="zl-nav-dot"/>}</LocalLink>)}</nav><div className="zl-sidebar-bottom"><div className="zl-sidebar-note"><CircleHelp size={17}/><p>选择资料，生成练习。<br/>完成后查看复盘报告。</p></div><LocalLink className="zl-user" href="#/profile"><span className="zl-avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt="我的头像"/> : profile?.nickname[0] || '学'}</span><span><strong>{profile?.nickname || '学习者'}</strong><small>BetterLearn 学习空间</small></span><ChevronRight size={15}/></LocalLink></div></aside>
    <div className="zl-main"><div className="zl-topbar"><span>我的学习空间<ChevronRight size={12}/><b>{nav.find(n=>n.href===view)?.label || '练习与复盘'}</b></span><span className="zl-local-status"><i/>宿主连接</span></div><main>{error && <p className="zl-error" role="alert">{error}</p>}{ready && view !== '/quiz' && view !== '/report' && (session.taskId || (session.quiz && !session.report)) && <LocalLink href="#/quiz" className="zl-resume">{session.taskId ? '你有一组正在生成的练习' : '继续上次未完成的练习'}<ArrowRight size={15}/></LocalLink>}{content}</main><footer className="zl-app-footer">BetterLearn · 练习与知识库</footer></div>
  </div></div></RouteProvider>
}
