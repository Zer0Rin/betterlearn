import {useEffect,useMemo,useState,useSyncExternalStore} from 'react'
import type {LearningCourse} from '../../types.js'
import type {QuizApi} from '../services/contracts.js'
import type {PracticeStorage} from '../services/practice.js'
import type {SourceMapping,SourceSelection} from '../source-types.js'
import {getSourceOperations} from '../services/source-operations.js'
import {SourcePicker} from './SourcePicker.js'
export function SourceBinding({api,storage,id,loadCourses,onChanged}:{api:QuizApi;storage:PracticeStorage;id:number;loadCourses?:()=>Promise<LearningCourse[]>;onChanged():void}){
 const op=useMemo(()=>getSourceOperations(api,storage,id),[api,storage,id]);const state=useSyncExternalStore(op.subscribe,()=>op.state)
 const [mapping,setMapping]=useState<SourceMapping>(),[source,setSource]=useState<SourceSelection|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{let active=true;setLoading(true);setMapping(undefined);setError('');api.getBankSource(id).then(value=>{if(active)setMapping(value)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[api,id,revision,state.completed])
 useEffect(()=>{if(state.completed)onChanged()},[state.completed])
 const disabled=loading||state.busy||!!state.pending||state.rejected||!mapping
 function write(selection:SourceSelection|null){if(disabled||!mapping)return;void op.run({kind:'bind',id,input:{expected_revision:mapping.source_revision,source:selection}})}
 return <section className="zl-panel zl-goal-create"><h2>题目来源</h2><p>将题目关联到学习课程中的知识点，供目标统计和组卷使用。绑定只影响之后交卷的记录，不会重算旧成绩，也不代表已审核覆盖。</p>
 {mapping?.source?<><strong>{mapping.source.title}</strong><p>{mapping.source.statement}</p><details><summary>查看来源版本</summary><code>{mapping.source.content_version}</code></details></>:mapping&&<p>尚未绑定知识点。</p>}
 {(error||state.error)&&<p role="alert" className="zl-error">{error||state.error}</p>}
 {state.pending&&!state.rejected&&<p role="status">正在核对上次来源操作；恢复时沿用原选择和版本。</p>}
 {state.pending&&!state.rejected&&<button className="zl-primary" disabled={state.busy} onClick={()=>void op.retry()}>重试原绑定请求</button>}
 {state.rejected&&<button className="zl-secondary" onClick={()=>{op.clearFinished();setRevision(n=>n+1)}}>清除旧请求并重读来源</button>}
 <button className="zl-secondary" disabled={state.busy||loading||!!state.pending} onClick={()=>setRevision(n=>n+1)}>重新读取来源</button>
 {loadCourses?<SourcePicker loadCourses={loadCourses} disabled={disabled} value={source} onChange={setSource}/>:<p>当前入口未提供课程选择。</p>}
 <div className="zl-bank-controls"><button className="zl-primary" disabled={disabled||!source?.unitId} onClick={()=>write(source)}>保存来源绑定</button>{mapping?.source&&<button className="zl-secondary" disabled={disabled} onClick={()=>{if(window.confirm('解除后，今后的作答不再计入此知识点；已有成绩保留原来源。继续吗？'))write(null)}}>解除来源绑定</button>}</div>
 </section>
}
