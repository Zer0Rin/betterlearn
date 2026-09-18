import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { AttemptHistory } from './AttemptHistory.js'
import { HistoryPage } from './HistoryPage.js'
import { fixture, attempt } from '../services/practice.fixture.js'
import { QuizReport } from '../components/QuizReport.js'
it('opens submitted history without requiring a report and can select another round',async()=>{
 const f=fixture();const one=attempt({status:'submitted',accuracy:0,total_questions:1,correct_count:0})
 const two=attempt({attempt_id:'attempt2',status:'submitted',accuracy:100,total_questions:1,correct_count:1})
 f.mocks.listAttempts.mockResolvedValue({items:[one,two]} as any)
 f.mocks.getAttempt.mockImplementation(async(id?:string)=>id==='attempt2'?two:one)
 const api={...f.api,getDetail:vi.fn(async()=>({...one,summary:'',created_at:''}))}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<AttemptHistory api={api} storage={f.storage} quizId='quiz1' onRestart={()=>{}}/>)})
 expect(view.root.findByType(QuizReport).props.score.accuracy).toBe(0)
 await act(async()=>view.root.findByProps({'aria-label':'作答轮次'}).props.onChange({target:{value:'attempt2'}}))
 expect(view.root.findByType(QuizReport).props.score.accuracy).toBe(100)
 expect(f.mocks.createAttempt).not.toHaveBeenCalled();expect(f.mocks.generateAttemptReport).not.toHaveBeenCalled()
 act(()=>view.unmount())
})
it('distinguishes a real zero from an unsubmitted placeholder in history',async()=>{
 const f=fixture();const api={...f.api,getHistory:vi.fn(async()=>({items:[{quiz_id:'q1',title:'未完成',accuracy:0,status:'unsubmitted' as const,question_count:1,created_at:'created'},{quiz_id:'q2',title:'已完成',accuracy:0,status:'submitted' as const,question_count:1,created_at:'created',submitted_at:'submitted'}],total:2,page:1,page_size:10}))}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<HistoryPage api={api} onOpen={()=>{}}/>)})
 const scores=view.root.findAllByProps({className:'zl-history-score'})
 expect(JSON.stringify(scores[0].children)).toContain('未交卷')
 expect(scores[1].children[0]).toBe('0')
 expect(JSON.stringify(view.toJSON())).toContain('submitted')
 act(()=>view.unmount())
})
it('does not display the legacy zero question-count placeholder for an unsubmitted quiz',async()=>{
 const f=fixture();const api={...f.api,getHistory:async()=>({items:[{quiz_id:'q',title:'新练习',accuracy:0,question_count:0,status:'unsubmitted' as const,created_at:'now'}],total:1,page:1,page_size:10})}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<HistoryPage api={api} onOpen={()=>{}}/>)})
 expect(view.root.findByProps({className:'zl-history-name'}).findByType('small').children.join('')).not.toContain('0 道题')
 act(()=>view.unmount())
})
