import { mkdtemp,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect,test } from 'vitest'
import { LibraryStore } from '../src/standalone/library.js'
test('stale tab cannot overwrite a newer library snapshot',async()=>{
 const home=await mkdtemp(join(tmpdir(),'bl-cas-'));try{const store=new LibraryStore(home);expect(await store.read()).toEqual({books:[],revision:0});const saved=await store.write({books:[],expectedRevision:0});expect(saved.revision).toBe(1);await expect(store.write({books:[],expectedRevision:0})).rejects.toThrow('书库已在其他页面更新');expect((await store.read()).revision).toBe(1)}finally{await rm(home,{recursive:true,force:true})}
})
test('stale delete is rejected before course deletion; interrupted delete can recover',async()=>{
 const home=await mkdtemp(join(tmpdir(),'bl-delete-'))
 const book={bookId:'book-1',title:'知识',createdAt:new Date().toISOString(),sourceText:'正文',courseId:'course-1',points:[{knowledgePointId:'kp-1',documentId:'doc-1',type:'concept',title:'知识',statement:'正文',evidence:[]}]}
 try{
  const store=new LibraryStore(home);await store.write({books:[book],expectedRevision:0})
  let deletes=0
  await expect(store.deleteBook('book-1',0,async()=>{deletes++})).rejects.toThrow('书库已在其他页面更新')
  expect(deletes).toBe(0)
  await expect(store.deleteBook('book-1',1,async()=>{throw new Error('disconnected')})).rejects.toThrow()
  const restarted=new LibraryStore(home);await restarted.recoverDelete(async id=>{expect(id).toBe('course-1');deletes++})
  expect(await restarted.read()).toEqual({books:[],revision:2});expect(deletes).toBe(1)
 }finally{await rm(home,{recursive:true,force:true})}
})
