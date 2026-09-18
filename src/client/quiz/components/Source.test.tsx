import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {expect,it,vi} from 'vitest'
import {SourcePracticePage} from '../pages/SourcePracticePage.js'
import {SourceBinding} from './SourceBinding.js'
import type {QuizApi} from '../services/contracts.js'
import {goal,goalCourse,goalStorage} from '../pages/goals.fixture.js'
const button=(v:ReactTestRenderer,name:string)=>v.root.findAllByType('button').find(b=>b.props.children===name)!
const select=async(v:ReactTestRenderer)=>{await act(async()=>v.root.findByProps({'aria-label':'来源课程'}).props.onChange({target:{value:goalCourse.courseId}}));await act(async()=>v.root.findByProps({'aria-label':'来源知识点'}).props.onChange({target:{value:goalCourse.units[0].unitId}}))}
it('generates only after explicit submit and opens the saved quiz without creating another task',async()=>{
 const generateFromSource=vi.fn().mockResolvedValue({task_id:'task1'}),getTask=vi.fn().mockResolvedValue({status:'completed',result:{quiz_id:'quiz1'}}),onOpen=vi.fn();const api={generateFromSource,getTask} as unknown as QuizApi;const storage=goalStorage();let view!:ReactTestRenderer
 await act(async()=>{view=create(<SourcePracticePage api={api} storage={storage} loadCourses={async()=>[goalCourse]} onOpen={onOpen}/>)})
 expect(generateFromSource).not.toHaveBeenCalled();await select(view)
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))
 expect(generateFromSource.mock.calls[0][0]).toMatchObject({source:{courseId:goalCourse.courseId,unitId:goalCourse.units[0].unitId},generate_images:false})
 await act(async()=>button(view,'打开这份练习').props.onClick());expect(onOpen).toHaveBeenCalledWith('quiz1');act(()=>view.unmount())
 await act(async()=>{view=create(<SourcePracticePage api={api} storage={storage} onOpen={onOpen}/>)})
 expect(generateFromSource).toHaveBeenCalledTimes(1);expect(button(view,'打开这份练习')).toBeDefined();act(()=>view.unmount())
})
it('shows failed generation without automatically creating a replacement',async()=>{
 const api={generateFromSource:vi.fn().mockResolvedValue({task_id:'task1'}),getTask:vi.fn().mockResolvedValue({status:'failed',error_message:'模型不可用'})} as unknown as QuizApi;let view!:ReactTestRenderer
 await act(async()=>{view=create(<SourcePracticePage api={api} storage={goalStorage()} loadCourses={async()=>[goalCourse]} onOpen={()=>{}}/>)})
 await select(view);await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))
 expect(JSON.stringify(view.toJSON())).toContain('原任务不会自动重试');expect(api.generateFromSource).toHaveBeenCalledTimes(1)
 await act(async()=>button(view,'准备新一组题目').props.onClick());expect(api.generateFromSource).toHaveBeenCalledTimes(1);act(()=>view.unmount())
})
it('reads the actual source revision and binds ID-only selection without changing old scores',async()=>{
 const getBankSource=vi.fn().mockResolvedValueOnce({source:null,source_revision:8}).mockResolvedValue({source:goal.source,source_revision:9}),setBankSource=vi.fn().mockResolvedValue({source:goal.source,source_revision:9}),onChanged=vi.fn()
 const api={getBankSource,setBankSource} as unknown as QuizApi;let view!:ReactTestRenderer
 await act(async()=>{view=create(<SourceBinding api={api} storage={goalStorage()} id={4} loadCourses={async()=>[goalCourse]} onChanged={onChanged}/>)})
 await select(view);await act(async()=>button(view,'保存来源绑定').props.onClick())
 expect(setBankSource).toHaveBeenCalledWith(4,{expected_revision:8,source:{courseId:goalCourse.courseId,unitId:goalCourse.units[0].unitId}})
 expect(getBankSource).toHaveBeenCalledTimes(2);expect(onChanged).toHaveBeenCalledTimes(1);expect(JSON.stringify(view.toJSON())).toContain('不会重算旧成绩');act(()=>view.unmount())
})
