import { useState } from 'react'
import { SelectField } from './SelectField.js'
import { ArrowUpRight, Sparkles, FileText, Globe2 } from 'lucide-react'
import type { GenerateInput, KnowledgeSource } from '../services/contracts.js'
import type { KnowledgeDocumentItem } from '../types.js'

interface Props { documents: KnowledgeDocumentItem[]; initialDocId?: string; busy?: boolean; onGenerate(input: GenerateInput): void }
export function QuizSetup({ documents, initialDocId, busy, onGenerate }: Props) {
  const [mode, setMode] = useState<'topic' | 'document'>(initialDocId ? 'document' : 'topic')
  const [text, setText] = useState('')
  const [docId, setDocId] = useState(initialDocId ?? '')
  const [count, setCount] = useState(5)
  const [difficulty, setDifficulty] = useState<GenerateInput['difficulty']>('mixed')
  const [images, setImages] = useState(false)
  const ready = documents.filter(doc => doc.status === 'ready')
  const doc = ready.find(item => item.doc_id === docId)
  const canSubmit = mode === 'topic' ? !!text.trim() : !!doc
  const examples = ['RAG 与传统搜索', 'Python 装饰器', '光圈、快门与 ISO']
  return <form className="zl-module zl-panel zl-setup" onSubmit={event => {
    event.preventDefault(); if (!canSubmit || busy) return
    const source: KnowledgeSource = mode === 'document' && doc ? { kind: 'document', docId: doc.doc_id, title: doc.file_name, text } : { kind: 'topic', text: text.trim() }
    onGenerate({ source, questionCount: count, difficulty, generateImages: images })
  }}>
    <div className="zl-source-tabs" role="tablist" aria-label="知识来源">
      <button role="tab" aria-selected={mode === 'topic'} type="button" onClick={() => setMode('topic')}><Globe2 size={17} />自由输入</button>
      <button role="tab" aria-selected={mode === 'document'} type="button" onClick={() => setMode('document')}><FileText size={17} />我的知识库<span>{ready.length}</span></button>
    </div>
    <div className="zl-setup-body">
      {mode === 'document' && <SelectField label="选择已就绪的文档" value={docId} onChange={setDocId} disabled={!ready.length} options={[{ value: '', label: ready.length ? '请选择文档' : '请先去知识库上传文档' }, ...ready.map(item => ({ value: item.doc_id, label: item.file_name }))]} />}
      <label className="zl-input-label" htmlFor="learning-topic">{mode === 'topic' ? '练习内容' : '练习范围（可选）'}</label>
      <textarea id="learning-topic" placeholder={mode === 'topic' ? '例如：Python 装饰器的用法。也可以粘贴笔记或网页链接。' : '可选：指定章节、知识点或学习目标，留空则根据整篇文档出题。'} value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={5} required={mode === 'topic'} />
      <div className="zl-input-foot"><span>{mode === 'topic' ? '支持主题、文本和网址' : '基于文档检索相关知识'}</span><span>{text.length} / 2000</span></div>
      {mode === 'topic' && <div className="zl-examples"><span>示例</span>{examples.map(example => <button type="button" key={example} onClick={() => setText(example)}>{example}<ArrowUpRight size={12} /></button>)}</div>}
      <div className="zl-settings"><SelectField label="题目数量" value={String(count)} onChange={value => setCount(Number(value))} options={[3,4,5,6,7,8,9,10].map(n => ({ value: String(n), label: `${n} 道题` }))} /><SelectField label="练习难度" value={difficulty} onChange={value => setDifficulty(value as GenerateInput['difficulty'])} options={[{ value: 'mixed', label: '混合难度' }, { value: 'easy', label: '入门' }, { value: 'medium', label: '进阶' }, { value: 'hard', label: '挑战' }]} /><label className="zl-check"><input type="checkbox" checked={images} onChange={e => setImages(e.target.checked)} /><span>题目配图<small>同时生成相关图片</small></span></label></div>
      <div className="zl-start-row"><span><Sparkles size={14} />答题后查看讲解</span><button className="zl-primary" disabled={!canSubmit || busy}>{busy ? '正在创建…' : '生成练习'}<ArrowUpRight size={17} /></button></div>
    </div>
  </form>
}
