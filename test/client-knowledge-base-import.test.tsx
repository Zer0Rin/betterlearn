import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, test, vi } from 'vitest'
import { ProductApiError } from '../src/client/client-api.js'
import { KnowledgeBaseImport } from '../src/client/components/KnowledgeBaseImport.js'
import type { KnowledgeBaseDocumentSummary, KnowledgeBasePreview } from '../src/client/types.js'

const documents: KnowledgeBaseDocumentSummary[] = [
  {
    docId: 'doc_alpha',
    fileName: '操作系统笔记.md',
    fileType: 'md',
    fileSize: 2048,
    status: 'ready',
    chunkCount: 12,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    docId: 'doc_beta',
    fileName: '数据库索引.md',
    fileType: 'md',
    fileSize: 1024,
    status: 'ready',
    chunkCount: 8,
    createdAt: '2026-01-02T00:00:00Z',
  },
  {
    docId: 'doc_gamma',
    fileName: '编译原理.md',
    fileType: 'md',
    fileSize: 512,
    status: 'processing',
    chunkCount: 0,
    createdAt: '2026-01-03T00:00:00Z',
  },
]

const preview: KnowledgeBasePreview = {
  docIds: ['doc_alpha', 'doc_beta'],
  filename: '操作系统笔记.md 等 2 篇知识库文档.md',
  mediaType: 'application/vnd.betterlearn.knowledge-base+markdown',
  text: '# 操作系统笔记.md\n\n进程是资源分配的单位。\n\n# 数据库索引.md\n\nB+ 树是索引的默认结构。',
  contentDigest: 'b'.repeat(64),
  documentCount: 2,
  characterCount: 48,
  byteSize: 120,
  extractionPlan: { strategy: 'L2', maxCalls: 3 },
}

type Props = Parameters<typeof KnowledgeBaseImport>[0]

function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(node => node.children.join('') === label)!
}

function render(overrides: Partial<Props> = {}) {
  const previewKnowledgeBase = overrides.previewKnowledgeBase ?? vi.fn(async () => preview)
  const onSubmit = overrides.onSubmit ?? vi.fn(async () => true)
  const onReload = overrides.onReload ?? vi.fn()
  let renderer!: ReactTestRenderer
  const element = (extra: Partial<Props> = {}) => <KnowledgeBaseImport
    documents={documents}
    loading={false}
    configured
    onReload={onReload}
    submitting={false}
    modelSelection={{ provider: 'provider-a', model: 'model-a', reasoningEffort: 'high' }}
    modelStatus="ready"
    ordinarySession
    previewKnowledgeBase={previewKnowledgeBase}
    onSubmit={onSubmit}
    onBack={vi.fn()}
    {...overrides}
    {...extra}
  />
  act(() => {
    renderer = create(element())
  })
  return { renderer, element, previewKnowledgeBase, onSubmit, onReload }
}

function checkbox(renderer: ReactTestRenderer, docId: string) {
  return renderer.root.findByProps({ 'data-doc-id': docId })
}

describe('knowledge base import', () => {
  test('searches and multi-selects ready documents before a mandatory preview', async () => {
    const { renderer, previewKnowledgeBase, onSubmit } = render()
    const output = JSON.stringify(renderer.toJSON())
    expect(output).toContain('选择知识库文档')
    expect(output).toContain('已选择 0 篇')
    expect(output).toContain('操作系统笔记.md')
    expect(output).toContain('MD · 2,048 字节 · 可提取')
    expect(output).toContain('编译原理.md')
    expect(output).toContain('解析中')
    // 还在解析的文档不能被选中。
    expect(checkbox(renderer, 'doc_gamma').props.disabled).toBe(true)
    expect(findButton(renderer, '预览合并内容').props.disabled).toBe(true)

    act(() => renderer.root.findByProps({ 'data-testid': 'knowledge-base-search' }).props.onChange({
      currentTarget: { value: '索引' },
    }))
    expect(renderer.root.findAllByProps({ 'data-testid': 'knowledge-base-row' })).toHaveLength(1)

    act(() => checkbox(renderer, 'doc_beta').props.onChange({ currentTarget: { checked: true } }))
    act(() => renderer.root.findByProps({ 'data-testid': 'knowledge-base-search' }).props.onChange({
      currentTarget: { value: '' },
    }))
    act(() => checkbox(renderer, 'doc_alpha').props.onChange({ currentTarget: { checked: true } }))
    expect(JSON.stringify(renderer.toJSON())).toContain('已选择 2 篇')

    await act(async () => findButton(renderer, '预览合并内容').props.onClick())
    // 选择顺序跟着文档列表走，不受勾选先后影响。
    expect(previewKnowledgeBase).toHaveBeenCalledWith(
      ['doc_alpha', 'doc_beta'], expect.any(AbortSignal),
    )
    expect(onSubmit).not.toHaveBeenCalled()

    const pre = renderer.root.findByProps({ 'data-testid': 'knowledge-base-preview-text' })
    expect(pre.children).toEqual([preview.text])
    expect(pre.props.dangerouslySetInnerHTML).toBeUndefined()
    const previewOutput = JSON.stringify(renderer.toJSON())
    expect(previewOutput).toContain('2 篇')
    expect(previewOutput).toContain('L2 · 最多 3 次模型调用')

    act(() => findButton(renderer, '返回修改选择').props.onClick())
    expect(checkbox(renderer, 'doc_alpha').props.checked).toBe(true)
    expect(checkbox(renderer, 'doc_beta').props.checked).toBe(true)
  })

  test('submits the previewed selection with its exact digest', async () => {
    const { renderer, onSubmit } = render()
    act(() => checkbox(renderer, 'doc_alpha').props.onChange({ currentTarget: { checked: true } }))
    await act(async () => findButton(renderer, '预览合并内容').props.onClick())

    await act(async () => findButton(renderer, '开始提取').props.onClick())

    expect(onSubmit).toHaveBeenCalledWith({
      docIds: preview.docIds,
      expectedDigest: preview.contentDigest,
    })
  })

  test('keeps selection across preview errors and supports an explicit retry', async () => {
    const previewKnowledgeBase = vi.fn()
      .mockRejectedValueOnce(new ProductApiError(400, 'KNOWLEDGE_BASE_TOO_LARGE'))
      .mockResolvedValueOnce(preview)
    const { renderer } = render({ previewKnowledgeBase })
    act(() => checkbox(renderer, 'doc_alpha').props.onChange({ currentTarget: { checked: true } }))

    await act(async () => findButton(renderer, '预览合并内容').props.onClick())
    expect(JSON.stringify(renderer.toJSON())).toContain('超过 512 KiB')
    expect(checkbox(renderer, 'doc_alpha').props.checked).toBe(true)

    await act(async () => findButton(renderer, '重新预览').props.onClick())
    expect(previewKnowledgeBase).toHaveBeenCalledTimes(2)
    expect(renderer.root.findByProps({ 'data-testid': 'knowledge-base-preview-text' })).toBeDefined()
  })

  test('explains an unconfigured knowledge base without offering selection', () => {
    const { renderer } = render({ configured: false })

    expect(JSON.stringify(renderer.toJSON())).toContain('还没有配置本地知识库地址与凭证')
    expect(renderer.root.findAllByProps({ 'data-testid': 'knowledge-base-row' })).toHaveLength(0)
    expect(findButton(renderer, '预览合并内容').props.disabled).toBe(true)
  })

  test('shows the load failure above an otherwise usable list', () => {
    const { renderer } = render({ loadError: '读取知识库文档失败，请稍后重试。' })

    expect(JSON.stringify(renderer.toJSON())).toContain('读取知识库文档失败')
    expect(renderer.root.findAllByProps({ 'data-testid': 'knowledge-base-row' })).toHaveLength(3)
  })

  test('shows an empty state when the knowledge base has no documents', () => {
    const { renderer, element } = render({ documents: [], loading: true })

    expect(JSON.stringify(renderer.toJSON())).toContain('正在读取知识库文档…')

    act(() => renderer.update(element({ loading: false })))
    expect(JSON.stringify(renderer.toJSON())).toContain('知识库还没有已上传的文档')
  })

  test('invalidates a stale preview after a 409 and requires preview again', async () => {
    const onSubmit = vi.fn(async () => {
      throw new ProductApiError(409, 'KNOWLEDGE_BASE_CHANGED')
    })
    const { renderer, previewKnowledgeBase } = render({ onSubmit })
    act(() => checkbox(renderer, 'doc_alpha').props.onChange({ currentTarget: { checked: true } }))
    await act(async () => findButton(renderer, '预览合并内容').props.onClick())

    await act(async () => findButton(renderer, '开始提取').props.onClick())
    expect(JSON.stringify(renderer.toJSON())).toContain('文档内容在预览后发生了变化')
    expect(findButton(renderer, '开始提取').props.disabled).toBe(true)

    await act(async () => findButton(renderer, '重新预览').props.onClick())
    expect(previewKnowledgeBase).toHaveBeenCalledTimes(2)
    expect(findButton(renderer, '开始提取').props.disabled).toBe(false)
  })

  test('prunes selections only when documents disappear from the knowledge base', () => {
    const { renderer, element } = render()
    act(() => checkbox(renderer, 'doc_alpha').props.onChange({ currentTarget: { checked: true } }))
    act(() => checkbox(renderer, 'doc_beta').props.onChange({ currentTarget: { checked: true } }))
    expect(JSON.stringify(renderer.toJSON())).toContain('已选择 2 篇')

    act(() => renderer.update(element({ documents: [documents[0]!] })))
    expect(JSON.stringify(renderer.toJSON())).toContain('已选择 1 篇')
    expect(checkbox(renderer, 'doc_alpha').props.checked).toBe(true)
  })

  test('disables selection and duplicate submission while busy', () => {
    const { renderer } = render({ submitting: true })

    expect(checkbox(renderer, 'doc_alpha').props.disabled).toBe(true)
    expect(findButton(renderer, '预览合并内容').props.disabled).toBe(true)
  })

  test('refuses to extract in a sub-agent session', () => {
    const { renderer } = render({ ordinarySession: false })

    expect(JSON.stringify(renderer.toJSON())).toContain('当前是子 Agent 会话')
    expect(findButton(renderer, '预览合并内容').props.disabled).toBe(true)
  })
})
