import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {it,expect,vi} from 'vitest'
import {ExamAttempt} from './ExamAttempt.js'
import {ExamPaperReview} from './ExamPaperReview.js'
import {ExamBuilder} from './ExamBuilder.js'
import {paper,exam} from '../pages/exams.fixture.js'
import {goalStorage} from '../pages/goals.fixture.js'
import type {QuizApi} from '../services/contracts.js'
const button=(v:ReactTestRenderer,name:string)=>v.root.findAllByType('button').find(b=>b.props.children===name)!
it('requires each explicit approval and a saved approved revision before starting',()=>{
 const onReview=vi.fn();let v!:ReactTestRenderer
 act(()=>{v=create(<ExamPaperReview paper={paper} busy={false} onReview={onReview} onStart={()=>{}}/>)})
 expect(button(v,'开始计时考试').props.disabled).toBe(true)
 act(()=>v.root.findByType('input').props.onChange({target:{checked:true}}));act(()=>button(v,'保存覆盖审核').props.onClick())
 expect(onReview).toHaveBeenCalledWith([{question_id:'q1',approved:true,note:''}]);expect(button(v,'开始计时考试').props.disabled).toBe(true);act(()=>v.unmount())
 act(()=>{v=create(<ExamPaperReview paper={{...paper,status:'approved',reviews:[{question_id:'q1',approved:true,note:''}]}} busy={false} onReview={onReview} onStart={()=>{}}/>)})
 expect(button(v,'开始计时考试').props.disabled).toBe(false);act(()=>v.unmount())
})
it('handles multi-select without answer disclosure, persists local edits and saves a full CAS draft',()=>{
 const store=goalStorage(),onSave=vi.fn();let v!:ReactTestRenderer
 const props={session:exam,storage:store,busy:false,onSave,onSubmit:vi.fn(),onReport:vi.fn()}
 act(()=>{v=create(<ExamAttempt {...props}/>)})
 expect(JSON.stringify(v.toJSON())).not.toContain('答案解析')
 for(const b of v.root.findAllByProps({'aria-pressed':false}))act(()=>b.props.onClick())
 act(()=>button(v,'保存考试草稿').props.onClick())
 expect(onSave.mock.calls[0][0]).toEqual({expected_revision:0,answer_records:[{question_id:'q1',selected_answers:['A','B'],duration_ms:0}]})
 act(()=>v.unmount());act(()=>{v=create(<ExamAttempt {...props}/>)})
 expect(v.root.findAllByProps({'aria-pressed':true})).toHaveLength(2);act(()=>v.unmount())
})
it('stops editing at expiry and submits only the server-saved answers',()=>{
 const onSubmit=vi.fn();let v!:ReactTestRenderer
 act(()=>{v=create(<ExamAttempt session={{...exam,status:'expired'}} storage={goalStorage()} busy={false} onSave={()=>{}} onSubmit={onSubmit} onReport={()=>{}}/>)})
 expect(v.root.findAllByProps({'aria-pressed':false})[0].props.disabled).toBe(true)
 act(()=>button(v,'结算到期成绩').props.onClick());act(()=>button(v,'确认交卷').props.onClick())
 expect(onSubmit).toHaveBeenCalledWith({expected_revision:0,answer_records:[]});act(()=>v.unmount())
})
it('invalidates a ready preview when allocation changes',async()=>{
 const previewPaper=vi.fn(async()=>({ready:true,total_questions:1,coverage:[{...paper.allocations[0],selected:1,missing:0,available_distinct:1,invalid_count:0}],items:paper.items}))
 const api={getBankEntries:async()=>({items:[{source:paper.items[0].source}],total:1}),previewPaper} as unknown as QuizApi
 let v!:ReactTestRenderer;await act(async()=>{v=create(<ExamBuilder api={api} busy={false} onCreate={()=>{}} onCancel={()=>{}}/>)})
 act(()=>v.root.findByProps({'aria-label':'试卷名称'}).props.onChange({target:{value:'自测'}}))
 act(()=>v.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}))
 await act(async()=>button(v,'预览组卷缺口').props.onClick())
 expect(button(v,'创建冻结试卷').props.disabled).toBe(false)
 act(()=>v.root.findByProps({'aria-label':'来源题数 1'}).props.onChange({target:{value:'2'}}))
 expect(button(v,'创建冻结试卷')).toBeUndefined();act(()=>v.unmount())
})
it('does not overwrite a newer local draft from another window',()=>{
 const store=goalStorage();let v!:ReactTestRenderer
 act(()=>{v=create(<ExamAttempt session={exam} storage={store} busy={false} onSave={()=>{}} onSubmit={()=>{}} onReport={()=>{}}/>)})
 const newer=JSON.stringify({expected_revision:0,answer_records:[{question_id:'q1',selected_answers:['B'],duration_ms:0}]})
 store.setItem(`betterlearn:exam-draft:${exam.session_id}`,newer)
 act(()=>v.root.findAllByProps({'aria-pressed':false})[0].props.onClick())
 expect(JSON.stringify(v.toJSON())).toContain('另一窗口');expect(store.getItem(`betterlearn:exam-draft:${exam.session_id}`)).toBe(newer);act(()=>v.unmount())
})
it('uses server status to decide expiry even when the local clock is ahead',()=>{
 let v!:ReactTestRenderer
 act(()=>{v=create(<ExamAttempt session={{...exam,deadline_at:'2000-01-01T00:00:00Z'}} storage={goalStorage()} busy={false} onSave={()=>{}} onSubmit={()=>{}} onReport={()=>{}}/>)})
 expect(JSON.stringify(v.toJSON())).toContain('等待服务端核对');expect(button(v,'保存考试草稿').props.disabled).toBe(false);act(()=>v.unmount())
})
it('compares saved answer facts independently of record and multi-select order',()=>{
 let v!:ReactTestRenderer
 const questions=[exam.questions[0],{...exam.questions[0],id:'q2'}]
 const answer_records=questions.map(q=>({question_id:q.id,selected_answers:['A','B'],duration_ms:100}))
 act(()=>{v=create(<ExamAttempt session={{...exam,questions,answer_records}} storage={goalStorage()} busy={false} onSave={()=>{}} onSubmit={()=>{}} onReport={()=>{}}/>)})
 const status=()=>v.root.findByProps({role:'status'}).children.join('')
 const first=()=>v.root.findByProps({'aria-label':'第 1 题选项'}).findAllByType('button')[0]
 try {
  expect(status()).toContain('与服务端草稿一致')
  act(()=>first().props.onClick());expect(status()).toContain('有本地修改')
  act(()=>first().props.onClick());expect(status()).toContain('与服务端草稿一致')
 } finally {act(()=>v.unmount())}
})
