import { expect, it } from 'vitest'
import { PracticeController } from './practice.js'
import type { PracticeAttempt } from '../types.js'
import { attempt, answer, fixture } from './practice.fixture.js'
it('persists a stable creation key before dispatch and reuses it after a lost response',async()=>{
  const f=fixture();f.mocks.createAttempt.mockRejectedValueOnce(Error('断开'))
  const first=new PracticeController(f.api,f.storage,'quiz1')
  await first.load();expect(first.state.error).toContain('断开')
  const second=new PracticeController(f.api,f.storage,'quiz1');await second.load()
  expect(f.mocks.createAttempt.mock.calls.map((args:any[])=>args[1])[0]).toBe(f.mocks.createAttempt.mock.calls.map((args:any[])=>args[1])[1])
  expect(second.state.attempt?.attempt_id).toBe('attempt1')
})
it('saves selections without local grades and restores the server draft',async()=>{
  const f=fixture();const p=new PracticeController(f.api,f.storage,'quiz1');await p.load();await p.answer(answer)
  expect(f.mocks.saveAttempt).toHaveBeenCalledWith('attempt1',{expected_revision:0,answer_records:[answer]})
  const reopened=new PracticeController(f.api,f.storage,'quiz1');await reopened.load()
  expect(reopened.state.attempt?.answer_records[0].selected_answers).toEqual(['A'])
  expect(f.mocks.createAttempt).toHaveBeenCalledTimes(1)
})
it('recovers a committed save after its response was lost',async()=>{
  const f=fixture();const p=new PracticeController(f.api,f.storage,'quiz1');await p.load()
  f.mocks.saveAttempt.mockImplementationOnce(async()=>{ f.remote(attempt({revision:1,answer_records:[{...answer,is_correct:null}]}));throw Error('断开') })
  await p.answer(answer)
  expect(p.state.pending).toBeUndefined();expect(p.state.attempt?.revision).toBe(1)
  expect(f.mocks.saveAttempt).toHaveBeenCalledTimes(1)
})
it('blocks overwrite after a conflicting remote edit and preserves the local answer on reload',async()=>{
  const f=fixture();const p=new PracticeController(f.api,f.storage,'quiz1');await p.load()
  f.remote(attempt({revision:1,answer_records:[{...answer,selected_answers:['B'],is_correct:null}]}))
  f.mocks.saveAttempt.mockRejectedValueOnce(Object.assign(Error('冲突'),{status:409}))
  await p.answer(answer)
  expect(p.state.conflict).toBe(true);expect(p.state.pending?.input.answer_records).toEqual([answer])
  const reopened=new PracticeController(f.api,f.storage,'quiz1');await reopened.load();await reopened.retry()
  expect(f.mocks.saveAttempt).toHaveBeenCalledTimes(1)
  expect(reopened.state.pending?.input.answer_records).toEqual([answer])
  await reopened.discardLocal()
  expect(reopened.state.pending).toBeUndefined();expect(reopened.state.attempt?.answer_records[0].selected_answers).toEqual(['B'])
})
it('serializes writes and submits once with canonical scores without generating a report',async()=>{
  const f=fixture();const p=new PracticeController(f.api,f.storage,'quiz1');await p.load();await p.answer(answer)
  let done!:(value:PracticeAttempt)=>void
  f.mocks.submitAttempt.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve}))
  const submitting=p.submit();await p.submit();await p.answer(answer)
  expect(f.mocks.submitAttempt).toHaveBeenCalledTimes(1)
  done(attempt({status:'submitted',accuracy:0,xp_gain:0}));await submitting
  expect(p.state.attempt?.accuracy).toBe(0);expect(p.state.attempt?.xp_gain).toBe(0)
  expect(f.mocks.generateAttemptReport).not.toHaveBeenCalled()
})
it('resolves an uncertain submission by reading without resubmitting or generating a report',async()=>{
  const f=fixture();const p=new PracticeController(f.api,f.storage,'quiz1');await p.load();await p.answer(answer)
  f.mocks.submitAttempt.mockImplementationOnce(async()=>{ f.remote(attempt({status:'submitted',revision:2,answer_records:[{...answer,is_correct:true}],accuracy:100}));throw Error('断开') })
  await p.submit();expect(p.state.attempt?.status).toBe('submitted');expect(p.state.pending).toBeUndefined()
  expect(f.mocks.submitAttempt).toHaveBeenCalledTimes(1);expect(f.mocks.generateAttemptReport).not.toHaveBeenCalled()
})
it('keeps submitted results through report failure and never regenerates a running report',async()=>{
  const f=fixture();f.remote(attempt({status:'submitted',accuracy:100}))
  const p=new PracticeController(f.api,f.storage,'quiz1','attempt1');await p.load();await p.generateReport()
  expect(p.state.attempt?.accuracy).toBe(100);expect(p.state.error).toContain('模型不可用')
  f.remote(attempt({status:'submitted',accuracy:100,report_status:'running'}));await p.load();await p.generateReport()
  expect(f.mocks.generateAttemptReport).toHaveBeenCalledTimes(1)
})
it('does not dispatch creation if the identity cannot be persisted',async()=>{
  const f=fixture();const p=new PracticeController(f.api,{getItem:()=>null,setItem:()=>{throw Error('quota')}},'quiz1');await p.load()
  expect(f.mocks.createAttempt).not.toHaveBeenCalled();expect(p.state.error).toContain('存储')
})

it('retains an unsent answer in memory when storage fills up and retries only after persistence recovers',async()=>{
 const f=fixture();let writable=true
 const storage={...f.storage,setItem:(k:string,v:string)=>{if(!writable)throw Error('quota');f.storage.setItem(k,v)}}
 const p=new PracticeController(f.api,storage,'quiz1');await p.load();writable=false;await p.answer(answer)
 expect(p.state.pending?.input.answer_records).toEqual([answer]);expect(f.mocks.saveAttempt).not.toHaveBeenCalled()
 writable=true;await p.retry();expect(f.mocks.saveAttempt).toHaveBeenCalledOnce();expect(p.state.pending).toBeUndefined()
})
it('never dispatches an unpersisted creation key on a second load attempt',async()=>{
 const f=fixture();const p=new PracticeController(f.api,{getItem:()=>null,setItem:()=>{throw Error('quota')}},'quiz1')
 await p.load();await p.load();expect(f.mocks.createAttempt).not.toHaveBeenCalled()
})
it('keeps the exact pending submission through reload and retries only that payload',async()=>{
 const f=fixture();const p=new PracticeController(f.api,f.storage,'quiz1');await p.load();await p.answer(answer)
 f.mocks.submitAttempt.mockRejectedValueOnce(Error('断开'));await p.submit()
 const original=f.mocks.submitAttempt.mock.calls[0][1]
 const reopened=new PracticeController(f.api,f.storage,'quiz1');await reopened.load();await reopened.retry()
 expect(f.mocks.submitAttempt.mock.calls[1][1]).toEqual(original)
})
it('reenables editing after an interrupted reread is resolved by explicit discard',async()=>{
 const f=fixture();const p=new PracticeController(f.api,f.storage,'quiz1');await p.load()
 f.mocks.saveAttempt.mockRejectedValueOnce(Error('断开'));await p.answer(answer)
 f.mocks.getAttempt.mockRejectedValueOnce(Error('读取失败'));await p.load()
 expect(p.state.ready).toBe(false)
 await p.discardLocal();expect(p.state.ready).toBe(true)
 await p.answer(answer);expect(f.mocks.saveAttempt).toHaveBeenCalledTimes(2)
})
