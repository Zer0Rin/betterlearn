import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test, vi } from 'vitest'
import { LibraryStore } from '../src/standalone/library.js'
import { acquireHomeLock } from '../src/standalone/home.js'
import { startStandalone } from '../src/standalone/server.js'
let cleanup:(()=>Promise<void>)|undefined;let home:string|undefined
afterEach(async()=>{await cleanup?.();cleanup=undefined;if(home)await rm(home,{recursive:true,force:true})})
test('native Core serves preview/history without DSH and protects settings',async()=>{
 home=await mkdtemp(join(tmpdir(),'bl-native-'))
 const app=await startStandalone({home,packageRoot:resolve('.'),pythonExecutable:resolve('.venv-phase1b/bin/python'),quizPythonExecutable:resolve('.venv-phase1b/bin/python'),port:0,quiz:false})
 cleanup=app.close
 const settings=await fetch(app.url+'/api/settings');expect(settings.status).toBe(200)
 expect((await settings.json()).text.apiKeySet).toBe(false)
 const denied=await fetch(app.url+'/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:'{}'});expect(denied.status).toBe(403)
 const preview=await fetch(app.url+'/nobei/v1/documents/preview',{method:'POST',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({filename:'note.txt',mediaType:'text/plain',text:'水在标准大气压下的沸点是100摄氏度。'})})
 expect(preview.status).toBe(200)
 expect((await preview.json()).result.text).toContain('100')
 expect((await (await fetch(app.url+'/nobei/v1/runs')).json()).result.runs).toEqual([])
 expect((await (await fetch(app.url+'/api/library')).json()).books).toEqual([])
 const bad=await fetch(app.url+'/api/library',{method:'PUT',headers:{origin:app.url,'content-type':'application/json'},body:'{"books":[{"title":"bad"}]}'});expect(bad.status).toBe(400)
},15000)
test('shutdown drains an accepted write before releasing the data-directory lock',async()=>{
 home=await mkdtemp(join(tmpdir(),'bl-drain-'))
 const python=resolve('.venv-phase1b/bin/python')
 const app=await startStandalone({home,packageRoot:resolve('.'),pythonExecutable:python,quizPythonExecutable:python,port:0,quiz:false})
 cleanup=app.close
 let enter!:()=>void,release!:()=>void
 const entered=new Promise<void>(r=>{enter=r}),gate=new Promise<void>(r=>{release=r})
 const original=LibraryStore.prototype.write
 const spy=vi.spyOn(LibraryStore.prototype,'write').mockImplementation(async function(value){enter();await gate;return original.call(this,value)})
 try{
  const pending=fetch(app.url+'/api/library',{method:'PUT',headers:{origin:app.url,'content-type':'application/json'},body:JSON.stringify({books:[],expectedRevision:0})}).catch(()=>undefined)
  await entered
  const closing=app.close()
  await expect(acquireHomeLock(home,python)).rejects.toThrow()
  release();await closing;await pending
  expect((await new LibraryStore(home).read()).revision).toBe(1)
  const unlock=await acquireHomeLock(home,python);await unlock()
 }finally{release();spy.mockRestore()}
})
