import { useEffect, useMemo, useRef, useState } from 'react'
import { ProductApiError } from '../client-api.js'
import { modelSelectionLabel } from '../model-directory-bridge.js'
import type {
  ClientApi,
  KnowledgeBaseDocumentSummary,
  KnowledgeBasePreview,
  ModelSelectionSnapshot,
} from '../types.js'
import type { ModelDirectoryStatus } from '../use-nobei-workspace.js'

export type KnowledgeBaseImportState =
  | { step: 'select'; selected: string[]; query: string }
  | { step: 'previewing'; selected: string[]; query: string }
  | { step: 'preview'; selected: string[]; query: string; preview: KnowledgeBasePreview }

export interface KnowledgeBaseImportProps {
  documents: KnowledgeBaseDocumentSummary[]
  loading: boolean
  configured: boolean
  loadError?: string
  onReload(): void
  submitting: boolean
  error?: string
  modelSelection?: ModelSelectionSnapshot
  modelStatus: ModelDirectoryStatus
  ordinarySession: boolean
  previewKnowledgeBase: ClientApi['previewKnowledgeBase']
  onSubmit(input: { docIds: string[]; expectedDigest: string }): Promise<boolean>
  onBack(): void
}

function previewErrorMessage(error: unknown): string {
  const code = error instanceof ProductApiError ? error.code : error instanceof Error ? error.message : ''
  if (code === 'KNOWLEDGE_BASE_TOO_LARGE') return '所选文档合并后超过 512 KiB，请减少选择。'
  if (code === 'KNOWLEDGE_BASE_DOCUMENT_NOT_FOUND') return '有文档已从知识库删除，请刷新列表后重试。'
  if (code === 'KNOWLEDGE_BASE_DOCUMENT_NOT_READY') return '所选文档尚未解析完成，请等待状态变为“可提取”。'
  if (code === 'KNOWLEDGE_BASE_EMPTY') return '所选文档没有可提取的文字内容。'
  if (code === 'KNOWLEDGE_BASE_UNAVAILABLE') return '知识库连接或凭证无效，请检查 BetterLearn 的知识库配置。'
  if (code === 'KNOWLEDGE_BASE_READ_FAILED') return '读取知识库文档失败，请稍后重试。'
  return '无法预览所选文档，请检查知识库连接后重试。'
}

function formatBytes(value: number): string {
  return `${value.toLocaleString('zh-CN')} 字节`
}

export function KnowledgeBaseImport({
  documents,
  loading,
  configured,
  loadError,
  onReload,
  submitting,
  error,
  modelSelection,
  modelStatus,
  ordinarySession,
  previewKnowledgeBase,
  onSubmit,
  onBack,
}: KnowledgeBaseImportProps) {
  const [state, setState] = useState<KnowledgeBaseImportState>({ step: 'select', selected: [], query: '' })
  const [previewError, setPreviewError] = useState<string>()
  const [stale, setStale] = useState(false)
  const previewController = useRef<AbortController>()

  useEffect(() => () => previewController.current?.abort(), [])
  useEffect(() => {
    const available = new Set(documents.map(document => document.docId))
    const selected = state.selected.filter(docId => available.has(docId))
    if (selected.length === state.selected.length) return
    setState({ step: 'select', selected, query: state.query })
    setStale(false)
    setPreviewError(undefined)
  }, [documents, state])

  const filtered = useMemo(() => {
    const query = state.query.trim().toLocaleLowerCase('zh-CN')
    return query === '' ? documents : documents.filter(document =>
      document.fileName.toLocaleLowerCase('zh-CN').includes(query))
  }, [documents, state.query])

  function updateQuery(query: string): void {
    setState(current => ({ step: 'select', selected: current.selected, query }))
    setStale(false)
  }

  function toggle(docId: string, checked: boolean): void {
    setState(current => {
      const next = new Set(current.selected)
      if (checked) next.add(docId)
      else next.delete(docId)
      const selected = documents.map(document => document.docId).filter(id => next.has(id))
      return { step: 'select', selected, query: current.query }
    })
    setPreviewError(undefined)
    setStale(false)
  }

  async function loadPreview(): Promise<void> {
    if (state.selected.length === 0 || state.step === 'previewing' || !ordinarySession) return
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    const selected = [...state.selected]
    const query = state.query
    setPreviewError(undefined)
    setStale(false)
    setState({ step: 'previewing', selected, query })
    try {
      const preview = await previewKnowledgeBase(selected, controller.signal)
      if (!controller.signal.aborted && previewController.current === controller) {
        setState({ step: 'preview', selected, query, preview })
      }
    } catch (caught) {
      if (!controller.signal.aborted && previewController.current === controller) {
        setPreviewError(previewErrorMessage(caught))
        setState({ step: 'select', selected, query })
      }
    }
  }

  async function submitPreview(): Promise<void> {
    if (state.step !== 'preview' || stale || submitting || modelStatus !== 'ready' || !modelSelection) return
    try {
      await onSubmit({
        docIds: [...state.preview.docIds],
        expectedDigest: state.preview.contentDigest,
      })
    } catch (caught) {
      if (caught instanceof ProductApiError && caught.code === 'KNOWLEDGE_BASE_CHANGED') {
        setStale(true)
        return
      }
      setPreviewError('提交失败，所选文档和预览仍已保留。')
    }
  }

  if (state.step === 'preview') {
    return <section className="nobei-client__import nobei-client__knowledge-base-import"
      aria-labelledby="nobei-kb-preview-title">
      <header>
        <p className="nobei-client__eyebrow">知识库预览</p>
        <h2 id="nobei-kb-preview-title">确认将要提取的完整内容</h2>
        <p>这里是所选文档的连续正文，与你上传时的原文逐字一致；每篇文档前会加上它的文件名作为小标题。</p>
      </header>
      <dl className="nobei-client__conversation-stats">
        <div><dt>文档</dt><dd>{`${state.preview.documentCount} 篇`}</dd></div>
        <div><dt>字符</dt><dd>{state.preview.characterCount.toLocaleString('zh-CN')}</dd></div>
        <div><dt>大小</dt><dd>{formatBytes(state.preview.byteSize)} / 524,288 字节</dd></div>
      </dl>
      <p className="nobei-client__conversation-plan">
        {`${state.preview.extractionPlan.strategy} · 最多 ${state.preview.extractionPlan.maxCalls} 次模型调用`}
      </p>
      <pre className="nobei-client__conversation-preview"
        data-testid="knowledge-base-preview-text">{state.preview.text}</pre>
      {modelSelection && <p className="nobei-client__conversation-model">本次模型：{modelSelectionLabel(modelSelection)}</p>}
      {stale && <p className="nobei-client__error" role="alert">文档内容在预览后发生了变化，必须重新预览后才能提取。</p>}
      {(error ?? previewError) && !stale && <p className="nobei-client__error" role="alert">{error ?? previewError}</p>}
      <div className="nobei-client__conversation-actions">
        <button type="button" disabled={submitting} onClick={() => {
          setState({ step: 'select', selected: state.selected, query: state.query })
          setStale(false)
        }}>返回修改选择</button>
        {stale && <button type="button" disabled={submitting} onClick={() => { void loadPreview() }}>重新预览</button>}
        <button className="nobei-client__primary" type="button"
          disabled={submitting || stale || !ordinarySession || modelStatus !== 'ready' || !modelSelection}
          onClick={() => { void submitPreview() }}>
          {submitting ? '正在提交…' : '开始提取'}
        </button>
      </div>
    </section>
  }

  return <section className="nobei-client__import nobei-client__knowledge-base-import"
    aria-labelledby="nobei-kb-select-title">
    <header>
      <p className="nobei-client__eyebrow">从知识库提取</p>
      <h2 id="nobei-kb-select-title">选择知识库文档</h2>
      <p>可以选择多篇文档；它们会合并为一个知识点提取任务，正文按选择顺序拼接。</p>
    </header>
    <button className="nobei-client__back" type="button" disabled={submitting} onClick={onBack}>返回选择来源</button>
    {!configured
      ? <p className="nobei-client__error" role="alert">
        还没有配置本地知识库地址与凭证，请在 BetterLearn 的插件配置中填写后重启。
      </p>
      : <>
        <label className="nobei-client__conversation-search">
          <span>搜索文件名</span>
          <input data-testid="knowledge-base-search" type="search" value={state.query}
            disabled={submitting || state.step === 'previewing'}
            onChange={event => updateQuery(event.currentTarget.value)} />
        </label>
        <div className="nobei-client__conversation-selection-meta">
          <strong>{`已选择 ${state.selected.length} 篇`}</strong>
          <span>最多 50 篇 · 合并上限 512 KiB</span>
          <button type="button" disabled={submitting || loading} onClick={onReload}>
            {loading ? '正在读取…' : '刷新列表'}
          </button>
        </div>
        <div className="nobei-client__conversation-list" role="group" aria-label="知识库文档">
          {loading && documents.length === 0
            ? <p className="nobei-client__conversation-empty" role="status">正在读取知识库文档…</p>
            : documents.length === 0
              ? <p className="nobei-client__conversation-empty">知识库还没有已上传的文档。</p>
              : filtered.length === 0
                ? <p className="nobei-client__conversation-empty">没有文件名匹配的文档。</p>
                : filtered.map(document => <label key={document.docId}
                  className="nobei-client__conversation-row" data-testid="knowledge-base-row">
                  <input type="checkbox" data-doc-id={document.docId}
                    checked={state.selected.includes(document.docId)}
                    disabled={submitting || state.step === 'previewing' || !['ready', 'uploaded'].includes(document.status)}
                    onChange={event => toggle(document.docId, event.currentTarget.checked)} />
                  <span><strong>{document.fileName}</strong>
                    <time>{`${document.fileType.toUpperCase()} · ${formatBytes(document.fileSize)} · ${
                      ['ready', 'uploaded'].includes(document.status) ? '可提取'
                        : document.status === 'processing' ? '解析中' : '解析失败'}`}</time></span>
                </label>)}
        </div>
      </>}
    {loadError && <p className="nobei-client__error" role="alert">{loadError}</p>}
    {!ordinarySession && <p className="nobei-client__error" role="alert">
      当前是子 Agent 会话，请在普通会话中使用 BetterLearn。
    </p>}
    {previewError && <p className="nobei-client__error" role="alert">{previewError}</p>}
    {error && <p className="nobei-client__error" role="alert">{error}</p>}
    <div className="nobei-client__conversation-actions">
      {previewError && <button type="button" disabled={submitting} onClick={() => { void loadPreview() }}>重新预览</button>}
      <button className="nobei-client__primary" type="button"
        disabled={submitting || state.step === 'previewing' || state.selected.length === 0 || !ordinarySession}
        onClick={() => { void loadPreview() }}>
        {state.step === 'previewing' ? '正在生成预览…' : '预览合并内容'}
      </button>
    </div>
  </section>
}
