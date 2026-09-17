import { GlassBackdrop } from './GlassBackdrop.js'
import { normalizeGlassFrost, readGlassFrost, writeGlassFrost } from './glass-preference.js'
import { WorkbenchWindow } from './WorkbenchWindow.js'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, FileText, GraduationCap, History, Layers3, Settings2, ChartNoAxesCombined } from 'lucide-react'
import { createClientApi } from '../client/client-api.js'
import { NobeiWorkspace } from '../client/NobeiClientView.js'
import { LearningBookComposer, LearningBookshelf, type LearningBookDraftResult } from '../client/components/LearningLibrary.js'
import { LearningSpace } from '../client/components/LearningSpace.js'
import { createLearningBook, hasLearningStarted, reviseLearningBook, updateLearningBookCourse, type LearningBook } from '../client/learning-book-library.js'
import { readLearningLayout, writeLearningLayout } from '../client/learning-layout.js'
import { detachedModelSelection, ModelDirectoryBridgeError, type ModelDirectorySnapshot } from '../client/model-directory-bridge.js'
import { QuizWorkspace } from '../client/quiz/QuizWorkspace.js'
import { createQuizApi } from '../client/quiz/services/api.js'
import type { ClientApi, KnowledgePointSnapshot, LearningCourse } from '../client/types.js'
import { requestJson, RequestError, Settings } from './Settings.js'

type Area = 'knowledge' | 'library' | 'quiz' | 'settings' | 'compose' | 'learning'
type BookDraft = {points: KnowledgePointSnapshot[]; sourceText: string; editingBook?: LearningBook}
const navigation = [
  {area:'library',label:'学习空间',icon:BookOpen,group:'资料'},
  {area:'quiz',label:'知识库',icon:Layers3,route:'/knowledge'},
  {area:'knowledge',label:'知识提取',icon:FileText},
  {area:'quiz',label:'开始练习',icon:GraduationCap,route:'/',group:'练习'},
  {area:'quiz',label:'练习历史',icon:History,route:'/history'},
  {area:'quiz',label:'学习统计',icon:ChartNoAxesCombined,route:'/profile'},
  {area:'settings',label:'设置',icon:Settings2,group:'偏好设置'},
] as const

export function StandaloneApp({api, fetcher = globalThis.fetch, storage = window.localStorage}: {
  api?: ClientApi; fetcher?: typeof fetch; storage?: Storage
}) {
  const [glassFrost,setGlassFrost] = useState(()=>readGlassFrost(storage))
  const [glassSaved,setGlassSaved] = useState(true)
  function changeGlassFrost(value: number) {
    const next = normalizeGlassFrost(value)
    setGlassFrost(next); setGlassSaved(writeGlassFrost(storage,next))
  }
  const clientApi = useMemo(()=>api ?? createClientApi(),[api,fetcher])
  const quizApi = useMemo(()=>createQuizApi({fetch:fetcher}),[fetcher])
  const [area,setArea] = useState<Area>('library')
  const [quizRoute,setQuizRoute] = useState('/')
  const [historyOpen,setHistoryOpen] = useState(false)
  const [directory,setDirectory] = useState<ModelDirectorySnapshot>({current:null,routable:null,status:'loading'})
  const directoryRef = useRef(directory)
  const [modelError,setModelError] = useState('')
  const [books,setBooks] = useState<LearningBook[]>([])
  const booksRef = useRef(books)
  const [libraryReady,setLibraryReady] = useState(false)
  const [loadError,setLoadError] = useState('')
  const [saveError,setSaveError] = useState('')
  const [pendingSaves,setPendingSaves] = useState(0)
  const queue = useRef(Promise.resolve())
  const saveRevision = useRef(0)
  const libraryRevision = useRef(0)
  const conflicted = useRef(false)
  const deletedBookIds = useRef(new Set<string>())
  const [libraryConflict,setLibraryConflict] = useState(false)
  const [draft,setDraft] = useState<BookDraft>()
  const [activeBookId,setActiveBookId] = useState<string>()
  const [newBookId,setNewBookId] = useState<string>()
  const [layout,setLayout] = useState(()=>readLearningLayout(storage))
  const [loadRevision,setLoadRevision] = useState(0)

  const refreshModel = useCallback(async () => {
    try {
      const value = await requestJson<unknown>(fetcher,'/api/model')
      const current = detachedModelSelection(value) ?? null
      const next: ModelDirectorySnapshot = {current,routable:!!current,status:'ready'}
      directoryRef.current = next; setDirectory(next); setModelError('')
      return current
    } catch {
      const next: ModelDirectorySnapshot = {current:null,routable:false,status:'error'}
      directoryRef.current = next; setDirectory(next); setModelError('无法读取模型配置，请检查本地服务。')
      return null
    }
  },[fetcher])
  const loadModelSelection = useCallback(async () => {
    const model = await refreshModel()
    if (!model) throw new ModelDirectoryBridgeError('MODEL_SELECTION_UNAVAILABLE')
    return model
  },[refreshModel])
  const readModelDirectory = useCallback(()=>directoryRef.current,[])
  useEffect(()=>{void refreshModel()},[refreshModel])
  useEffect(()=>{
    let active = true
    setLoadError('')
    requestJson<{books:LearningBook[];revision:number}>(fetcher,'/api/library').then(value=>{
      if (!active) return
      if (!Array.isArray(value.books) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid library')
      libraryRevision.current = value.revision; deletedBookIds.current.clear(); conflicted.current = false; setLibraryConflict(false);setSaveError('')
      booksRef.current = value.books; setBooks(value.books); setLibraryReady(true)
    }).catch(()=>{if(active) setLoadError('学习书加载失败。请重试，避免覆盖已有书库。')})
    return ()=>{active=false}
  },[fetcher,loadRevision])
  useEffect(()=>{
    if (typeof window === 'undefined' || (!pendingSaves && !saveError)) return
    const warn = (event: BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    window.addEventListener('beforeunload',warn)
    return ()=>window.removeEventListener('beforeunload',warn)
  },[pendingSaves,saveError])

  function persist(next: LearningBook[]) {
    const revision = ++saveRevision.current
    setPendingSaves(n=>n+1)
    // All snapshots are ordered; a failed write cannot prevent a later full snapshot from saving.
    queue.current = queue.current.then(async()=>{
      try {
        if (conflicted.current) return
        const saved = await requestJson<{revision:number}>(fetcher,'/api/library',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({books:next.filter(book=>!deletedBookIds.current.has(book.bookId)),expectedRevision:libraryRevision.current})})
        libraryRevision.current = saved.revision
        if (revision === saveRevision.current) setSaveError('')
      } catch (error) {
        if (error instanceof RequestError && error.status === 409) {
          conflicted.current = true;setLibraryConflict(true)
          setSaveError('学习书已在其他页面更新。当前修改仍保留在此页面；请核对后重新加载最新学习书。')
        } else setSaveError('学习书尚未保存到本机。请保持页面打开并重试保存。')
      }
      finally {setPendingSaves(n=>n-1)}
    })
  }
  function changeBooks(next:LearningBook[]) { booksRef.current=next; setBooks(next); persist(next) }
  function finishBook(result:LearningBookDraftResult) {
    if (!draft || !libraryReady) return
    const identity = {bookId:`book-${crypto.randomUUID()}`,createdAt:new Date().toISOString()}
    const revision = draft.editingBook ? reviseLearningBook(draft.editingBook,result,identity)
      : {book:createLearningBook({...result,sourceText:draft.sourceText},identity)}
    changeBooks(revision.replacesBookId ? booksRef.current.map(book=>book.bookId===revision.replacesBookId?revision.book:book) : [revision.book,...booksRef.current])
    setNewBookId(revision.replacesBookId ? undefined : revision.book.bookId);setDraft(undefined);setArea('library')
  }
  async function deleteBook(book:LearningBook) {
    setPendingSaves(n=>n+1)
    const deletion = queue.current.then(async()=>{
      try {
        if (conflicted.current) throw new RequestError(409,'请先重新加载最新学习书。')
        const saved = await requestJson<{books:LearningBook[];revision:number}>(fetcher,`/api/library/books/${encodeURIComponent(book.bookId)}`,{
          method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:libraryRevision.current}),
        })
        libraryRevision.current = saved.revision
        deletedBookIds.current.add(book.bookId)
        const next = booksRef.current.filter(candidate=>candidate.bookId!==book.bookId)
        booksRef.current=next;setBooks(next)
      } catch (error) {
        if (error instanceof RequestError && error.status === 409) {
          conflicted.current=true;setLibraryConflict(true)
          setSaveError('学习书已在其他页面更新，未删除学习书或课程。请重新加载最新学习书。')
        }
        throw error
      } finally {setPendingSaves(n=>n-1)}
    })
    queue.current=deletion.catch(()=>{})
    return deletion
  }
  function updateCourse(course:LearningCourse) {
    changeBooks(booksRef.current.map(book=>book.bookId===course.clientBookId?updateLearningBookCourse(book,course):book))
  }
  function updateLayout(side:'leftOpen'|'rightOpen',open:boolean) {
    const next={...layout,[side]:open};setLayout(next);writeLearningLayout(storage,next)
  }
  const activeBook=books.find(book=>book.bookId===activeBookId)
  const title=area==='knowledge'?'知识提取':area==='settings'?'设置':area==='quiz'?'知识库与练习':area==='compose'?'整理学习书':'学习空间'
  return <WorkbenchWindow storage={storage} title={title} frost={glassFrost}><div className="standalone-app">
    <a className="standalone-skip" href="#standalone-content">跳到内容</a>
    <aside className="standalone-sidebar">
      <GlassBackdrop frost={glassFrost} radius={0}/>
      <div className="standalone-sidebar-scroll">
      <nav aria-label="主导航">{navigation.map(item=>{
        const selected=area===item.area && (item.area!=='quiz'||quizRoute===item.route)
        return <Fragment key={item.label}>{'group' in item && <p className="standalone-nav-group">{item.group}</p>}<button type="button" title={item.label} aria-label={item.label} aria-current={selected?'page':undefined} onClick={()=>{
          setArea(item.area);setHistoryOpen(false);if(item.area==='quiz')setQuizRoute(item.route)
        }}><item.icon size={17} strokeWidth={1.6}/><span>{item.label}</span>{item.area==='library'&&libraryReady&&<small>{books.length}</small>}</button></Fragment>
      })}</nav>
      <div className="standalone-local"><span><i/>本地空间</span><small title={directory.current?.model}>{directory.current?.model ?? '模型未配置'}</small></div>
      </div>
    </aside>
    <div className="standalone-main">
      {directory.status!=='loading'&&!directory.current&&<div className="standalone-notice" role="status"><span>{modelError || '配置文本模型后，即可提取知识和生成练习。已有学习数据仍可浏览。'}</span><button type="button" onClick={()=>setArea('settings')}>配置文本模型</button></div>}
      {saveError&&<div className="standalone-notice standalone-notice--error" role="alert">{saveError}{libraryConflict ? <button type="button" disabled={pendingSaves>0} onClick={()=>{
        if (!window.confirm('重新加载将放弃当前页面尚未保存的学习书修改，并读取本机最新版本。是否继续？')) return
        setLibraryReady(false);setDraft(undefined);setActiveBookId(undefined);setArea('library');setLoadRevision(n=>n+1)
      }}>重新加载最新学习书</button> : <button type="button" disabled={pendingSaves>0} onClick={()=>persist(booksRef.current)}>重试保存学习书</button>}</div>}
      {pendingSaves>0&&<p className="standalone-saving" role="status">正在保存学习书…</p>}
      <div id="standalone-content" tabIndex={-1} className="standalone-content" data-area={area}>
        {area==='settings'&&<Settings appearance={{frost:glassFrost,onChange:changeGlassFrost,saved:glassSaved}} fetcher={fetcher} onSaved={async()=>{await refreshModel()}}/>}
        {area==='quiz'&&<QuizWorkspace key={quizRoute} api={quizApi} storage={storage} initialRoute={quizRoute} onExit={()=>setArea('library')} onOpenExtraction={()=>setArea('knowledge')}/>}
        {(area==='library'||area==='compose')&&!libraryReady&&<section className="standalone-empty"><h1>你的学习空间</h1><p role={loadError?'alert':'status'}>{loadError||'正在读取学习书…'}</p>{loadError&&<button onClick={()=>setLoadRevision(n=>n+1)}>重新加载学习书</button>}</section>}
        {area==='library'&&libraryReady&&<LearningBookshelf presentation="desktop" books={books} newBookId={newBookId} onOpenBook={book=>{setActiveBookId(book.bookId);setArea('learning')}}
          onEditBook={book=>{setDraft({points:book.points,sourceText:book.sourceText,editingBook:book});setArea('compose')}} onDeleteBook={deleteBook} onOpenKnowledge={()=>setArea('knowledge')}/>}
        {area==='compose'&&libraryReady&&draft&&<LearningBookComposer points={draft.points} initialTitle={draft.editingBook?.title}
          heading={draft.editingBook?'修改学习书':undefined} submitLabel={draft.editingBook?(hasLearningStarted(draft.editingBook)?'保存为新版本':'保存修改'):undefined}
          onCreate={finishBook} onCancel={()=>{setArea(draft.editingBook?'library':'knowledge');setDraft(undefined)}}/>}
        {area==='learning'&&activeBook&&<LearningSpace book={activeBook} api={clientApi} leftOpen={layout.leftOpen} rightOpen={layout.rightOpen}
          onLeftOpenChange={open=>updateLayout('leftOpen',open)} onRightOpenChange={open=>updateLayout('rightOpen',open)} onCourseChange={updateCourse} onExit={()=>setArea('library')}/>}
        <div hidden={area!=='knowledge'} className="standalone-extraction">
          <header className="standalone-page-heading"><h1>知识提取</h1><span>从资料中提取知识点，逐条核对原文证据。</span></header>
          <div className="standalone-extraction-toolbar"><span>原文 · 证据 · 知识</span><button type="button" aria-expanded={historyOpen} onClick={()=>setHistoryOpen(!historyOpen)}>{historyOpen?'收起提取历史':'提取历史'}</button></div>
          <NobeiWorkspace standalone sessionId="standalone" api={clientApi} storage={storage} ordinarySession
            modelDirectoryState={directory} readModelDirectory={readModelDirectory} loadModelSelection={loadModelSelection} historyOpen={historyOpen}
            onOrganizeLearningBook={(points,sourceText)=>{if(points.length){setDraft({points:[...points],sourceText});setArea('compose')}}}/>
        </div>
      </div>
    </div>
  </div></WorkbenchWindow>
}
