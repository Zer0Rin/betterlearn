import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test } from 'vitest'
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
