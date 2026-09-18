import { vi } from 'vitest'
import type { QuizApi } from './contracts.js'
import type { AttemptAnswers, PracticeAttempt } from '../types.js'
export const attempt = (extra: Partial<PracticeAttempt> = {}): PracticeAttempt => ({
  attempt_id:'attempt1',quiz_id:'quiz1',title:'练习',questions:[{id:'q1',type:'single',stem:'题目',options:[{key:'A',text:'甲'},{key:'B',text:'乙'}],answer:['A'],explanation:'解析',knowledge_point:'知识',difficulty:'easy'}],
  status:'draft',revision:0,created_at:'2026-09-18 01:00:00',submitted_at:null,total_questions:null,correct_count:null,accuracy:null,xp_gain:0,
  answer_records:[],report_status:'not_requested',report:null,report_error:null,...extra,
})
export const answer = {question_id:'q1',selected_answers:['A'],duration_ms:100}
export function fixture() {
  const values = new Map<string,string>()
  const storage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}
  let remote = attempt()
  const api = {
    createAttempt:vi.fn(async()=>remote), getAttempt:vi.fn(async()=>remote), listAttempts:vi.fn(async()=>({items:[]})),
    saveAttempt:vi.fn(async(_id:string,input:AttemptAnswers)=> { remote=attempt({revision:remote.revision+1,answer_records:input.answer_records.map(a=>({...a,is_correct:null}))});return remote }),
    submitAttempt:vi.fn(async(_id:string,input:AttemptAnswers)=>{remote=attempt({status:'submitted',revision:remote.revision+1,answer_records:input.answer_records.map(a=>({...a,is_correct:true})),accuracy:100,correct_count:1,total_questions:1,xp_gain:0,submitted_at:'2026-09-18 01:02:00'});return remote}),
    generateAttemptReport:vi.fn(async()=>{throw Error('模型不可用')}),
  }
  return {api:api as unknown as QuizApi,mocks:api,storage,remote:(value:PracticeAttempt)=>{remote=value}}
}
