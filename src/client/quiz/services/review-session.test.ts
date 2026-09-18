import {expect,it,vi} from 'vitest'
import {ReviewSession} from './review-session.js'
import type {ReviewApi,ReviewItem,LearningReviewResult} from './review-api.js'
import {reviewItem} from './review.fixture.js'
const result={attempt:{attemptId:'attempt_bbbbbbbbbbbbbbbbbbbb',correct:true},course:{units:[]},review:{phase:'review'}} as unknown as LearningReviewResult
const storage=()=>{const values=new Map<string,string>();return{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}}}
it('persists before dispatch, keeps a frozen request on network failure and reuses it after reload',async()=>{
 const store=storage();const submit=vi.fn().mockRejectedValueOnce(Error('断开')).mockResolvedValue(result)
 const api={submit} as unknown as ReviewApi;const p=new ReviewSession(api,store)
 await p.submit(reviewItem,reviewItem.assessment.options[0].optionId)
 expect(p.state.pending?.request.idempotencyKey).toMatch(/^idem_[a-f0-9]{20}$/)
 const original=submit.mock.calls[0][0];const reopened=new ReviewSession(api,store)
 await reopened.retry();expect(submit.mock.calls[1][0]).toEqual(original);expect(reopened.state.result).toBe(result)
 expect(new ReviewSession(api,store).state.pending).toBeUndefined()
})
it('refuses to change answers or double submit while an accepted request is pending',async()=>{
 let resolve!:(value:LearningReviewResult)=>void;const submit=vi.fn(()=>new Promise<LearningReviewResult>(r=>{resolve=r}))
 const p=new ReviewSession({submit} as unknown as ReviewApi,storage())
 const work=p.submit(reviewItem,reviewItem.assessment.options[0].optionId)
 await p.submit(reviewItem,'changed');await p.retry();expect(submit).toHaveBeenCalledOnce()
 resolve(result);await work
})
it('requires explicit queue refresh after a stale-state conflict and does not replace the key',async()=>{
 const submit=vi.fn().mockRejectedValue(Object.assign(Error('LEARNING_STATE_CONFLICT'),{status:409}))
 const p=new ReviewSession({submit} as unknown as ReviewApi,storage())
 await p.submit(reviewItem,reviewItem.assessment.options[0].optionId);const key=p.state.pending!.request.idempotencyKey
 expect(p.state.conflict).toBe(true);await p.submit(reviewItem,'changed');expect(p.state.pending?.request.idempotencyKey).toBe(key)
 p.discardConflict();expect(p.state.pending).toBeUndefined()
})
it('does not dispatch an unpersisted review and retains the selection for recovery',async()=>{
 const submit=vi.fn();const p=new ReviewSession({submit} as unknown as ReviewApi,{getItem:()=>null,setItem:()=>{throw Error('quota')}})
 await p.submit(reviewItem,reviewItem.assessment.options[0].optionId)
 expect(submit).not.toHaveBeenCalled();expect(p.state.pending?.request.optionId).toBe(reviewItem.assessment.options[0].optionId)
})
it('does not abandon an uncertain successful-or-failed submission',async()=>{
 const p=new ReviewSession({submit:async()=>{throw Error('timeout')}} as unknown as ReviewApi,storage())
 await p.submit(reviewItem,reviewItem.assessment.options[0].optionId);p.discardConflict();expect(p.state.pending).toBeDefined()
})
it('does not overwrite a different request left by another window when retrying an old request',async()=>{
 const store=storage();const submit=vi.fn().mockRejectedValue(Error('断开'))
 const p=new ReviewSession({submit} as unknown as ReviewApi,store)
 await p.submit(reviewItem,reviewItem.assessment.options[0].optionId)
 const different={...p.state.pending!,request:{...p.state.pending!.request,idempotencyKey:'idem_bbbbbbbbbbbbbbbbbbbb'}}
 store.setItem('betterlearn:core:pending-review',JSON.stringify(different))
 await p.retry()
 expect(submit).toHaveBeenCalledOnce()
 expect(JSON.parse(store.getItem('betterlearn:core:pending-review')!).request.idempotencyKey).toBe(different.request.idempotencyKey)
})
it('allows explicit discard of an unreadable recovery record without sending a request',()=>{
 const store=storage();store.setItem('betterlearn:core:pending-review','{broken')
 const submit=vi.fn();const p=new ReviewSession({submit} as unknown as ReviewApi,store)
 expect(p.state.conflict).toBe(true)
 p.discardConflict()
 expect(p.state.conflict).toBe(false)
 expect(new ReviewSession({submit} as unknown as ReviewApi,store).state.error).toBe('')
 expect(submit).not.toHaveBeenCalled()
})
it('preserves a valid replacement when discarding an unreadable recovery record',async()=>{
 const store=storage();store.setItem('betterlearn:core:pending-review','{broken')
 const api={submit:vi.fn().mockRejectedValue(Error('timeout'))} as unknown as ReviewApi
 const p=new ReviewSession(api,store)
 store.setItem('betterlearn:core:pending-review','null')
 const other=new ReviewSession(api,store);await other.submit(reviewItem,reviewItem.assessment.options[0].optionId)
 const saved=store.getItem('betterlearn:core:pending-review')
 p.discardConflict()
 expect(store.getItem('betterlearn:core:pending-review')).toBe(saved)
})
