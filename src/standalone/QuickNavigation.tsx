import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Search, X } from 'lucide-react'

export interface NavigationAction { label: string; onSelect(): void }

/** Native dialog supplies focus containment, Escape dismissal and focus restoration. */
export function QuickNavigation({ actions }: { actions: NavigationAction[] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const matches = actions.filter(action => action.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const open = () => { setQuery(''); dialog.current?.showModal(); input.current?.focus() }
  const choose = (action: NavigationAction) => { dialog.current?.close(); action.onSelect() }
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.isComposing) {
        event.preventDefault()
        if (dialog.current?.open) dialog.current.close()
        else open()
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])
  return <>
    <button type="button" className="workspace-search-trigger" aria-label="快速跳转" aria-keyshortcuts="Meta+K Control+K" onClick={open}><Search size={16} aria-hidden="true"/><span>快速跳转</span><kbd>⌘ / Ctrl K</kbd></button>
    <dialog ref={dialog} className="workspace-command" aria-labelledby="workspace-command-title">
      <header><h2 id="workspace-command-title">跳转到</h2><button type="button" aria-label="关闭快速跳转" onClick={() => dialog.current?.close()}><X size={18} aria-hidden="true"/></button></header>
      <label className="workspace-command-input"><Search size={18} aria-hidden="true"/><input ref={input} aria-label="搜索页面" placeholder="搜索页面，例如：题库、学习目标" value={query} onChange={event => setQuery(event.currentTarget.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && matches[0]) { event.preventDefault(); choose(matches[0]) }
        if (event.key === 'ArrowDown') { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>('.workspace-command-results button')?.focus() }
      }}/></label>
      <div className="workspace-command-results" aria-label="页面">{matches.map(action => <button type="button" key={action.label} onClick={() => choose(action)}>{action.label}<ArrowUpRight size={16} aria-hidden="true"/></button>)}{!matches.length && <p role="status">没有找到相关页面，试试“学习”或“知识”。</p>}</div>
      <footer>输入名称快速查找 · Enter 打开首项 · Esc 关闭</footer>
    </dialog>
  </>
}
