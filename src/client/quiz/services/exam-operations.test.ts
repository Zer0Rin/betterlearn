import {it,expect,vi} from 'vitest'
import {ExamOperations,examDraftKey,readExamDraft} from './exam-operations.js'
import type {ExamApi,ExamSession} from '../exam-types.js'
const storage=()=>{const m=new Map<string,string>();return{getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}}}
it('replays the exact start UUID and revision after a lost response and reload',async()=>{
 const startExam=vi.fn().mockRejectedValueOnce(Error('timeout')).mockResolvedValue({session_id:'exam_a'});const api={startExam} as unknown as ExamApi;const store=storage()
 const p=new ExamOperations(api,store);await p.run({kind:'start',id:'paper_a',input:{request_id:'uuid-a',expected_revision:2}})
 const next=new ExamOperations(api,store);expect(startExam).toHaveBeenCalledOnce();await next.retry()
 expect(startExam.mock.calls[1]).toEqual(startExam.mock.calls[0]);expect(next.state.pending).toBeUndefined()
})
it('blocks unpersisted requests and double clicks',async()=>{
 const saveExam=vi.fn();const p=new ExamOperations({saveExam} as unknown as ExamApi,{getItem:()=>null,setItem:()=>{throw Error('quota')}})
 await p.run({kind:'save',id:'exam_a',input:{expected_revision:0,answer_records:[]}});expect(saveExam).not.toHaveBeenCalled();p.discard();expect(p.state.pending).toBeDefined()
})
it('requires explicit discard after conflict and never raises the original revision',async()=>{
 const reviewPaper=vi.fn().mockRejectedValue(Object.assign(Error('conflict'),{status:409}));const p=new ExamOperations({reviewPaper} as unknown as ExamApi,storage())
 await p.run({kind:'review',id:'paper_a',input:{expected_revision:0,reviews:[]}});await p.retry()
 expect(reviewPaper).toHaveBeenCalledOnce();expect(p.state.rejected).toBe(true);p.discard();expect(p.state.pending).toBeUndefined()
})
it('clears the submitted local draft but preserves another window’s newer edits',async()=>{
 const store=storage();const input={expected_revision:0,answer_records:[]};const session={session_id:'exam_a',revision:1,answer_records:[]} as unknown as ExamSession
 store.setItem(examDraftKey('exam_a'),JSON.stringify(input))
 const saveExam=vi.fn(async()=>session);const p=new ExamOperations({saveExam} as unknown as ExamApi,store)
 await p.run({kind:'save',id:'exam_a',input});expect(readExamDraft(store,session).conflict).toBe(false)
 store.setItem(examDraftKey('exam_a'),JSON.stringify({...input,expected_revision:99}))
 await p.run({kind:'save',id:'exam_a',input});expect(readExamDraft(store,session).conflict).toBe(true)
})
it('rejects malformed local answer records before rendering them',()=>{
 const store=storage();store.setItem(examDraftKey('exam_a'),JSON.stringify({expected_revision:0,answer_records:[null]}))
 expect(()=>readExamDraft(store,{session_id:'exam_a',revision:0,questions:[],answer_records:[]} as unknown as ExamSession)).toThrow('无法读取')
})
