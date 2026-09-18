import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {it,expect,vi} from 'vitest'
import {ReviewPage} from './ReviewPage.js'
import {reviewItem} from '../services/review.fixture.js'
import type {ReviewApi,LearningReviewResult} from '../services/review-api.js'
const store=()=>{const data=new Map<string,string>();return{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}}}
const button=(view:ReactTestRenderer,name:string)=>view.root.findAllByType('button').find(b=>b.props.children===name)!
it('shows cross-course due work, submits selected options and displays server scheduling without quiz calls',async()=>{
 const queue=vi.fn(async()=>({items:[reviewItem],total:1,limit:20,offset:0,asOf:'2026-09-18T00:00:00Z'}))
 queue.mockResolvedValueOnce({items:[reviewItem],total:1,limit:20,offset:0,asOf:'2026-09-18T00:00:00Z'}).mockResolvedValue({items:[],total:0,limit:20,offset:0,asOf:'2026-09-18T00:00:00Z'})
 const result={attempt:{attemptId:'done',correct:true},course:{units:[{unitId:reviewItem.unitId,mastery:{dueAt:'2026-09-25T00:00:00Z'}}]},review:{phase:'review'}} as unknown as LearningReviewResult
 const submit=vi.fn(async()=>result);let view!:ReactTestRenderer
 await act(async()=>{view=create(<ReviewPage api={{queue,submit}} storage={store()}/>)})
 expect(submit).not.toHaveBeenCalled();expect(JSON.stringify(view.toJSON())).toContain('生物')
 act(()=>button(view,'开始复习').props.onClick())
 expect(JSON.stringify(view.toJSON())).not.toContain('参考答案')
 act(()=>view.root.findByProps({role:'radio'}).props.onClick())
 await act(async()=>button(view,'提交复习答案').props.onClick())
 expect(submit.mock.calls[0]?.[0]).toMatchObject({unitId:reviewItem.unitId,optionId:reviewItem.assessment.options[0].optionId,expectedAttemptId:reviewItem.expectedAttemptId})
 expect(JSON.stringify(view.toJSON())).toContain('下次复习');expect(JSON.stringify(view.toJSON())).toContain('2026-09-25')
 act(()=>view.unmount())
})
it('restores the exact pending choice after remount instead of allowing a new answer',async()=>{
 const storage=store();const queue=async()=>({items:[reviewItem],total:1,limit:20,offset:0,asOf:'now'})
 const submit=vi.fn(async()=>{throw Error('断开')});let view!:ReactTestRenderer
 await act(async()=>{view=create(<ReviewPage api={{queue,submit}} storage={storage}/>)})
 act(()=>button(view,'开始复习').props.onClick());act(()=>view.root.findByProps({role:'radio'}).props.onClick())
 await act(async()=>button(view,'提交复习答案').props.onClick());act(()=>view.unmount())
 await act(async()=>{view=create(<ReviewPage api={{queue,submit}} storage={storage}/>)})
 expect(view.root.findByProps({role:'radio'}).props.disabled).toBe(true)
 expect(button(view,'重试原复习请求')).toBeDefined();expect(submit).toHaveBeenCalledOnce()
 act(()=>view.unmount())
})
