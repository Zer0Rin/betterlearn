import { GlassBackdrop, glassVariables } from './GlassBackdrop.js'
import { DEFAULT_GLASS_FROST } from './glass-preference.js'
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react'
import { BookOpen, Maximize2, Minimize2, Minus, MoveDiagonal2 } from 'lucide-react'
import { clampWorkbenchSize, resizeFromPointer, type ResizeAxis, type WorkbenchSize } from '../client/workbench-size.js'
import { readWindowSize, writeWindowSize } from './window-state.js'

function viewport() {
  return typeof window === 'undefined' ? { width:1280, height:900 }
    : { width:window.innerWidth, height:window.innerHeight }
}
interface Gesture { axis: ResizeAxis; pointerId:number; x:number; y:number; size:WorkbenchSize }

/** The host owns content and services; this shell owns only its presentation. */
export function WorkbenchWindow({ children, storage, title, frost = DEFAULT_GLASS_FROST }: {children:ReactNode; storage:Storage; title:string; frost?:number}) {
  const [bounds,setBounds] = useState(viewport)
  const [manual,setManual] = useState(()=>readWindowSize(storage))
  const [collapsed,setCollapsed] = useState(false)
  const [maximized,setMaximized] = useState(false)
  const [resizing,setResizing] = useState(false)
  const gesture = useRef<Gesture>()
  const latestSize = useRef(manual)
  const launcher = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement>()
  const focusPending = useRef(false)
  const mobile = bounds.width <= 560
  const size = maximized || mobile
    ? {width:Math.max(0,bounds.width-32),height:Math.max(0,bounds.height-32)}
    : clampWorkbenchSize(manual,bounds)

  useEffect(()=>{
    if(typeof window === 'undefined') return
    const update=()=>setBounds(viewport())
    window.addEventListener('resize',update)
    return ()=>window.removeEventListener('resize',update)
  },[])
  useEffect(()=>{
    if(!focusPending.current) return
    focusPending.current=false
    if(collapsed) launcher.current?.focus()
    else if(previousFocus.current?.isConnected && panel.current?.contains(previousFocus.current)
      && previousFocus.current.getClientRects().length) previousFocus.current.focus()
    else panel.current?.focus()
  },[collapsed])
  useEffect(()=>{
    if(!resizing || typeof window === 'undefined') return
    const move=(event:PointerEvent)=>{
      const current=gesture.current
      if(!current || current.pointerId!==event.pointerId) return
      const next=resizeFromPointer(current.size,current.axis,event.clientX-current.x,event.clientY-current.y,bounds)
      latestSize.current=next;setManual(next)
    }
    const finish=(event?:PointerEvent)=>{
      if(event && gesture.current?.pointerId!==event.pointerId) return
      writeWindowSize(storage,latestSize.current)
      gesture.current=undefined;setResizing(false)
    }
    const blur=()=>finish()
    window.addEventListener('pointermove',move)
    window.addEventListener('pointerup',finish)
    window.addEventListener('pointercancel',finish)
    window.addEventListener('blur',blur)
    return ()=>{
      window.removeEventListener('pointermove',move)
      window.removeEventListener('pointerup',finish)
      window.removeEventListener('pointercancel',finish)
      window.removeEventListener('blur',blur)
    }
  },[resizing,bounds,storage])

  function collapse() {
    if(typeof document!=='undefined') previousFocus.current=document.activeElement as HTMLElement
    focusPending.current=true;setCollapsed(true)
  }
  function begin(axis:ResizeAxis,event:ReactPointerEvent<HTMLDivElement>) {
    if(event.button!==0 || maximized || mobile) return
    event.preventDefault();event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current={axis,pointerId:event.pointerId,x:event.clientX,y:event.clientY,size}
    latestSize.current=size;setResizing(true)
  }
  function keyboardResize(axis:ResizeAxis,event:KeyboardEvent<HTMLDivElement>) {
    const step=event.shiftKey?50:20
    const dx=axis==='height'?0:event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0
    const dy=axis==='width'?0:event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0
    if(!dx&&!dy) return
    event.preventDefault()
    const next=resizeFromPointer(size,axis,dx,dy,bounds)
    setManual(next);writeWindowSize(storage,next)
  }
  return <div className="workbench-desktop" style={glassVariables(frost)} data-glass-frost={frost}>
    <button ref={launcher} className="workbench-launcher" type="button" hidden={!collapsed}
      aria-label="打开 BetterLearn" aria-expanded={!collapsed} aria-controls="betterlearn-workbench"
      onClick={()=>{focusPending.current=true;setCollapsed(false)}}><GlassBackdrop frost={frost} radius={16}/><BookOpen size={20}/><span>BetterLearn</span></button>
    <section ref={panel} id="betterlearn-workbench" className="workbench-window" tabIndex={-1}
      data-testid="workbench-window" data-maximized={maximized} data-resizing={resizing} hidden={collapsed}
      style={{width:size.width,height:size.height}} aria-label="BetterLearn 工作台">
      <header className="workbench-titlebar">
        <GlassBackdrop frost={frost} radius={12}/>
        <div className="workbench-title" title={title}><BookOpen size={16} strokeWidth={1.5}/><strong>BetterLearn</strong></div>
        <div className="workbench-window-actions">
          <button type="button" aria-label="收起工作台" title="收起工作台" onClick={collapse}><Minus size={16}/></button>
          <button type="button" aria-label={maximized?'还原工作台':'最大化工作台'} title={maximized?'还原工作台':'最大化工作台'}
            onClick={()=>setMaximized(value=>!value)}>{maximized?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button>
        </div>
      </header>
      <div className="workbench-window-body">{children}</div>
      {!maximized&&!mobile&&<>
        <div className="workbench-resize workbench-resize--width" role="separator" tabIndex={0} aria-orientation="vertical"
          aria-label="调整工作台宽度" aria-valuenow={size.width} aria-valuemin={Math.min(300,bounds.width-32)} aria-valuemax={Math.min(1080,bounds.width-32)}
          onPointerDown={e=>begin('width',e)} onKeyDown={e=>keyboardResize('width',e)}/>
        <div className="workbench-resize workbench-resize--height" role="separator" tabIndex={0} aria-orientation="horizontal"
          aria-label="调整工作台高度" aria-valuenow={size.height} aria-valuemin={Math.min(340,bounds.height-32)} aria-valuemax={bounds.height-32}
          onPointerDown={e=>begin('height',e)} onKeyDown={e=>keyboardResize('height',e)}/>
        <div className="workbench-resize workbench-resize--both" role="button" tabIndex={0} aria-label="调整工作台大小"
          title="拖动调整大小；方向键微调，Shift 加速" onPointerDown={e=>begin('both',e)} onKeyDown={e=>keyboardResize('both',e)}><MoveDiagonal2 size={13}/></div>
      </>}
    </section>
  </div>
}
