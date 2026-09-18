import { act, create } from 'react-test-renderer'
import { expect, test, vi } from 'vitest'
import { KnowledgePage } from './KnowledgePage.js'
import type { QuizApi } from '../services/contracts.js'

test('upload and refresh never vectorize; only an explicit click starts the paid action', async () => {
  const doc = { doc_id: 'doc_1', file_name: 'a.md', file_type: 'md', file_size: 20, status: 'uploaded', chunk_count: 0 }
  const api = { getDocuments: vi.fn(async () => ({ items: [doc] })), uploadDocument: vi.fn(async () => doc), vectorizeDocument: vi.fn(async () => doc) } as unknown as QuizApi
  let view!: ReturnType<typeof create>
  await act(async () => { view = create(<KnowledgePage api={api} onPractice={vi.fn()} />) })
  const input = view.root.findByProps({ 'aria-label': '上传知识库文档' })
  await act(async () => { input.props.onChange({ target: { files: [new File(['hello'], 'a.md')] } }) })
  expect(api.uploadDocument).toHaveBeenCalledOnce()
  expect(api.vectorizeDocument).not.toHaveBeenCalled()
  const refresh = view.root.findAllByType('button').find(b => b.children.includes('刷新列表'))!
  await act(async () => { refresh.props.onClick() })
  expect(api.vectorizeDocument).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).toContain('可能产生费用')
  const start = view.root.findAllByType('button').find(b => b.children.includes('开始向量化'))!
  await act(async () => { start.props.onClick(); start.props.onClick() })
  expect(api.vectorizeDocument).toHaveBeenCalledExactlyOnceWith('doc_1')
  act(() => view.unmount())
})
