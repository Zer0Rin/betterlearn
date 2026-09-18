/** Adapted from DeepTutor web/components/space/question-bank/CategoryManager.tsx
 * (Apache-2.0). See docs/deeptutor-reuse.md and services/quiz/third_party/DeepTutor.
 * Uses BetterLearn's API, Chinese copy and inline deletion confirmation; no i18n/Tailwind runtime.
 */
import { useState } from 'react'
import type { BankCategory } from '../bank-types.js'
interface Props {
  categories: BankCategory[]; busy: boolean
  onCreate(name:string):Promise<boolean>; onRename(id:number,name:string):Promise<boolean>; onDelete(id:number):Promise<boolean>
}
export function BankCategoryManager({categories,busy,onCreate,onRename,onDelete}:Props) {
  const [newName,setNewName]=useState('')
  const [renaming,setRenaming]=useState<{id:number;name:string}>()
  const [deleting,setDeleting]=useState<BankCategory>()
  const commitRename=async()=>{if(renaming?.name.trim() && await onRename(renaming.id,renaming.name.trim()))setRenaming(undefined)}
  return <section className="zl-panel zl-bank-categories" aria-label="分类管理"><h2>分类管理</h2>
    {categories.length ? <ul>{categories.map(category=><li key={category.id}>
      {renaming?.id===category.id ? <><input aria-label="分类新名称" maxLength={100} value={renaming.name} disabled={busy} onChange={e=>setRenaming({id:category.id,name:e.target.value})} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter')void commitRename();if(e.key==='Escape')setRenaming(undefined)}}/>
        <button className="zl-secondary" disabled={busy || !renaming.name.trim()} onClick={()=>void commitRename()}>保存名称</button><button className="zl-secondary" disabled={busy} onClick={()=>setRenaming(undefined)}>取消改名</button></>
        : <><span>{category.name} <small>{category.entry_count} 题</small></span><button className="zl-secondary" aria-label={`重命名分类：${category.name}`} disabled={busy} onClick={()=>setRenaming({id:category.id,name:category.name})}>改名</button><button className="zl-secondary" aria-label={`删除分类：${category.name}`} disabled={busy} onClick={()=>setDeleting(category)}>删除</button></>}
    </li>)}</ul> : <p className="zl-muted">还没有分类。</p>}
    {deleting && <div className="zl-notice" role="group" aria-label="确认删除分类"><p>删除“{deleting.name}”及其分类关联？题目和作答记录会保留。</p><button className="zl-secondary" disabled={busy} onClick={()=>{void onDelete(deleting.id).then(ok=>{if(ok)setDeleting(undefined)})}}>确认删除分类</button><button className="zl-secondary" disabled={busy} onClick={()=>setDeleting(undefined)}>取消删除</button></div>}
    <div className="zl-bank-controls"><input aria-label="新分类名称" placeholder="新分类名称" maxLength={100} value={newName} disabled={busy} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'&&newName.trim())void onCreate(newName.trim()).then(ok=>{if(ok)setNewName('')})}}/>
      <button className="zl-primary" disabled={busy || !newName.trim()} onClick={()=>{void onCreate(newName.trim()).then(ok=>{if(ok)setNewName('')})}}>新增分类</button></div>
  </section>
}
