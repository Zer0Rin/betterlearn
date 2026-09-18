import {useEffect,useMemo,useState,useSyncExternalStore} from 'react'
import type {LearningCourse} from '../../types.js'
import type {QuizApi} from '../services/contracts.js'
import type {PracticeStorage} from '../services/practice.js'
import type {SourceGeneration,SourceSelection} from '../source-types.js'
import type {QuizTaskStatus} from '../types.js'
import {getSourceOperations} from '../services/source-operations.js'
import {SourcePicker} from '../components/SourcePicker.js'
export function SourcePracticePage({api,storage,loadCourses,onOpen}:{api:QuizApi;storage:PracticeStorage;loadCourses?:()=>Promise<LearningCourse[]>;onOpen(id:string):void}){
 const op=useMemo(()=>getSourceOperations(api,storage),[api,storage]);const state=useSyncExternalStore(op.subscribe,()=>op.state)
 const [source,setSource]=useState<SourceSelection|null>(null),[count,setCount]=useState(5),[difficulty,setDifficulty]=useState<SourceGeneration['difficulty']>('mixed'),[input,setInput]=useState('围绕所选知识点出题'),[images,setImages]=useState(false)
 const [task,setTask]=useState<QuizTaskStatus>(),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 const pending=state.pending?.kind==='generate'?state.pending:undefined,taskId=pending?.taskId
 useEffect(()=>{
  setTask(undefined);setError('');if(!taskId)return
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;const started=Date.now()
  async function poll(){try{
   const result=await api.getTask(taskId!,controller.signal);if(controller.signal.aborted)return;setTask(result)
   if(result.status==='completed'||result.status==='failed')return
   if(Date.now()-started>=15*60*1000){setError('等待时间较长，请继续查询。');return}
   timer=setTimeout(poll,2500)
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'无法查询任务')}}
  void poll();return()=>{controller.abort();clearTimeout(timer)}
 },[api,taskId,revision])
 const locked=state.busy||!!state.pending||state.rejected
 function generate(event:React.FormEvent){event.preventDefault();if(locked||!source?.unitId)return;setError('');void op.run({kind:'generate',input:{request_id:crypto.randomUUID(),source,user_input:input.trim(),question_count:count,difficulty,generate_images:images}})}
 return <><header className="zl-heading"><div className="zl-eyebrow">知识点练习</div><h1>按知识点出题</h1><p>选择学习课程中的知识点，生成题目并自动关联来源，供学习目标和模拟考试使用。</p></header>
 {(state.error||error)&&<p className="zl-error" role="alert">{state.error||error}</p>}
 {state.rejected&&<button className="zl-secondary" onClick={()=>op.clearFinished()}>清除被拒绝的请求</button>}
 {pending&&<section className="zl-panel zl-goal-create"><h2>本次生成</h2><p>{pending.input.question_count} 道题 · {pending.input.user_input}</p>
 {!taskId?<><p>请求结果尚未确认。刷新后仍可重试同一请求。</p><button className="zl-primary" disabled={state.busy||state.rejected} onClick={()=>void op.retry()}>重试原出题请求</button></>:<>
 <p role="status">{task?.status==='completed'?'题目已生成并保存到题库。':task?.status==='failed'?'生成失败。原任务不会自动重试。':'正在生成题目，刷新后可继续查询。'}</p>
 {task?.error_message&&<p className="zl-error">{task.error_message}</p>}
 {error&&<button className="zl-secondary" onClick={()=>setRevision(n=>n+1)}>继续查询生成结果</button>}
 {task?.status==='completed'&&task.result&&<><p>来源表示出题意图。请检查题目与知识点是否相符；模拟考试仍需覆盖审核。</p><button className="zl-primary" onClick={()=>onOpen(task.result!.quiz_id)}>打开这份练习</button></>}
 {(task?.status==='completed'||task?.status==='failed')&&<button className="zl-secondary" onClick={()=>{op.clearFinished();setTask(undefined)}}>准备新一组题目</button>}
 </>}
 </section>}
 {!pending&&!state.rejected&&<form className="zl-panel zl-goal-create zl-source-form" onSubmit={generate}>
 {loadCourses?<SourcePicker loadCourses={loadCourses} disabled={locked} value={source} onChange={setSource}/>:<p>当前入口未提供课程选择。</p>}
 <fieldset className="zl-goal-form" disabled={locked}><legend>出题条件</legend>
 <label>出题要求<textarea aria-label="知识点出题要求" required maxLength={2000} value={input} onChange={e=>setInput(e.target.value)}/></label>
 <label>题目数量<input aria-label="知识点题目数量" type="number" required min={3} max={10} step={1} value={count} onChange={e=>setCount(Number(e.target.value))}/></label>
 <label>难度<select aria-label="知识点题目难度" value={difficulty} onChange={e=>setDifficulty(e.target.value as SourceGeneration['difficulty'])}><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option><option value="mixed">混合</option></select></label>
 <label className="zl-source-image-choice"><input type="checkbox" checked={images} onChange={e=>setImages(e.target.checked)}/>生成题目配图</label>
 <p className="zl-muted">点击后调用已配置的模型，可能产生费用。不会自动重试失败的生成任务。</p>
 <button className="zl-primary" type="submit" disabled={!source?.unitId||!input.trim()||!Number.isInteger(count)||count<3||count>10}>生成知识点练习</button>
 </fieldset></form>}</>
}
