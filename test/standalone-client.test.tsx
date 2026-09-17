import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, test, vi } from 'vitest'
import { StandaloneApp } from '../src/standalone/App.js'
import { Settings } from '../src/standalone/Settings.js'

const storage = { length: 0, clear() {}, getItem: () => null, key: () => null, removeItem() {}, setItem() {} }
const settings = { text: {baseUrl:'http://localhost/v1',model:'fake',apiKeySet:true}, embedding:{baseUrl:'',model:'',apiKeySet:false},image:{baseUrl:'',model:'',apiKeySet:false},search:{enabled:false,apiKeySet:false} }
let root: ReactTestRenderer
const response = (data: unknown) => new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json'}})
afterEach(() => { if (root) act(() => root.unmount()) })
function fetcher(model: unknown = {provider:'local',model:'fake'}) {
  return vi.fn(async (url: string | URL | Request) => response(String(url) === '/api/model' ? model : String(url) === '/api/library' ? {books:[]} : settings)) as unknown as typeof fetch
}
function button(label:string) { return root.root.findAllByType('button').find(b => b.props['aria-label'] === label || b.children.join('') === label)! }
test('opens a standalone workspace and excludes DSH import sources', async () => {
  await act(async () => { root = create(<StandaloneApp storage={storage} fetcher={fetcher()}/>) })
  act(() => button('知识提取').props.onClick())
  expect(root.root.findByProps({'data-testid':'nobei-client-view'})).toBeTruthy()
  expect(root.root.findAllByProps({'aria-label':'从 DSH 对话提取'})).toHaveLength(0)
  expect(root.root.findAllByProps({'aria-label':'上传文件'})).toHaveLength(1)
  act(() => button('学习空间').props.onClick())
  expect(JSON.stringify(root.toJSON())).toContain('学习书')
})
test('offers settings when no model is configured while keeping navigation available', async () => {
  await act(async () => { root = create(<StandaloneApp storage={storage} fetcher={fetcher(null)}/>) })
  await act(async () => button('配置文本模型').props.onClick())
  expect(root.root.findByProps({'aria-label':'模型与能力设置'})).toBeTruthy()
  act(() => button('学习空间').props.onClick())
  expect(JSON.stringify(root.toJSON())).toContain('学习书')
})
test('settings preserve existing secrets unless changed and support explicit clearing', async () => {
  const request = vi.fn(async (_url: unknown, _init?: RequestInit) => response(settings))
  const saved = vi.fn()
  await act(async () => { root = create(<Settings fetcher={request as typeof fetch} onSaved={saved}/>) })
  const form = root.root.findByType('form')
  await act(async () => form.props.onSubmit({preventDefault(){}}))
  expect(JSON.parse(String(request.mock.calls.at(-1)![1]!.body)).text).not.toHaveProperty('apiKey')
  act(() => button('清除文本模型密钥').props.onClick())
  await act(async () => form.props.onSubmit({preventDefault(){}}))
  expect(JSON.parse(String(request.mock.calls.at(-1)![1]!.body)).text.apiKey).toBe('')
  expect(saved).toHaveBeenCalledTimes(2)
})

test('blocks book writes after a library read failure and allows loading recovery', async () => {
  let fail=true
  const request=vi.fn(async (url: unknown)=>String(url)==='/api/library' ? fail ? new Response('',{status:500}) : response({books:[]}) : response({provider:'local',model:'fake'}))
  await act(async()=>{root=create(<StandaloneApp storage={storage} fetcher={request as typeof fetch}/>)})
  expect(JSON.stringify(root.toJSON())).toContain('学习书加载失败')
  expect(root.root.findAllByProps({'data-testid':'learning-bookshelf'})).toHaveLength(0)
  fail=false
  await act(async()=>button('重新加载学习书').props.onClick())
  expect(root.root.findByProps({'data-testid':'learning-bookshelf'})).toBeTruthy()
})

test('orders full library snapshots and retries the latest books after a failed save', async () => {
  const {NobeiWorkspace}=await import('../src/client/NobeiClientView.js')
  const {LearningBookComposer}=await import('../src/client/components/LearningLibrary.js')
  let release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve})
  const writes: Array<{books:unknown[]}>=[]
  let fail=true
  const request=vi.fn(async(url:unknown,init?:RequestInit)=>{
    if (init?.method==='PUT') {
      writes.push(JSON.parse(String(init.body)))
      if(writes.length===1) await gate
      return fail ? new Response('',{status:500}) : response(writes.at(-1))
    }
    return response(String(url)==='/api/library'?{books:[]}:{provider:'local',model:'fake'})
  })
  await act(async()=>{root=create(<StandaloneApp storage={storage} fetcher={request as typeof fetch}/>)})
  const point={knowledgePointId:'kp_1',documentId:'doc_1',type:'concept',title:'证据',statement:'知识需要证据。',evidence:[{seq:0,quote:'知识需要证据。',textStart:0,textEnd:7,contextBefore:'',contextAfter:''}]}
  for(const title of ['第一本','第二本']) {
    act(()=>root.root.findByType(NobeiWorkspace).props.onOrganizeLearningBook([point],'知识需要证据。'))
    await act(async()=>root.root.findByType(LearningBookComposer).props.onCreate({title,points:[point]}))
  }
  expect(writes).toHaveLength(1)
  await act(async()=>release())
  expect(writes.map(write=>write.books.length)).toEqual([1,2])
  expect(JSON.stringify(root.toJSON())).toContain('学习书尚未保存到本机')
  fail=false
  await act(async()=>button('重试保存学习书').props.onClick())
  expect(writes.at(-1)!.books).toHaveLength(2)
  expect(JSON.stringify(root.toJSON())).not.toContain('学习书尚未保存到本机')
})

test('refreshes the model snapshot after saving settings without starting extraction', async () => {
  let configured=false
  const request=vi.fn(async(url:unknown,init?:RequestInit)=>{
    if(String(url)==='/api/model') return response(configured?{provider:'local:new-connection',model:'next'}:null)
    if(String(url)==='/api/library') return response({books:[]})
    if(init?.method==='PUT') configured=true
    return response(settings)
  })
  await act(async()=>{root=create(<StandaloneApp storage={storage} fetcher={request as typeof fetch}/>)})
  await act(async()=>button('配置文本模型').props.onClick())
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}))
  expect(root.root.findAllByType('button').find(b=>b.children.join('')==='配置文本模型')).toBeUndefined()
  expect(JSON.stringify(root.toJSON())).toContain('next')
  expect(request.mock.calls.every(([url])=>String(url).startsWith('/api/'))).toBe(true)
})
