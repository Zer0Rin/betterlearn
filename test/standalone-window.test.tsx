import { useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, test, vi } from 'vitest'
import { WorkbenchWindow } from '../src/standalone/WorkbenchWindow.js'
import { readWindowSize, WINDOW_SIZE_KEY } from '../src/standalone/window-state.js'

function memory(initial?: string): Storage {
  const data = new Map(initial ? [[WINDOW_SIZE_KEY, initial]] : [])
  return { get length(){return data.size}, clear(){data.clear()}, key:i=>[...data.keys()][i]??null,
    getItem:k=>data.get(k)??null, setItem:(k,v)=>{data.set(k,v)}, removeItem:k=>{data.delete(k)} }
}
let root: ReactTestRenderer | undefined
function button(label:string) {return root!.root.findByProps({'aria-label':label})}
afterEach(()=>{if(root) act(()=>root!.unmount());root=undefined;vi.unstubAllGlobals()})
test('collapse preserves editable child state and does not unmount it',()=>{
  function Draft(){const [value,setValue]=useState('');return <input value={value} onChange={(e:any)=>setValue(e.target.value)}/>}
  act(()=>{root=create(<WorkbenchWindow storage={memory()} title="学习空间"><Draft/></WorkbenchWindow>)})
  act(()=>root!.root.findByType('input').props.onChange({target:{value:'尚未保存'}}))
  act(()=>button('收起工作台').props.onClick())
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props.hidden).toBe(true)
  expect(root!.root.findByType('input').props.value).toBe('尚未保存')
  act(()=>button('打开 BetterLearn').props.onClick())
  expect(root!.root.findByType('input').props.value).toBe('尚未保存')
})
test('keyboard resize persists manual size and maximize restores it',()=>{
  const storage=memory(JSON.stringify({version:1,width:800,height:600}))
  act(()=>{root=create(<WorkbenchWindow storage={storage} title="学习空间">内容</WorkbenchWindow>)})
  const key={key:'ArrowLeft',shiftKey:false,preventDefault:vi.fn()}
  act(()=>button('调整工作台宽度').props.onKeyDown(key))
  expect(JSON.parse(storage.getItem(WINDOW_SIZE_KEY)!)).toEqual({version:1,width:820,height:600})
  act(()=>button('最大化工作台').props.onClick())
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props['data-maximized']).toBe(true)
  act(()=>button('还原工作台').props.onClick())
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props.style.width).toBe(820)
})
test('invalid and blocked storage use a safe default',()=>{
  for(const raw of ['bad','null','{}','{"version":1,"width":-2,"height":500}','{"version":2,"width":800,"height":600}']) {
    expect(readWindowSize(memory(raw))).toEqual({width:1080,height:780})
  }
  expect(readWindowSize({getItem(){throw Error('blocked')}} as unknown as Storage)).toEqual({width:1080,height:780})
})
test('viewport shrink clamps visible size without overwriting saved desktop preference',()=>{
  const events=new EventTarget()
  const viewport={innerWidth:1280,innerHeight:900,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)}
  vi.stubGlobal('window',viewport)
  const storage=memory(JSON.stringify({version:1,width:900,height:700}))
  act(()=>{root=create(<WorkbenchWindow storage={storage} title="学习空间">内容</WorkbenchWindow>)})
  viewport.innerWidth=375;viewport.innerHeight=667
  act(()=>events.dispatchEvent(new Event('resize')))
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props.style.width).toBe(343)
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props.style.height).toBe(635)
  expect(JSON.parse(storage.getItem(WINDOW_SIZE_KEY)!)).toEqual({version:1,width:900,height:700})
})
test('pointer resize ignores other pointers, finishes on blur and tolerates blocked writes',()=>{
  const events=new EventTarget()
  vi.stubGlobal('window',{innerWidth:1280,innerHeight:900,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)})
  const storage=memory(JSON.stringify({version:1,width:800,height:600}))
  storage.setItem=()=>{throw Error('blocked')}
  act(()=>{root=create(<WorkbenchWindow storage={storage} title="学习空间">内容</WorkbenchWindow>)})
  act(()=>button('调整工作台大小').props.onPointerDown({button:0,pointerId:1,clientX:100,clientY:100,preventDefault(){},currentTarget:{focus(){},setPointerCapture(){}}}))
  const move=(id:number,x:number,y:number)=>Object.assign(new Event('pointermove'),{pointerId:id,clientX:x,clientY:y})
  act(()=>events.dispatchEvent(move(2,50,150)))
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props.style.width).toBe(800)
  act(()=>events.dispatchEvent(move(1,50,150)))
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props.style).toEqual({width:850,height:650})
  act(()=>events.dispatchEvent(new Event('blur')))
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props['data-resizing']).toBe(false)
  act(()=>events.dispatchEvent(move(1,0,200)))
  expect(root!.root.findByProps({'data-testid':'workbench-window'}).props.style.width).toBe(850)
})
