import {expect,it,vi} from 'vitest'
import {SourceOperations,type SourceWrite} from './source-operations.js'
import {goalStorage} from '../pages/goals.fixture.js'
import {QuizApiError} from './api.js'
const request:SourceWrite={kind:'generate',input:{request_id:'fixed',source:{courseId:'course1',unitId:'unit1'},user_input:'出题',question_count:3,difficulty:'easy',generate_images:false}}
const api=()=>({generateFromSource:vi.fn().mockResolvedValue({task_id:'task1'}),setBankSource:vi.fn().mockResolvedValue({source:null,source_revision:2}),getBankSource:vi.fn()})
it('restores a lost generation response with identical request and keeps the task across reload',async()=>{
 const a=api(),storage=goalStorage();a.generateFromSource.mockRejectedValueOnce(Error('lost'))
 const first=new SourceOperations(a,storage,'key');await first.run(request)
 const restored=new SourceOperations(a,storage,'key');await restored.retry()
 expect(a.generateFromSource.mock.calls.map(c=>c[0])).toEqual([request.input,request.input])
 const again=new SourceOperations(a,storage,'key');await again.retry()
 expect(a.generateFromSource).toHaveBeenCalledTimes(2);expect(again.state.pending).toMatchObject({taskId:'task1'})
})
it('freezes binding selection and revision and requires reread after conflict',async()=>{
 const a=api(),storage=goalStorage();a.setBankSource.mockRejectedValueOnce(Error('lost')).mockRejectedValueOnce(new QuizApiError('conflict',409))
 const op=new SourceOperations(a,storage,'key');const bind:SourceWrite={kind:'bind',id:7,input:{expected_revision:2,source:{courseId:'c',unitId:'u'}}}
 await op.run(bind);bind.input.expected_revision=99;await op.retry();await op.retry()
 expect(a.setBankSource.mock.calls).toEqual([[7,{expected_revision:2,source:{courseId:'c',unitId:'u'}}],[7,{expected_revision:2,source:{courseId:'c',unitId:'u'}}]])
 expect(op.state.rejected).toBe(true);op.clearFinished();expect(op.state.pending).toBeUndefined()
})
it('does not send without durable storage or overwrite another window',async()=>{
 const a=api();const broken=new SourceOperations(a,{getItem:()=>null,setItem:()=>{throw Error('full')}},'key');await broken.run(request);expect(a.generateFromSource).not.toHaveBeenCalled()
 const storage=goalStorage(),op=new SourceOperations(a,storage,'key');storage.setItem('key',JSON.stringify(request));await op.run(request)
 expect(a.generateFromSource).not.toHaveBeenCalled();expect(JSON.parse(storage.getItem('key')!)).toEqual(request)
})
it('does not allow clearing uncertain binding and clears successful unlink only',async()=>{
 const a=api();a.setBankSource.mockRejectedValueOnce(Error('lost'));const op=new SourceOperations(a,goalStorage(),'key')
 await op.run({kind:'bind',id:1,input:{expected_revision:4,source:null}});op.clearFinished();expect(op.state.pending).toBeDefined()
 await op.retry();expect(op.state.pending).toBeUndefined();expect(op.state.completed).toBe(1)
})
it('blocks corrupt recovery data until explicitly cleared',()=>{
 const storage=goalStorage();storage.setItem('key','broken');const op=new SourceOperations(api(),storage,'key')
 expect(op.state.rejected).toBe(true);op.clearFinished();expect(op.state.rejected).toBe(false);expect(storage.getItem('key')).toBe('null')
})
