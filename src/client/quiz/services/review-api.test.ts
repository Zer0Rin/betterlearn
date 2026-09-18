import {it,expect,vi} from 'vitest'
import {createReviewApi} from './review-api.js'
it('uses Core envelopes, exact versioned review payloads and no quiz login',async()=>{
 const fetcher=vi.fn(async()=>Response.json({ok:true,result:{items:[]}}));const api=createReviewApi({fetch:fetcher})
 await api.queue({offset:20,limit:20})
 const body={unitId:'unit_a',assessmentId:'assessment_a',optionId:'option_a',expectedAttemptId:'attempt_a',idempotencyKey:'idem_12345678901234567890'}
 await api.submit(body)
 const calls=fetcher.mock.calls as unknown as [string,RequestInit][]
 expect(calls[0][0]).toBe('/nobei/v1/learning-reviews?offset=20&limit=20')
 expect(calls[1][0]).toBe('/nobei/v1/learning-reviews/unit_a/attempts')
 const {unitId,...payload}=body
 expect(JSON.parse(calls[1][1].body as string)).toEqual(payload)
})
it('preserves Core conflicts for explicit refresh rather than replacing a request key',async()=>{
 const api=createReviewApi({fetch:vi.fn(async()=>Response.json({ok:false,error:{code:'LEARNING_STATE_CONFLICT'}},{status:409}))})
 await expect(api.queue()).rejects.toMatchObject({status:409,code:'LEARNING_STATE_CONFLICT'})
})
