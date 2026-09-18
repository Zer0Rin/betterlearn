import { describe, it, expect, vi } from 'vitest'
import { createQuizApi } from './api.js'

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok' }))
describe('browser API', () => {
  it('shares a host session request and uploads without browser authentication or JSON headers', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ token: 'local-token', user: { id: 1 } }))
      .mockResolvedValueOnce(ok({ doc_id: 'doc1', status: 'processing' }))
    const api = createQuizApi({ fetch: fetcher })
    await Promise.all([api.connect(), api.connect()])
    await api.uploadDocument(new File(['hello'], 'notes.txt'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    const headers = new Headers(fetcher.mock.calls[1][1].headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(fetcher.mock.calls[0][0]).toBe('/nobei/quiz/v1/session')
    expect(headers.has('Content-Type')).toBe(false)
    expect(fetcher.mock.calls[1][1].body).toBeInstanceOf(FormData)
  })
  it('preserves document source and generation settings', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ user: { id: 1 } })).mockResolvedValueOnce(ok({ task_id: 'task1' }))
    const api = createQuizApi({ fetch: fetcher })
    await api.connect()
    await api.generateQuiz({ source: { kind: 'document', docId: 'doc42', title: 'notes.txt', text: '重点学习第一章' }, questionCount: 8, difficulty: 'hard', generateImages: true })
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ user_input: '重点学习第一章', doc_id: 'doc42', question_count: 8, difficulty: 'hard', generate_images: true })
  })
  it('rejects an external source until its host adapter is supplied', async () => {
    const api = createQuizApi({ fetch: vi.fn() })
    await expect(api.generateQuiz({ source: { kind: 'external', provider: 'betterlearn', sourceId: 'book1', title: 'Book', text: 'Knowledge' }, questionCount: 5, difficulty: 'mixed', generateImages: false })).rejects.toThrow('来源适配器')
  })
  it('requests contiguous document text from the content endpoint', async () => {
    const content = { doc_id: 'doc42', file_name: 'notes.md', file_type: 'md', media_type: 'text/markdown', text: '# 标题', character_count: 4, byte_size: 7 }
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ user: { id: 1 } })).mockResolvedValueOnce(ok(content))
    const api = createQuizApi({ fetch: fetcher })
    await api.connect()
    await expect(api.getDocumentContent('doc 42')).resolves.toEqual(content)
    expect(fetcher.mock.calls[1][0]).toBe('/nobei/quiz/v1/knowledge/documents/doc%2042/content')
    expect(fetcher.mock.calls[1][1].method).toBe('GET')
  })
  it('surfaces non-JSON server failures instead of a misleading parse error', async () => {
    const api = createQuizApi({ fetch: vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })) })
    await expect(api.connect()).rejects.toThrow('502')
  })
})

it('uses owned attempt endpoints with stable request identity and answer-only payloads', async () => {
  const fetcher = vi.fn(async () => ok({}))
  const api = createQuizApi({ fetch: fetcher })
  const input = { expected_revision: 2, answer_records: [{ question_id: 'q1', selected_answers: ['A'], duration_ms: 12 }] }
  await api.createAttempt('quiz1', 'request1')
  await api.listAttempts('quiz1')
  await api.getAttempt('attempt1')
  await api.saveAttempt('attempt1', input)
  await api.submitAttempt('attempt1', input)
  await api.generateAttemptReport('attempt1')
  expect(fetcher.mock.calls.map(([url, init]: any[]) => [url, init.method, init.body && JSON.parse(init.body)])).toEqual([
    ['/nobei/quiz/v1/quiz/quiz1/attempts', 'POST', { request_id: 'request1' }],
    ['/nobei/quiz/v1/quiz/quiz1/attempts', 'GET', undefined],
    ['/nobei/quiz/v1/quiz/attempts/attempt1', 'GET', undefined],
    ['/nobei/quiz/v1/quiz/attempts/attempt1/answers', 'PUT', input],
    ['/nobei/quiz/v1/quiz/attempts/attempt1/submit', 'POST', input],
    ['/nobei/quiz/v1/quiz/attempts/attempt1/report', 'POST', {}],
  ])
})
it('preserves HTTP status for conflict recovery', async () => {
  const api = createQuizApi({ fetch: vi.fn(async () => new Response(JSON.stringify({detail:'已变化'}), {status:409})) })
  await expect(api.getDetail('q')).rejects.toMatchObject({ status: 409 })
})
it('encodes bank filters and sends organization-only writes with exact HTTP methods',async()=>{
 const fetcher=vi.fn(async()=>ok({}));const api=createQuizApi({fetch:fetcher})
 await api.getBankEntries({scope:'wrong',search:'a% & 中',category_id:2,page:3,sort:'oldest'})
 await api.getBankEntry(7);await api.getBankHistory(7,2);await api.getBankStats();await api.getBankCategories()
 await api.setBankBookmark(7,true);await api.createBankCategory('概念');await api.renameBankCategory(2,'过程')
 await api.setBankCategory(7,2,true);await api.setBankCategory(7,2,false);await api.deleteBankCategory(2)
 const calls=fetcher.mock.calls as unknown as [string,RequestInit][]
 const query=new URL(calls[0][0],'http://test').searchParams
 expect(Object.fromEntries(query)).toEqual({scope:'wrong',search:'a% & 中',category_id:'2',page:'3',sort:'oldest',page_size:'20'})
 expect(calls.slice(1).map(([url,init])=>[url.replace('/nobei/quiz/v1',''),init.method,init.body&&JSON.parse(init.body as string)])).toEqual([
 ['/question-bank/entries/7','GET',undefined],['/question-bank/entries/7/history?page=2&page_size=20','GET',undefined],
 ['/question-bank/stats','GET',undefined],['/question-bank/categories','GET',undefined],
 ['/question-bank/entries/7','PUT',{bookmarked:true}],['/question-bank/categories','POST',{name:'概念'}],['/question-bank/categories/2','PUT',{name:'过程'}],
 ['/question-bank/entries/7/categories/2','PUT',{}],['/question-bank/entries/7/categories/2','DELETE',undefined],['/question-bank/categories/2','DELETE',undefined]])
})

it('uses goal list/detail and preserves creation identity and archive CAS payloads',async()=>{
 const fetcher=vi.fn(async()=>ok({}));const api=createQuizApi({fetch:fetcher})
 const input={request_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',title:'目标',source:{courseId:'course_a',unitId:'unit_a'},target_percent:90,min_distinct_questions:5,due_at:'2035-01-01T00:00:00.000Z'}
 await api.listGoals('archived',2);await api.getGoal('goal_a');await api.createGoal(input);await api.archiveGoal('goal_a',{expected_revision:3,archived:true})
 expect(fetcher.mock.calls.map(([url,init]:any[])=>[url,init.method,init.body&&JSON.parse(init.body)])).toEqual([
 ['/nobei/quiz/v1/learning-goals?status=archived&page=2&page_size=20','GET',undefined],
 ['/nobei/quiz/v1/learning-goals/goal_a','GET',undefined],
 ['/nobei/quiz/v1/learning-goals','POST',input],
 ['/nobei/quiz/v1/learning-goals/goal_a/archive','PUT',{expected_revision:3,archived:true}],
 ])
})

it('uses all exam routes with frozen request bodies and revisions',async()=>{
 const fetcher=vi.fn(async()=>ok({}));const api=createQuizApi({fetch:fetcher})
 const paper={title:'自测',duration_seconds:60,allocations:[]};const review={expected_revision:0,reviews:[]};const start={request_id:'same-id',expected_revision:1};const answers={expected_revision:0,answer_records:[]}
 await api.previewPaper(paper);await api.createPaper({...paper,request_id:'create-id'});await api.listPapers(2);await api.getPaper('paper_a');await api.reviewPaper('paper_a',review);await api.startExam('paper_a',start);await api.listExams(2);await api.getExam('exam_a');await api.saveExam('exam_a',answers);await api.submitExam('exam_a',answers)
 expect(fetcher.mock.calls.map(([url,init]:any[])=>[url,init.method,init.body&&JSON.parse(init.body)])).toEqual([
 ['/nobei/quiz/v1/exam-papers/preview','POST',paper],['/nobei/quiz/v1/exam-papers','POST',{...paper,request_id:'create-id'}],['/nobei/quiz/v1/exam-papers?page=2&page_size=20','GET',undefined],['/nobei/quiz/v1/exam-papers/paper_a','GET',undefined],['/nobei/quiz/v1/exam-papers/paper_a/review','PUT',review],['/nobei/quiz/v1/exam-papers/paper_a/sessions','POST',start],['/nobei/quiz/v1/exam-sessions?page=2&page_size=20','GET',undefined],['/nobei/quiz/v1/exam-sessions/exam_a','GET',undefined],['/nobei/quiz/v1/exam-sessions/exam_a/answers','PUT',answers],['/nobei/quiz/v1/exam-sessions/exam_a/submit','POST',answers],
 ])
})

it('uses ID-only source contracts and preserves the explicit generation request ID',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>ok({}));const api=createQuizApi({fetch:fetcher})
 const source={courseId:'course1',unitId:'unit1'}
 await api.getBankSource(9);await api.setBankSource(9,{source,expected_revision:3});await api.setBankSource(9,{source:null,expected_revision:4})
 const input={request_id:'original-request',source,user_input:'出题',question_count:3,difficulty:'easy' as const,generate_images:false};await api.generateFromSource(input)
 expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/nobei/quiz/v1/question-bank/entries/9/source','/nobei/quiz/v1/question-bank/entries/9/source','/nobei/quiz/v1/question-bank/entries/9/source','/nobei/quiz/v1/quiz/generate/from-source'])
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({source,expected_revision:3});expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual(input)
})

it('reads paginated knowledge versions and history without mutations',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>ok({items:[],total:0,page:2,page_size:20})),api=createQuizApi({fetch:fetcher})
 const filter={knowledge_point_id:'kp_'+'a'.repeat(20),content_version:'b'.repeat(64),page:2}
 await api.getKnowledgeStats(filter);await api.getKnowledgeHistory(filter)
 for(const [i,call] of fetcher.mock.calls.entries()){
  const url=new URL(call[0],'http://localhost');expect(url.pathname).toBe('/nobei/quiz/v1/question-bank/knowledge-stats'+(i?'/history':''))
  expect(Object.fromEntries(url.searchParams)).toEqual({...filter,page:'2',page_size:'20'});expect(call[1].method).toBe('GET');expect(call[1].body).toBeUndefined()
 }
})

it('starts vectorization only through the explicit POST endpoint', async () => {
  const fetcher = vi.fn().mockResolvedValue(ok({ status: 'processing' }))
  await createQuizApi({ fetch: fetcher }).vectorizeDocument('doc_1')
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0][0]).toBe('/nobei/quiz/v1/knowledge/documents/doc_1/vectorize')
  expect(fetcher.mock.calls[0][1].method).toBe('POST')
})
