import type { LearningReviewParams, LearningReviewQueue, LearningReviewQueueParams, LearningReviewResult } from '../../../product/types.js'
export type { LearningReviewParams, LearningReviewQueue, LearningReviewResult }
export type ReviewItem = LearningReviewQueue['items'][number]
export interface ReviewApi {
  queue(params?: LearningReviewQueueParams, signal?: AbortSignal): Promise<LearningReviewQueue>
  submit(input: LearningReviewParams): Promise<LearningReviewResult>
}
export class ReviewApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name='ReviewApiError' }
}
export function createReviewApi({baseUrl='/nobei/v1',fetch:fetcher=globalThis.fetch.bind(globalThis)}:{baseUrl?:string;fetch?:typeof fetch}={}):ReviewApi {
  async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
    const controller=new AbortController();const abort=()=>controller.abort()
    if(signal?.aborted) abort()
    signal?.addEventListener('abort',abort,{once:true})
    const timer=setTimeout(abort,30000)
    try {
      const response=await fetcher(baseUrl+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal})
      const value=await response.json().catch(()=>null)
      if(!response.ok || value?.ok!==true || !Object.hasOwn(value,'result')) throw new ReviewApiError(response.status,value?.error?.code ?? 'INVALID_RESPONSE')
      return value.result as T
    } catch(e) {
      if(controller.signal.aborted) throw Error('读取或提交超时，请检查服务状态。')
      throw e
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort)}
  }
  return {
    queue:(params={},signal)=>{
      const query=new URLSearchParams()
      for(const [key,value] of Object.entries(params)) if(value!==undefined)query.set(key,String(value))
      return request(`/learning-reviews${query.size?'?'+query:''}`,undefined,signal)
    },
    submit:({unitId,...body})=>request(`/learning-reviews/${encodeURIComponent(unitId)}/attempts`,body),
  }
}
