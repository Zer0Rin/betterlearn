import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { Home } from './QuizWorkspace.js'
import { QuizSetup } from './components/QuizSetup.js'
import type { QuizApi } from './services/contracts.js'
it('keeps ready knowledge documents usable when history is unavailable', async () => {
  const docs = [{ doc_id:'doc1',file_name:'notes.txt',status:'ready',file_size:10,file_type:'txt',chunk_count:1,error_message:null,created_at:'' }]
  const api = { getDocuments:vi.fn().mockResolvedValue({ items:docs }),getHistory:vi.fn().mockRejectedValue(new Error('history unavailable')) } as unknown as QuizApi
  let renderer: ReactTestRenderer
  await act(async () => { renderer=create(<Home api={api} onGenerate={vi.fn()} busy={false}/>) })
  expect(renderer!.root.findByType(QuizSetup).props.documents).toEqual(docs)
  act(()=>renderer.unmount())
})
