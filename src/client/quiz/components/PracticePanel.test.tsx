import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { PracticePanel } from './PracticePanel.js'
import { attempt, answer, fixture } from '../services/practice.fixture.js'
import { QuizPlayer } from './QuizPlayer.js'
import { QuizReport } from './QuizReport.js'
import { getPractice } from '../services/practice.js'
const quiz={...attempt(),summary:''}
it('saves answers, submits without model calls, and leaves results visible when an explicit report fails',async()=>{
 const f=fixture();let view!:ReactTestRenderer
 await act(async()=>{view=create(<PracticePanel api={f.api} storage={f.storage} quiz={quiz} onRestart={()=>{}}/>)})
 await act(async()=>view.root.findByType(QuizPlayer).props.onAnswer({...answer,is_correct:false}))
 await act(async()=>view.root.findByType(QuizPlayer).props.onFinish())
 expect(view.root.findByType(QuizReport).props.score.accuracy).toBe(100)
 expect(view.root.findByType(QuizReport).props.score.xp_gain).toBe(0)
 expect(f.mocks.generateAttemptReport).not.toHaveBeenCalled()
 await act(async()=>view.root.findByType(QuizReport).props.onRetry())
 expect(view.root.findByType(QuizReport).props.score.accuracy).toBe(100)
 expect(JSON.stringify(view.toJSON())).toContain('模型不可用')
 act(()=>view.unmount())
})
it('keeps pending choices visible on save conflict and requires an explicit discard',async()=>{
 const f=fixture();let view!:ReactTestRenderer
 await act(async()=>{view=create(<PracticePanel api={f.api} storage={f.storage} quiz={quiz} onRestart={()=>{}}/>)})
 f.remote(attempt({revision:1,answer_records:[{...answer,selected_answers:['B'],is_correct:null}]}))
 f.mocks.saveAttempt.mockRejectedValueOnce(Error('冲突'))
 await act(async()=>view.root.findByType(QuizPlayer).props.onAnswer({...answer,is_correct:true}))
 expect(JSON.stringify(view.toJSON())).toContain('本地待保存答案')
 expect(view.root.findByType(QuizPlayer).props.busy).toBe(true)
 expect(view.root.findAllByType('button').some(b=>b.props.children==='使用服务端记录并舍弃本地待保存答案')).toBe(true)
 act(()=>view.unmount())
})
it('does not recreate or mutate a submitted round when remounted without a report',async()=>{
 const f=fixture();f.remote(attempt({status:'submitted',accuracy:0,correct_count:0,total_questions:1,submitted_at:'2026-09-18 00:01:00'}))
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<PracticePanel api={f.api} storage={f.storage} quiz={quiz} attemptId='attempt1' onRestart={()=>{}}/>)})
 expect(view.root.findByType(QuizReport).props.score.accuracy).toBe(0)
 expect(f.mocks.createAttempt).not.toHaveBeenCalled();expect(f.mocks.generateAttemptReport).not.toHaveBeenCalled()
 act(()=>view.unmount())
})
it('shares the writer between a current panel and the same round opened from history',async()=>{
 const f=fixture();const current=getPractice(f.api,f.storage,'quiz1');await current.load()
 expect(getPractice(f.api,f.storage,'quiz1','attempt1')).toBe(current)
})
it('ignores a late read from a previously selected round',async()=>{
 const f=fixture();let resolveOld!:(value:ReturnType<typeof attempt>)=>void
 f.mocks.getAttempt.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve}))
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<PracticePanel api={f.api} storage={f.storage} quiz={quiz} attemptId='attempt1' onRestart={()=>{}}/>)})
 f.remote(attempt({attempt_id:'attempt2',status:'submitted',accuracy:0,total_questions:1,correct_count:0}))
 await act(async()=>view.update(<PracticePanel api={f.api} storage={f.storage} quiz={quiz} attemptId='attempt2' onRestart={()=>{}}/>))
 await act(async()=>resolveOld(attempt({status:'submitted',accuracy:100,total_questions:1,correct_count:1})))
 expect(view.root.findByType(QuizReport).props.score.accuracy).toBe(0)
 act(()=>view.unmount())
})
it('bounds running report queries and stops polling on unmount without generating',async()=>{
 vi.useFakeTimers()
 const f=fixture();f.remote(attempt({status:'submitted',accuracy:100,correct_count:1,total_questions:1,report_status:'running'}))
 let view!:ReactTestRenderer
 try {
  await act(async()=>{view=create(<PracticePanel api={f.api} storage={f.storage} quiz={quiz} attemptId='attempt1' onRestart={()=>{}}/>)})
  await act(async()=>vi.advanceTimersByTimeAsync(125000))
  expect(JSON.stringify(view.toJSON())).toContain('报告仍在处理中')
  expect(f.mocks.generateAttemptReport).not.toHaveBeenCalled()
  const count=f.mocks.getAttempt.mock.calls.length
  act(()=>view.unmount())
  await act(async()=>vi.advanceTimersByTimeAsync(10000))
  expect(f.mocks.getAttempt).toHaveBeenCalledTimes(count)
 }finally{vi.useRealTimers()}
})
