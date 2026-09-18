import {vi} from 'vitest'
import type {BankEntry} from '../bank-types.js'
import type {QuizApi} from '../services/contracts.js'
export const bankEntry=(extra:Partial<BankEntry>={}):BankEntry=>({id:1,quiz_id:'quiz1',question_id:'q1',question_hash:'v1',title:'原练习',question:{id:'q1',stem:'光合作用是什么？',type:'single',options:[{key:'A',text:'转化光能'},{key:'B',text:'产生声能'}],answer:['A'],explanation:'将光能转为化学能',knowledge_point:'光合作用',difficulty:'easy'},bookmarked:false,is_correct:null,latest_attempt_id:null,attempt_count:0,wrong_count:0,created_at:'2026-09-18 00:00:00',last_answered_at:null,categories:[],...extra})
export function bankFixture(){
 const mocks={
 getBankEntries:vi.fn(async()=>({items:[bankEntry()],total:1,page:1,page_size:20})),
 getBankEntry:vi.fn(async()=>bankEntry()),getBankHistory:vi.fn(async()=>({items:[],total:0,page:1,page_size:20})),
 getBankStats:vi.fn(async()=>({total:1,wrong:0,ever_wrong:0,bookmarked:0,uncategorized:1})),
 getBankCategories:vi.fn(async()=>({items:[{id:2,name:'概念',entry_count:0}]})),
 setBankBookmark:vi.fn(async()=>({id:1,bookmarked:true})),setBankCategory:vi.fn(async()=>({entry_id:1,category_id:2,linked:true})),
 createBankCategory:vi.fn(async()=>({id:3,name:'过程'})),renameBankCategory:vi.fn(async()=>({id:2,name:'过程'})),deleteBankCategory:vi.fn(async()=>({id:2})),
 }
 return {api:mocks as unknown as QuizApi,mocks}
}
