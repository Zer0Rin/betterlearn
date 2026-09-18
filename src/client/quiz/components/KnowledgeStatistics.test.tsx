import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {expect,it,vi} from 'vitest'
import {KnowledgeStatistics} from './KnowledgeStatistics.js'
import type {KnowledgeStats,KnowledgeStatsApi} from '../knowledge-stats-types.js'
import {goal} from '../pages/goals.fixture.js'
const stats=(version='a'):KnowledgeStats=>({source:{...goal.source,content_version:version.repeat(64)},answer_count:7,correct_count:4,accuracy:57.14,distinct_question_count:3,repeated_answer_count:4,first_correct_count:0,first_accuracy:0,latest_correct_count:3,latest_accuracy:100,entry_count:3,attempt_count:3,first_answered_at:'2026-09-18 01:00:00',last_answered_at:'2026-09-18 02:00:00'})
const button=(v:ReactTestRenderer,name:string)=>v.root.findAllByType('button').find(b=>b.props.children===name)!
const response=(items:KnowledgeStats[],total=items.length)=>({items,total,page:1,page_size:20})
it('keeps same-title versions separate and renders zero independently from absent evidence',async()=>{
 const api={getKnowledgeStats:vi.fn().mockResolvedValue(response([stats(),stats('b')])),getKnowledgeHistory:vi.fn()} as KnowledgeStatsApi;let v!:ReactTestRenderer
 await act(async()=>{v=create(<KnowledgeStatistics api={api} onAttempt={()=>{}}/>)})
 expect(v.root.findAllByType('article')).toHaveLength(2);expect(v.root.findAllByType('dd').map(x=>x.children.join(''))).toEqual(['0%','100%','3 道','4 次','0%','100%','3 道','4 次'])
 expect(JSON.stringify(v.toJSON())).toContain('不代表课程掌握度');act(()=>v.unmount())
})
it('explains no evidence without showing a fabricated zero',async()=>{
 const api={getKnowledgeStats:vi.fn().mockResolvedValue(response([])),getKnowledgeHistory:vi.fn()} as KnowledgeStatsApi;let v!:ReactTestRenderer
 await act(async()=>{v=create(<KnowledgeStatistics api={api} onAttempt={()=>{}}/>)})
 expect(JSON.stringify(v.toJSON())).toContain('暂无知识点作答统计');expect(v.root.findAllByType('dd')).toHaveLength(0);act(()=>v.unmount())
})
it('queries the exact selected version and opens the exact submitted attempt',async()=>{
 const getKnowledgeHistory=vi.fn().mockResolvedValue({items:[{entry_id:1,quiz_id:'quiz1',attempt_id:'attempt1',selected_answers:['B'],is_correct:false,duration_ms:2100,submitted_at:'2026-09-18 01:00:00'}],total:1,page:1,page_size:20})
 const api={getKnowledgeStats:vi.fn().mockResolvedValue(response([stats(),stats('b')])),getKnowledgeHistory} as KnowledgeStatsApi,onAttempt=vi.fn();let v!:ReactTestRenderer
 await act(async()=>{v=create(<KnowledgeStatistics api={api} onAttempt={onAttempt}/>)})
 await act(async()=>v.root.findAllByType('button').filter(b=>b.props.children==='查看此版本作答')[1].props.onClick())
 expect(getKnowledgeHistory.mock.calls[0][0]).toEqual({knowledge_point_id:goal.source.knowledge_point_id,content_version:'b'.repeat(64),page:1})
 await act(async()=>button(v,'查看这次成绩').props.onClick());expect(onAttempt).toHaveBeenCalledWith('quiz1','attempt1')
 await act(async()=>button(v,'返回知识点统计').props.onClick());expect(v.root.findAllByType('article')).toHaveLength(2);act(()=>v.unmount())
})
it('paginates the list, retries failures and clamps pages after records disappear',async()=>{
 const getKnowledgeStats=vi.fn().mockResolvedValueOnce(response([stats()],21)).mockRejectedValueOnce(Error('服务暂不可用')).mockResolvedValueOnce(response([],1)).mockResolvedValue(response([stats()]))
 let v!:ReactTestRenderer;await act(async()=>{v=create(<KnowledgeStatistics api={{getKnowledgeStats,getKnowledgeHistory:vi.fn()}} onAttempt={()=>{}}/>)})
 await act(async()=>button(v,'统计下一页').props.onClick());expect(v.root.findByProps({role:'alert'}).children.join('')).toContain('服务暂不可用');expect(v.root.findAllByType('article')).toHaveLength(0)
 await act(async()=>button(v,'重新读取知识点统计').props.onClick())
 expect(getKnowledgeStats.mock.calls.map(c=>c[0].page)).toEqual([1,2,2,1]);expect(v.root.findAllByType('article')).toHaveLength(1);act(()=>v.unmount())
})
it('ignores a late history response from a previous version',async()=>{
 let resolveOld!:(value:unknown)=>void
 const getKnowledgeHistory=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolveOld=r})).mockResolvedValue({items:[],total:0,page:1,page_size:20})
 const api={getKnowledgeStats:vi.fn().mockResolvedValue(response([stats(),stats('b')])),getKnowledgeHistory} as KnowledgeStatsApi;let v!:ReactTestRenderer
 await act(async()=>{v=create(<KnowledgeStatistics api={api} onAttempt={()=>{}}/>)})
 await act(async()=>button(v,'查看此版本作答').props.onClick())
 await act(async()=>button(v,'返回知识点统计').props.onClick())
 await act(async()=>v.root.findAllByType('button').filter(b=>b.props.children==='查看此版本作答')[1].props.onClick())
 await act(async()=>resolveOld({items:[{entry_id:9,quiz_id:'old',attempt_id:'old',selected_answers:['X'],is_correct:true,duration_ms:0,submitted_at:'2026-09-18 01:00:00'}],total:1,page:1,page_size:20}))
 expect(JSON.stringify(v.toJSON())).toContain('此版本暂无');expect(v.root.findAllByType('ol')).toHaveLength(0);expect(getKnowledgeHistory.mock.calls[0][1].aborted).toBe(true);act(()=>v.unmount())
})
it('paginates source history without changing version filters',async()=>{
 const getKnowledgeHistory=vi.fn().mockResolvedValue({items:[],total:21,page:1,page_size:20}),api={getKnowledgeStats:vi.fn().mockResolvedValue(response([stats()])),getKnowledgeHistory};let v!:ReactTestRenderer
 await act(async()=>{v=create(<KnowledgeStatistics api={api} onAttempt={()=>{}}/>)})
 await act(async()=>button(v,'查看此版本作答').props.onClick());await act(async()=>button(v,'统计下一页').props.onClick())
 expect(getKnowledgeHistory.mock.calls.at(-1)?.[0]).toEqual({knowledge_point_id:goal.source.knowledge_point_id,content_version:'a'.repeat(64),page:2});act(()=>v.unmount())
})
