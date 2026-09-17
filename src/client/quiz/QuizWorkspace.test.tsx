import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { QuizWorkspace } from './QuizWorkspace.js'
import type { QuizApi } from './services/contracts.js'
const values = new Map<string,string>()
const storage = { getItem: (k:string)=> values.get(k) ?? null, setItem: (k:string,v:string)=>{values.set(k,v)} }
afterEach(()=>{ vi.unstubAllGlobals(); values.clear() })
it('opens knowledge internally without changing host hash and can return to BetterLearn', async()=>{
  const location = { hash: '#host-conversation' }
  vi.stubGlobal('window',{ location, addEventListener:vi.fn(), removeEventListener:vi.fn(), scrollTo:vi.fn() })
  vi.stubGlobal('sessionStorage',storage)
  const api = { connect:async()=>({user:{}}), getProfile:async()=>({nickname:'学习者'}), getDocuments:async()=>({items:[]}), getHistory:async()=>({items:[]}) } as unknown as QuizApi
  const onExit = vi.fn()
  let renderer!:ReactTestRenderer
  await act(async()=>{renderer=create(<QuizWorkspace api={api} storage={storage} onExit={onExit}/>)})
  const link=renderer.root.findAllByType('a').find(a=>a.props.children?.[1]?.props?.children==='我的知识库')!
  await act(async()=>link.props.onClick({preventDefault:vi.fn()}))
  expect(renderer.root.findAllByType('input').some(i=>i.props.type==='file')).toBe(true)
  expect(location.hash).toBe('#host-conversation')
  act(()=>renderer.root.findAllByType('button').find(b=>b.props.children==='返回 BetterLearn')!.props.onClick())
  expect(onExit).toHaveBeenCalledOnce()
  expect(values.has('betterlearn:quiz:practice')).toBe(true)
  act(()=>renderer.unmount())
})

it('resumes a persisted task, recovers a polling failure, and saves completed quiz progress', async()=>{
  values.set('betterlearn:quiz:practice', JSON.stringify({ records:[],index:0,taskId:'task-42' }))
  const quiz = { quiz_id:'quiz42',title:'Recovered',summary:'',questions:[{id:'q1',stem:'Question',type:'single',options:[{key:'A',text:'Answer'}],answer:['A'],explanation:'Because',knowledge_point:'Point',difficulty:'easy'}] }
  const getTask = vi.fn().mockRejectedValueOnce(new Error('暂时断开')).mockResolvedValueOnce({status:'completed',result:quiz})
  const api = { connect:async()=>({user:{}}),getProfile:async()=>({nickname:'学习者'}),getTask } as unknown as QuizApi
  let renderer!:ReactTestRenderer
  await act(async()=>{renderer=create(<QuizWorkspace api={api} storage={storage} initialRoute='/quiz' onExit={()=>{}}/>)})
  expect(renderer.root.findByProps({role:'alert'}).children).toContain('暂时断开')
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.props.children==='继续查询')!.props.onClick())
  expect(getTask).toHaveBeenCalledTimes(2)
  expect(getTask.mock.calls[0][0]).toBe('task-42')
  expect(renderer.root.findAllByType('button').some(b=>b.props['aria-pressed']===false)).toBe(true)
  expect(JSON.parse(values.get('betterlearn:quiz:practice')!).quiz.quiz_id).toBe('quiz42')
  act(()=>renderer.unmount())
})

it('retains a pending accepted generation across exit and reopening',async()=>{
  const { QuizSetup } = await import('./components/QuizSetup.js')
  let resolveTask!:(value:{task_id:string})=>void
  const generateQuiz=vi.fn(()=>new Promise<{task_id:string}>(resolve=>{resolveTask=resolve}))
  const getTask=vi.fn(async()=>({status:'running'}))
  const api={connect:async()=>({user:{}}),getProfile:async()=>({nickname:'学习者'}),getDocuments:async()=>({items:[]}),getHistory:async()=>({items:[]}),generateQuiz,getTask} as unknown as QuizApi
  let first!:ReactTestRenderer
  await act(async()=>{first=create(<QuizWorkspace api={api} storage={storage} onExit={()=>{}}/>)})
  act(()=>first.root.findByType(QuizSetup).props.onGenerate({source:{kind:'topic',text:'测试'},questionCount:3,difficulty:'mixed',generateImages:false}))
  act(()=>first.unmount())
  let second!:ReactTestRenderer
  await act(async()=>{second=create(<QuizWorkspace api={api} storage={storage} onExit={()=>{}}/>)})
  expect(second.root.findByType(QuizSetup).props.busy).toBe(true)
  await act(async()=>resolveTask({task_id:'task_later'}))
  expect(JSON.parse(values.get('betterlearn:quiz:practice')!).taskId).toBe('task_later')
  expect(getTask).toHaveBeenCalledWith('task_later',expect.any(AbortSignal))
  expect(generateQuiz).toHaveBeenCalledTimes(1)
  act(()=>second.unmount())
})

it('continues accepted generation when browser persistence is unavailable',async()=>{
  const { QuizSetup } = await import('./components/QuizSetup.js')
  const blockedStorage={getItem:()=>null,setItem:()=>{throw new Error('Quota exceeded')}}
  const getTask=vi.fn(async()=>({status:'running'}))
  const api={connect:async()=>({user:{}}),getProfile:async()=>({nickname:'学习者'}),getDocuments:async()=>({items:[]}),getHistory:async()=>({items:[]}),generateQuiz:async()=>({task_id:'task_quota'}),getTask} as unknown as QuizApi
  let renderer!:ReactTestRenderer
  await act(async()=>{renderer=create(<QuizWorkspace api={api} storage={blockedStorage} onExit={()=>{}}/>)})
  await act(async()=>renderer.root.findByType(QuizSetup).props.onGenerate({source:{kind:'topic',text:'测试'},questionCount:3,difficulty:'mixed',generateImages:false}))
  expect(getTask).toHaveBeenCalledWith('task_quota',expect.any(AbortSignal))
  act(()=>renderer.unmount())
  getTask.mockClear()
  await act(async()=>{renderer=create(<QuizWorkspace api={api} storage={blockedStorage} onExit={()=>{}}/>)})
  expect(getTask).toHaveBeenCalledWith('task_quota',expect.any(AbortSignal))
  act(()=>renderer.unmount())
})

it('uses the accepted task when storage recovers after the panel closes',async()=>{
 const {QuizSetup}=await import('./components/QuizSetup.js')
 let writable=false;let value:string|null=null
 const recoveringStorage={getItem:()=>value,setItem:(_key:string,next:string)=>{if(!writable)throw Error('storage blocked');value=next}}
 let resolveTask!:(value:{task_id:string})=>void
 const getTask=vi.fn(async()=>({status:'running'}))
 const api={connect:async()=>({user:{}}),getProfile:async()=>({nickname:'学习者'}),getDocuments:async()=>({items:[]}),getHistory:async()=>({items:[]}),generateQuiz:()=>new Promise(resolve=>{resolveTask=resolve}),getTask} as unknown as QuizApi
 let renderer!:ReactTestRenderer
 await act(async()=>{renderer=create(<QuizWorkspace api={api} storage={recoveringStorage} onExit={()=>{}}/>)})
 act(()=>renderer.root.findByType(QuizSetup).props.onGenerate({source:{kind:'topic',text:'测试'},questionCount:3,difficulty:'mixed',generateImages:false}))
 act(()=>renderer.unmount());writable=true
 await act(async()=>resolveTask({task_id:'task_recovered_storage'}))
 await act(async()=>{renderer=create(<QuizWorkspace api={api} storage={recoveringStorage} onExit={()=>{}}/>)})
 expect(getTask).toHaveBeenCalledWith('task_recovered_storage',expect.any(AbortSignal))
 act(()=>renderer.unmount())
})
