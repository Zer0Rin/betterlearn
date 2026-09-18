import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {expect,it,vi} from 'vitest'
import {LearningGoalsPage} from './LearningGoalsPage.js'
import {GoalProgressPanel} from '../components/GoalProgressPanel.js'
import {goalDeadline} from '../services/goal-time.js'
import {goal,goalCourse,goalStorage} from './goals.fixture.js'
const button=(v:ReactTestRenderer,name:string)=>v.root.findAllByType('button').find(b=>b.props.children===name)!
function fixture(){return{listGoals:vi.fn(async()=>({items:[goal],total:1,page:1,page_size:20})),getGoal:vi.fn(async()=>goal),createGoal:vi.fn(async()=>goal),archiveGoal:vi.fn(async()=>({...goal,archived:true,revision:1}))}}
it('reads server progress, distinguishes missing evidence and archives with its revision',async()=>{
 const api=fixture();let v!:ReactTestRenderer
 await act(async()=>{v=create(<LearningGoalsPage api={api} storage={goalStorage()}/>)})
 await act(async()=>button(v,'查看进度').props.onClick())
 expect(JSON.stringify(v.toJSON())).toContain('暂无证据');expect(JSON.stringify(v.toJSON())).toContain('不同题目')
 await act(async()=>button(v,'归档目标').props.onClick())
 expect(api.archiveGoal).toHaveBeenCalledWith(goal.goal_id,{expected_revision:0,archived:true})
 expect(api.getGoal).toHaveBeenCalledTimes(2);act(()=>v.unmount())
})
it('creates from a course unit with an explicit local deadline, locking unknown writes on remount',async()=>{
 const api=fixture();api.createGoal.mockRejectedValue(Error('timeout'));const store=goalStorage();const loadCourses=async()=>[goalCourse];let v!:ReactTestRenderer
 await act(async()=>{v=create(<LearningGoalsPage api={api} storage={store} loadCourses={loadCourses}/>)})
 await act(async()=>button(v,'创建目标').props.onClick())
 function fill(label:string,value:string){act(()=>v.root.findByProps({'aria-label':label}).props.onChange({target:{value}}))}
 fill('目标课程',goalCourse.courseId);fill('目标知识点',goalCourse.units[0].unitId);fill('目标名称','目标');fill('目标截止时间','2035-01-02T12:30')
 await act(async()=>v.root.findByType('form').props.onSubmit({preventDefault(){}}))
 expect(api.createGoal.mock.calls[0]?.[0]).toMatchObject({title:'目标',source:{courseId:goalCourse.courseId,unitId:goalCourse.units[0].unitId},target_percent:90,min_distinct_questions:5,due_at:new Date('2035-01-02T12:30').toISOString()})
 act(()=>v.unmount());await act(async()=>{v=create(<LearningGoalsPage api={api} storage={store} loadCourses={loadCourses}/>)})
 expect(button(v,'创建目标').props.disabled).toBe(true);expect(button(v,'重试原目标请求')).toBeDefined();expect(api.createGoal).toHaveBeenCalledOnce();act(()=>v.unmount())
})
it('does not label a high score as achieved when the server says the count is insufficient',()=>{
 let v!:ReactTestRenderer
 act(()=>{v=create(<GoalProgressPanel goal={{...goal,progress:{...goal.progress,evidence_score:1,distinct_question_count:3,remaining_distinct_questions:2}}} busy={false} onArchive={()=>{}}/>)})
 expect(JSON.stringify(v.toJSON())).toContain('尚未达标');expect(JSON.stringify(v.toJSON())).toContain('100%');act(()=>v.unmount())
 act(()=>{v=create(<GoalProgressPanel goal={{...goal,progress:{...goal.progress,evidence_score:0,deadline_passed:true}}} busy={false} onArchive={()=>{}}/>)})
 expect(JSON.stringify(v.toJSON())).toContain('稍后结算');expect(JSON.stringify(v.toJSON())).toContain('已截止，未达标');expect(JSON.stringify(v.toJSON())).toContain('0%');act(()=>v.unmount())
})
it('resets pagination when filtering and ignores late list responses',async()=>{
 const api=fixture();api.listGoals.mockResolvedValue({...await api.listGoals(),total:21});let v!:ReactTestRenderer
 await act(async()=>{v=create(<LearningGoalsPage api={api} storage={goalStorage()}/>)})
 await act(async()=>button(v,'下一页').props.onClick())
 expect(api.listGoals).toHaveBeenLastCalledWith('active',2,expect.any(AbortSignal))
 let resolve!:(value:any)=>void;api.listGoals.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
 act(()=>button(v,'已归档').props.onClick());await act(async()=>button(v,'全部').props.onClick())
 expect(api.listGoals).toHaveBeenLastCalledWith('all',1,expect.any(AbortSignal))
 await act(async()=>resolve({items:[{...goal,title:'迟到数据'}],total:1,page:1,page_size:20}))
 expect(JSON.stringify(v.toJSON())).not.toContain('迟到数据');act(()=>v.unmount())
})
it('validates complete, existing and future local date/time',()=>{
 expect(()=>goalDeadline('2035-02-30T12:00')).toThrow('不存在')
 expect(()=>goalDeadline('2000-01-01T12:00')).toThrow('晚于')
 expect(()=>goalDeadline('2035-01-01')).toThrow('完整')
})
