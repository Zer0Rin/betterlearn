import {useEffect,useState} from 'react'
import type {LearningCourse} from '../../types.js'
import type {GoalCreate} from '../goal-types.js'
import {goalDeadline,goalTimeZone} from '../services/goal-time.js'
export function GoalCreateForm({loadCourses,busy,onCreate,onCancel}:{loadCourses:()=>Promise<LearningCourse[]>;busy:boolean;onCreate(input:Omit<GoalCreate,'request_id'>):void;onCancel():void}) {
  const [courses,setCourses]=useState<LearningCourse[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [revision,setRevision]=useState(0)
  const [courseId,setCourseId]=useState('');const [unitId,setUnitId]=useState('');const [title,setTitle]=useState('');const [percent,setPercent]=useState('90');const [count,setCount]=useState('5');const [due,setDue]=useState('')
  useEffect(()=>{let active=true;setLoading(true);setError('');loadCourses().then(items=>{if(active)setCourses(items.filter(c=>c.status==='active'))}).catch(()=>{if(active)setError('无法读取课程，请重新读取。')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[loadCourses,revision])
  const course=courses.find(c=>c.courseId===courseId)
  function submit(event:React.FormEvent){
    event.preventDefault();if(busy)return
    try{
      if(!course?.units.some(u=>u.unitId===unitId))throw Error('请选择活动课程中的知识点。')
      const name=title.trim();if(!name||[...name].length>120)throw Error('目标名称需要 1～120 个字符。')
      const target=Number(percent),minimum=Number(count)
      if(!Number.isInteger(target)||target<1||target>100||!Number.isInteger(minimum)||minimum<3||minimum>100)throw Error('证据分数须为 1～100，不同题目数须为 3～100 的整数。')
      const deadline=goalDeadline(due);setError('');onCreate({title:name,source:{courseId,unitId},target_percent:target,min_distinct_questions:minimum,due_at:deadline})
    }catch(e){setError(e instanceof Error?e.message:'请检查目标条件。')}
  }
  return <section className="zl-panel zl-goal-create"><h2>创建学习目标</h2><p className="zl-muted">选择已开始学习的课程与知识点。目标条件保存后固定；创建不会出题或发送提醒。</p>
    {error && <p className="zl-error" role="alert">{error}</p>}
    {loading?<p role="status">正在读取课程…</p>:courses.length===0?<p>没有可用课程。请先在学习空间打开学习书并开始课程，再回来创建目标。</p>:null}
    <button className="zl-secondary" disabled={busy||loading} onClick={()=>setRevision(n=>n+1)}>重新读取课程</button>
    <form onSubmit={submit}><fieldset className="zl-goal-form" disabled={busy||loading}>
      <label>课程<select aria-label="目标课程" value={courseId} onChange={e=>{setCourseId(e.target.value);setUnitId('')}}><option value="">请选择课程</option>{courses.map(c=><option key={c.courseId} value={c.courseId}>{c.title}</option>)}</select></label>
      <label>知识点<select aria-label="目标知识点" value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">请选择知识点</option>{course?.units.map(u=><option key={u.unitId} value={u.unitId}>{u.title}</option>)}</select></label>
      <label>目标名称<input aria-label="目标名称" required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>目标证据分数（%）<input aria-label="目标证据分数" type="number" required min={1} max={100} step={1} value={percent} onChange={e=>setPercent(e.target.value)}/></label>
      <label>至少完成不同题目（道）<input aria-label="目标不同题目数" type="number" required min={3} max={100} step={1} value={count} onChange={e=>setCount(e.target.value)}/></label>
      <label>截止时间（{goalTimeZone()}）<input aria-label="目标截止时间" type="datetime-local" required value={due} onChange={e=>setDue(e.target.value)}/></label>
      <p className="zl-muted">同版本的既有记录会计入；重复题目不增加数量。证据分数取最近最多五道不同题目的首次答案，增加数量要求不会扩大评分范围。</p>
      <div className="zl-bank-controls"><button className="zl-primary" type="submit" disabled={!course||!unitId}>保存目标</button><button className="zl-secondary" type="button" onClick={onCancel}>取消</button></div>
    </fieldset></form>
  </section>
}
