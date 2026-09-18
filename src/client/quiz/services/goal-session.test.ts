import {expect,it,vi} from 'vitest'
import {GoalSession} from './goal-session.js'
import type {GoalApi,GoalCreate} from '../goal-types.js'
const input:Omit<GoalCreate,'request_id'>={title:'光合作用',source:{courseId:'course_a',unitId:'unit_a'},target_percent:90,min_distinct_questions:5,due_at:'2030-01-01T00:00:00.000Z'}
const storage=()=>{const values=new Map<string,string>();return{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}}}
it('persists exact creation before dispatch and explicitly replays after reload',async()=>{
 const store=storage();const createGoal=vi.fn().mockRejectedValueOnce(Error('timeout')).mockResolvedValue({goal_id:'goal_a'})
 const api={createGoal} as unknown as GoalApi;const s=new GoalSession(api,store)
 await s.create(input);const request=createGoal.mock.calls[0][0]
 expect(request.request_id).toMatch(/^[a-f0-9-]{36}$/)
 const next=new GoalSession(api,store);expect(createGoal).toHaveBeenCalledOnce()
 await next.retry();expect(createGoal.mock.calls[1][0]).toEqual(request);expect(next.state.result?.goal_id).toBe('goal_a')
 expect(new GoalSession(api,store).state.pending).toBeUndefined()
})
it('locks duplicate actions and preserves archive revision on conflict',async()=>{
 const archiveGoal=vi.fn().mockRejectedValue(Object.assign(Error('conflict'),{status:409}))
 const s=new GoalSession({archiveGoal} as unknown as GoalApi,storage())
 await s.archive({goal_id:'goal_a',revision:3,title:'目标'},true)
 await s.retry();await s.create(input)
 expect(archiveGoal).toHaveBeenCalledExactlyOnceWith('goal_a',{expected_revision:3,archived:true})
 expect(s.state.rejected).toBe(true);s.discard();expect(s.state.pending).toBeUndefined()
})
it('does not dispatch when persistence fails or discard an uncertain request',async()=>{
 const createGoal=vi.fn();const s=new GoalSession({createGoal} as unknown as GoalApi,{getItem:()=>null,setItem:()=>{throw Error('quota')}})
 await s.create(input);expect(createGoal).not.toHaveBeenCalled();s.discard();expect(s.state.pending).toBeDefined()
})
it('does not overwrite a request saved by another window',async()=>{
 const store=storage();const createGoal=vi.fn().mockRejectedValue(Error('timeout'));const api={createGoal} as unknown as GoalApi
 const a=new GoalSession(api,store);const b=new GoalSession(api,store)
 await a.create(input);await b.create({...input,title:'other'})
 expect(createGoal).toHaveBeenCalledOnce();expect(b.state.pending).toEqual(a.state.pending)
})
it('rejects double clicks while a write is in flight',async()=>{
 let resolve!:(value:any)=>void;const createGoal=vi.fn(()=>new Promise(r=>{resolve=r}));const s=new GoalSession({createGoal} as unknown as GoalApi,storage())
 const work=s.create(input);await s.create(input);await s.retry();expect(createGoal).toHaveBeenCalledOnce();resolve({goal_id:'goal_a'});await work
})
