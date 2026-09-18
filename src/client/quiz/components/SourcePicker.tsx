import {useEffect,useState} from 'react'
import type {LearningCourse} from '../../types.js'
import type {SourceSelection} from '../source-types.js'
export function SourcePicker({loadCourses,disabled,value,onChange}:{loadCourses:()=>Promise<LearningCourse[]>;disabled:boolean;value:SourceSelection|null;onChange(value:SourceSelection|null):void}){
 const [courses,setCourses]=useState<LearningCourse[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{let active=true;setLoading(true);setError('');loadCourses().then(items=>{if(active)setCourses(items.filter(c=>c.status==='active'))}).catch(()=>{if(active){setCourses([]);setError('无法读取课程，请重试。')}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[loadCourses,revision])
 const course=courses.find(c=>c.courseId===value?.courseId),unit=course?.units.find(u=>u.unitId===value?.unitId)
 return <fieldset className="zl-goal-form" disabled={disabled||loading}><legend>知识点来源</legend>
 {error&&<p className="zl-error" role="alert">{error}</p>}{loading?<p role="status">正在读取课程…</p>:!courses.length&&<p>没有可用课程。请先在学习空间打开学习书并开始课程。</p>}
 <label>课程<select aria-label="来源课程" value={value?.courseId??''} onChange={e=>onChange({courseId:e.target.value,unitId:''})}><option value="">请选择课程</option>{courses.map(c=><option key={c.courseId} value={c.courseId}>{c.title}</option>)}</select></label>
 <label>知识点<select aria-label="来源知识点" value={value?.unitId??''} onChange={e=>onChange(course?{courseId:course.courseId,unitId:e.target.value}:null)}><option value="">请选择知识点</option>{course?.units.map(u=><option key={u.unitId} value={u.unitId}>{u.title}</option>)}</select></label>
 {unit&&<p>{unit.objective}</p>}<button type="button" className="zl-secondary" onClick={()=>{onChange(null);setRevision(n=>n+1)}}>重新读取课程</button>
 </fieldset>
}
