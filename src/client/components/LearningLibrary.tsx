import { useRef, useState } from 'react'
import { ArrowRight, BookOpen, Check, FileText, Plus, Search, X } from 'lucide-react'
import type { LearningBook } from '../learning-book-library.js'
import type { KnowledgePointSnapshot } from '../types.js'

export interface BetterLearnGatewayProps {
  bookCount: number
  knowledgeAvailable: boolean
  onOpenKnowledge(): void
  onOpenLearning(): void
}

export function BetterLearnGateway({
  bookCount, knowledgeAvailable, onOpenKnowledge, onOpenLearning,
}: BetterLearnGatewayProps) {
  return (
    <main className="betterlearn-gateway" data-testid="betterlearn-gateway">
      <header>
        <p>BetterLearn</p>
        <h1>今天从哪里开始？</h1>
        <span>知识整理与学习训练是两个独立入口。</span>
      </header>
      <div className="betterlearn-gateway__entries">
        <button type="button" data-testid="betterlearn-knowledge-entry"
          disabled={!knowledgeAvailable} onClick={onOpenKnowledge}>
          <span>01 · Knowledge</span>
          <strong>知识点</strong>
          <p>从对话、文件或正文中提取并核对知识点。</p>
          <em>{knowledgeAvailable ? '进入知识整理 →' : '先在 DSH 创建或选择普通会话'}</em>
        </button>
        <button type="button" data-testid="betterlearn-library-entry" onClick={onOpenLearning}>
          <span>02 · Learning</span>
          <strong>学习空间</strong>
          <p>先选择由知识点整合成的学习书，再进入具体学习。</p>
          <em>{`${bookCount} 本学习书 →`}</em>
        </button>
      </div>
    </main>
  )
}

export interface LearningBookshelfProps {
  presentation?: 'desktop'
  books: LearningBook[]
  newBookId?: string
  storageWarning?: string
  onOpenBook(book: LearningBook): void
  onEditBook(book: LearningBook): void
  onDeleteBook(book: LearningBook): Promise<void>
  onOpenKnowledge(): void
}

export function LearningBookshelf({
  books, newBookId, storageWarning, onOpenBook, onEditBook, onDeleteBook, onOpenKnowledge, presentation,
}: LearningBookshelfProps) {
  const desktop = presentation === 'desktop'
  const [managing, setManaging] = useState(false)
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'new' | 'done'>('all')
  const bookState = (book: LearningBook) => book.progress && book.progress.total > 0 && book.progress.completed >= book.progress.total
    ? 'done' : book.courseId || book.progress ? 'active' : 'new'
  const visibleBooks = desktop ? books.filter(book =>
    (filter === 'all' || bookState(book) === filter) && book.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : books
  const continueBook = books.find(book => bookState(book) === 'active')
  const filters = [{id:'all', label:'全部'}, {id:'active', label:'学习中'}, {id:'new', label:'未开始'}, {id:'done', label:'已完成'}] as const

  const [deleteBookId, setDeleteBookId] = useState<string>()
  const [deletingBookId, setDeletingBookId] = useState<string>()
  const [deleteError, setDeleteError] = useState<string>()

  const toggleManaging = () => {
    setManaging(current => !current)
    setDeleteBookId(undefined)
    setDeletingBookId(undefined)
    setDeleteError(undefined)
  }

  const askToDelete = (bookId: string) => {
    setDeleteBookId(bookId)
    setDeleteError(undefined)
  }

  const cancelDelete = () => {
    setDeleteBookId(undefined)
    setDeleteError(undefined)
  }

  const confirmDelete = async (book: LearningBook) => {
    setDeletingBookId(book.bookId)
    setDeleteError(undefined)
    try {
      await onDeleteBook(book)
      setDeleteBookId(undefined)
    } catch {
      setDeleteError('删除失败，请重试。学习书和进度仍然保留。')
    } finally {
      setDeletingBookId(undefined)
    }
  }

  return (
    <main className="betterlearn-library" data-testid="learning-bookshelf" data-presentation={presentation}>
      <header className="betterlearn-library__heading">
        <div>
          {desktop ? <>
            <h1>我的学习书</h1>
            <span className="betterlearn-library__count">{books.length} 本</span>
          </> : <>
            <p>Learning Space</p>
            <h1>学习空间</h1>
            <span>知识点先被整合为学习书；打开一本书，才进入具体学习。</span>
          </>}
        </div>
        {(desktop || books.length > 0) && <div className="betterlearn-library__heading-actions">
          {books.length > 0 && <button type="button" data-testid="learning-library-manage"
            aria-pressed={managing} onClick={toggleManaging}>
            {managing ? '完成' : '管理'}
          </button>}
          {desktop && <button type="button" className="betterlearn-library__create"
            data-testid="learning-library-create" onClick={onOpenKnowledge}>
            <Plus size={14} aria-hidden="true" />新建学习书
          </button>}
        </div>}
      </header>
      {desktop && <p className="betterlearn-library__intro">把读过的资料，变成真正掌握的知识。</p>}
      {desktop && continueBook && !managing && <section className="bookshelf-continue" aria-label="继续学习">
        <span className="bookshelf-continue__icon" aria-hidden="true"><BookOpen size={24}/></span>
        <div><span>接着学，一点点积累</span><h2>{continueBook.title}</h2><p>{continueBook.progress ? `已完成 ${continueBook.progress.completed} / ${continueBook.progress.total} 个知识点` : `${continueBook.points.length} 个知识点等你探索`}</p></div>
        <button type="button" onClick={() => onOpenBook(continueBook)}>继续学习 <ArrowRight size={16} aria-hidden="true"/></button>
      </section>}
      {desktop && books.length > 0 && <div className="bookshelf-tools">
        <div className="bookshelf-filters" role="group" aria-label="按学习状态筛选">{filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id}
          disabled={deletingBookId !== undefined} onClick={() => { setFilter(item.id); cancelDelete() }}>{item.label}<span>{books.filter(book => item.id === 'all' || bookState(book) === item.id).length}</span></button>)}</div>
        <label className="bookshelf-search"><Search size={16} aria-hidden="true"/><span className="bookshelf-sr-only">搜索学习书</span><input ref={searchInput} type="search" aria-label="搜索学习书" placeholder="搜索书名" value={query} disabled={deletingBookId !== undefined} onChange={event => {setQuery(event.currentTarget.value); cancelDelete()}}/>{query && <button type="button" aria-label="清除搜索" disabled={deletingBookId !== undefined} onClick={() => {setQuery('');searchInput.current?.focus()}}><X size={14} aria-hidden="true"/></button>}</label>
        <span className="bookshelf-sr-only" role="status">显示 {visibleBooks.length} 本学习书</span>
      </div>}
      {desktop && books.length > 0 && visibleBooks.length === 0 && <section className="bookshelf-no-results"><Search size={26} aria-hidden="true"/><h2>没有找到符合条件的学习书</h2><p>{query.trim() ? `试试其他书名，或清除“${query.trim()}”和当前筛选。` : '这个分类下暂时没有学习书，可以查看全部书籍。'}</p><button type="button" onClick={() => {setQuery('');setFilter('all');searchInput.current?.focus()}}>清除筛选</button></section>}
      {storageWarning && <p className="betterlearn-library__warning">{storageWarning}</p>}
      {books.length === 0 ? (
        <section className="betterlearn-library__empty">
          {desktop ? <div className="bookshelf-empty-art" aria-hidden="true"><span/><span/><div><BookOpen size={32} strokeWidth={1.3}/><b>Better<br/>Learn.</b><small>从好奇，到理解</small></div></div> : <span>空书架</span>}
          <h2>还没有学习书</h2>
          <p>{desktop ? '让第一份资料，在这里长成一本学习书。' : '先完成一次知识提取，并把确认后的知识点整理为学习书。'}</p>
          <button type="button" data-testid="learning-library-empty-action"
            onClick={onOpenKnowledge}>{desktop ? '导入资料' : '去知识点入口'}{desktop && <ArrowRight size={15} aria-hidden="true"/>}</button>
          {desktop && <ol className="bookshelf-steps"><li><FileText size={16} aria-hidden="true"/><span>导入资料</span></li><li><Check size={16} aria-hidden="true"/><span>核对知识点</span></li><li><BookOpen size={16} aria-hidden="true"/><span>开始学习</span></li></ol>}
        </section>
      ) : (
        <section className="betterlearn-library__shelf" aria-label="学习书">
          {visibleBooks.map((book, index) => (
            <article key={book.bookId} className="betterlearn-library__book-shell"
              data-managing={managing ? 'true' : 'false'}>
              <button type="button" className="betterlearn-library__book"
                data-testid={`learning-book-${book.bookId}`}
                data-new={book.bookId === newBookId ? 'true' : 'false'}
                title={book.title}
                aria-label={desktop ? `${book.title}，${book.points.length} 个知识点，${book.progress
                  ? `已完成 ${book.progress.completed} / ${book.progress.total}，掌握度 ${book.progress.mastery}%`
                  : book.bookId === newBookId ? '刚刚创建' : '尚未开始'}，打开学习书` : undefined}
                disabled={managing || deletingBookId === book.bookId}
                onClick={() => onOpenBook(book)}>
                <span className="betterlearn-library__cover" aria-hidden="true"
                  data-point-type={desktop ? book.points[0]?.type : undefined}>
                  {desktop ? <>
                    <small className="betterlearn-library__cover-category">
                      {book.points[0] ? bookCategory[book.points[0].type] : '学习笔记'}
                    </small>
                    <b>{book.title}</b>
                    <small className="betterlearn-library__cover-footer">{book.points.length} 个知识点</small>
                  </> : <>
                    <i>{String(index + 1).padStart(2, '0')}</i>
                    <b>BETTER<br />LEARN</b>
                    <small>学习书</small>
                  </>}
                </span>
                <span className="betterlearn-library__book-copy">
                  {desktop ? <>
                    <strong>{book.title}</strong>
                    <small>{book.progress
                      ? `已完成 ${book.progress.completed} / ${book.progress.total} · 掌握度 ${book.progress.mastery}%`
                      : book.bookId === newBookId ? '刚刚创建' : '尚未开始'}</small>
                    <span className="betterlearn-library__progress" aria-hidden="true">
                      <span style={{ width: `${book.progress && book.progress.total > 0
                        ? Math.max(0, Math.min(100, book.progress.completed / book.progress.total * 100)) : 0}%` }} />
                    </span>
                  </> : <>
                    <small>{book.points.length} 个知识点 · {book.progress
                      ? `已完成 ${book.progress.completed}/${book.progress.total} · 掌握度 ${book.progress.mastery}%`
                      : book.bookId === newBookId ? '刚刚创建' : '尚未开始'}</small>
                    <strong>{book.title}</strong>
                    <span>{book.points.slice(0, 3).map(point => point.title).join(' · ')}</span>
                    <em>{managing ? '管理这本学习书' : book.progress ? '继续学习 →' : '开始学习 →'}</em>
                  </>}
                </span>
              </button>
              {managing && deleteBookId !== book.bookId && (
                <div className="betterlearn-library__book-actions">
                  <button type="button" data-testid={`learning-book-edit-${book.bookId}`}
                    disabled={deletingBookId !== undefined} onClick={() => onEditBook(book)}>修改</button>
                  <button type="button" data-testid={`learning-book-delete-${book.bookId}`}
                    disabled={deletingBookId !== undefined}
                    onClick={() => askToDelete(book.bookId)}>删除</button>
                </div>
              )}
              {managing && deleteBookId === book.bookId && (
                <div className="betterlearn-library__delete-confirm" role="alert">
                  <strong>删除这本学习书及全部学习记录？</strong>
                  <span>课程、答题记录和掌握度都会被删除。</span>
                  {deleteError && <p>{deleteError}</p>}
                  <div>
                    <button type="button" data-testid={`learning-book-delete-cancel-${book.bookId}`}
                      disabled={deletingBookId === book.bookId} onClick={cancelDelete}>取消</button>
                    <button type="button" data-testid={`learning-book-delete-confirm-${book.bookId}`}
                      disabled={deletingBookId === book.bookId}
                      onClick={() => void confirmDelete(book)}>
                      {deletingBookId === book.bookId ? '正在删除…' : '确认删除'}
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

const bookCategory: Record<KnowledgePointSnapshot['type'], string> = {
  concept: '概念', process: '流程', comparison: '比较', formula: '公式', fact: '事实', code: '代码',
}

export interface LearningBookDraftResult {
  title: string
  points: KnowledgePointSnapshot[]
}

export interface LearningBookComposerProps {
  points: KnowledgePointSnapshot[]
  initialTitle?: string
  heading?: string
  submitLabel?: string
  onCreate(result: LearningBookDraftResult): void
  onCancel(): void
}

function defaultBookTitle(points: KnowledgePointSnapshot[]): string {
  const first = points[0]
  if (!first) return '新的学习书'
  if (points.length === 1) return `${first.title} · 学习书`
  return `${first.title}等 ${points.length} 个知识点`
}

export function LearningBookComposer({
  points, initialTitle, heading = '整理为学习书', submitLabel = '创建学习书', onCreate, onCancel,
}: LearningBookComposerProps) {
  const [title, setTitle] = useState(() => initialTitle ?? defaultBookTitle(points))
  const [orderedPoints, setOrderedPoints] = useState(() => [...points])

  const movePoint = (index: number, offset: -1 | 1) => {
    setOrderedPoints(current => {
      const destination = index + offset
      if (destination < 0 || destination >= current.length) return current
      const next = [...current]
      const [moving] = next.splice(index, 1)
      next.splice(destination, 0, moving)
      return next
    })
  }

  const removePoint = (knowledgePointId: string) => {
    setOrderedPoints(current => current.filter(item => item.knowledgePointId !== knowledgePointId))
  }

  const canCreate = title.trim().length > 0 && orderedPoints.length > 0

  return (
    <main className="betterlearn-composer" data-testid="learning-book-composer">
      <header className="betterlearn-composer__heading">
        <p>Compose a Learning Book</p>
        <h1>{heading}</h1>
        <span>命名这本书，并确定知识点的学习顺序。</span>
      </header>

      <section className="betterlearn-composer__editor">
        <label htmlFor="learning-book-title">学习书名称</label>
        <input id="learning-book-title" data-testid="learning-book-title" value={title}
          onChange={event => setTitle(event.currentTarget.value)} />
        <div className="betterlearn-composer__count">
          <span>学习顺序</span>
          <strong>{orderedPoints.length} 个知识点</strong>
        </div>

        {orderedPoints.length === 0 ? (
          <p className="betterlearn-composer__empty">至少保留一个知识点</p>
        ) : (
          <ol className="betterlearn-composer__points">
            {orderedPoints.map((point, index) => (
              <li key={point.knowledgePointId}
                data-testid={`learning-book-point-${point.knowledgePointId}`}>
                <span className="betterlearn-composer__sequence">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="betterlearn-composer__point-copy">
                  <strong>{point.title}</strong>
                  <small>{point.statement}</small>
                </span>
                <span className="betterlearn-composer__point-actions">
                  <button type="button" disabled={index === 0}
                    data-testid={`learning-book-move-up-${point.knowledgePointId}`}
                    onClick={() => movePoint(index, -1)}>上移</button>
                  <button type="button" disabled={index === orderedPoints.length - 1}
                    data-testid={`learning-book-move-down-${point.knowledgePointId}`}
                    onClick={() => movePoint(index, 1)}>下移</button>
                  <button type="button" data-testid={`learning-book-remove-${point.knowledgePointId}`}
                    onClick={() => removePoint(point.knowledgePointId)}>移除</button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="betterlearn-composer__actions">
        <button type="button" data-testid="learning-book-cancel" onClick={onCancel}>取消</button>
        <button type="button" data-testid="learning-book-create" disabled={!canCreate}
          onClick={() => canCreate && onCreate({ title: title.trim(), points: orderedPoints })}>
          {submitLabel}
        </button>
      </footer>
    </main>
  )
}
