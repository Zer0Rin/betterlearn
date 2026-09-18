import { useEffect, useRef, useState } from 'react'
import { FileText, Upload, ArrowUpRight, Trash2, RefreshCw } from 'lucide-react'
import type { QuizApi } from '../services/contracts.js'
import type { KnowledgeDocumentItem } from '../types.js'

export function KnowledgePage({ api, onPractice }: { api: QuizApi; onPractice(docId: string): void }) {
  const [documents, setDocuments] = useState<KnowledgeDocumentItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const vectorizing = useRef(new Set<string>())
  const [starting, setStarting] = useState<string[]>([])
  const [deleting, setDeleting] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const data = await api.getDocuments(controller.signal)
        if (controller.signal.aborted) return
        setDocuments(data.items); setError('')
        if (data.items.some(item => item.status === 'processing')) timer = setTimeout(load, 3000)
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [api, revision])
  async function upload(file?: File) {
    if (!file || uploading) return
    setError(''); setNotice('')
    if (!/\.(pdf|docx|md|txt)$/i.test(file.name)) { setError('请选择 PDF、DOCX、Markdown 或 TXT 文件。'); return }
    if (file.size > 10 * 1024 * 1024) { setError('文件不能超过 10 MB。'); return }
    setUploading(true)
    try { await api.uploadDocument(file); setNotice('文档已保存在本地，尚未调用向量模型。需要检索练习时，请手动开始向量化。'); setRevision(n => n + 1) }
    catch (e) { setError((e as Error).message) }
    finally { setUploading(false); if (input.current) input.current.value = '' }
  }
  async function vectorize(doc: KnowledgeDocumentItem) {
    if (vectorizing.current.has(doc.doc_id)) return
    vectorizing.current.add(doc.doc_id); setStarting([...vectorizing.current]); setError(''); setNotice('')
    try {
      await api.vectorizeDocument(doc.doc_id)
      setNotice('已提交向量化任务。调用已配置的向量模型，可能产生费用。')
      setRevision(n => n + 1)
    } catch (e) { setError((e as Error).message) }
    finally { vectorizing.current.delete(doc.doc_id); setStarting([...vectorizing.current]) }
  }
  async function remove(doc: KnowledgeDocumentItem) {
    if (!window.confirm(`删除《${doc.file_name}》？文档及知识索引将被移除。`)) return
    setDeleting(doc.doc_id); setError('')
    try { await api.deleteDocument(doc.doc_id); setRevision(n => n + 1) }
    catch (e) { setError((e as Error).message) }
    finally { setDeleting('') }
  }
  return <><header className="zl-heading"><div className="zl-eyebrow">我的知识库</div><h1>知识库</h1><p>管理用于知识提取和练习的文档。</p></header>
    <section className="zl-upload zl-panel" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files[0]) }}><div className="zl-upload-icon"><Upload size={25}/></div><div><h2>把文档拖到这里</h2><p>PDF / DOCX / Markdown / TXT · 单个文件不超过 10 MB</p></div><button className="zl-primary" onClick={() => input.current?.click()} disabled={uploading}>{uploading ? '上传中…' : '选择文件'}</button><input ref={input} type="file" aria-label="上传知识库文档" accept=".pdf,.docx,.md,.txt" hidden onChange={e => void upload(e.target.files?.[0])}/></section>
    {error && <p className="zl-error" role="alert">{error}</p>}{notice && <p className="zl-notice" role="status">{notice}</p>}
    <div className="zl-section-title"><h2>文档 <span>{documents.length}</span></h2><button className="zl-text-button" onClick={() => setRevision(n => n + 1)}><RefreshCw size={14}/>刷新列表</button></div>
    {loading ? <p className="zl-empty">正在读取文档…</p> : documents.length === 0 ? <div className="zl-panel zl-empty"><FileText size={32}/><h3>还没有文档</h3><p>支持 PDF、Word、Markdown 和纯文本。</p></div> : <div className="zl-document-list">{documents.map(doc => <article className="zl-panel zl-document" key={doc.doc_id}><div className="zl-file-icon"><FileText size={23}/><small>{doc.file_type.toUpperCase()}</small></div><div className="zl-document-info"><h3>{doc.file_name}</h3><p><span className={`zl-tag ${doc.status === 'failed' ? 'danger' : ''}`}>{({ uploaded:'待向量化', processing:'向量化中', ready:'已就绪', failed:'向量化失败' })[doc.status]}</span><span>{(doc.file_size/1024).toFixed(1)} KB</span>{doc.status === 'ready' && <span>{doc.chunk_count} 个知识片段</span>}</p>{doc.error_message && <p className="zl-inline-error">{doc.error_message}</p>}</div><div className="zl-document-actions">{doc.status === 'uploaded' && <div><button className="zl-primary" disabled={starting.includes(doc.doc_id) || !!deleting} onClick={() => void vectorize(doc)}>{starting.includes(doc.doc_id) ? '正在提交…' : '开始向量化'}</button><small style={{ display: 'block', marginTop: 6 }}>调用向量模型，可能产生费用</small></div>}<button className="zl-secondary" disabled={doc.status !== 'ready' || !!deleting} onClick={() => onPractice(doc.doc_id)}>开始练习<ArrowUpRight size={15}/></button><button className="zl-icon-button" aria-label={`删除 ${doc.file_name}`} disabled={!!deleting} onClick={() => void remove(doc)}><Trash2 size={16}/></button></div></article>)}</div>}
    <p className="zl-footnote">上传仅保存本地文件，不调用模型。点击“开始向量化”后才会调用向量模型；可能分批请求并产生费用。失败后不会自动重试，检查设置后可重新上传并手动启动。</p>
  </>
}
