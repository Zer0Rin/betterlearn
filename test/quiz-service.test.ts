import { afterEach, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { QuizService } from '../src/product/quiz-service.js'
const services: QuizService[] = []
const dirs: string[] = []
afterEach(async () => { await Promise.all(services.splice(0).map(s=>s.dispose())); await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true}))) })
async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),'quiz-service-')); dirs.push(dir)
 await writeFile(join(dir,'quiz.env'),'MYSQL_DATABASE=test_only\n')
 const service=new QuizService({pythonExecutable:process.execPath, envFile:join(dir,'quiz.env'), dataRoot:dir, packageRoot:resolve('.')}, {commandArgs:[resolve('test/fixtures/quiz-child.mjs')], startupTimeoutMs:3000})
 services.push(service); return service
}
test('starts owned service, keeps JWT private and renews an expired session', async()=>{
 const service=await fixture()
 const session=await service.session()
 expect(session).toEqual({user:{id:1,nickname:'test'}})
 expect(JSON.stringify(session)).not.toContain('jwt')
 const response=await service.request('/user/profile')
 expect((await response.json()).data).toMatchObject({id:1,nickname:'renewed',sessions:2})
 await service.dispose()
 await expect(service.session()).rejects.toThrow()
})
test('concurrent callers share one session bootstrap',async()=>{
 const service=await fixture()
 const sessions=await Promise.all([service.session(),service.session(),service.session()])
 expect(sessions).toEqual(Array(3).fill({user:{id:1,nickname:'test'}}))
})
test('aborts a pending upstream request',async()=>{
 const service=await fixture(); await service.start()
 const controller=new AbortController()
 const request=service.request('/slow',{signal:controller.signal})
 controller.abort()
 await expect(request).rejects.toThrow()
})

test('refuses missing managed configuration instead of falling back to tutorial defaults',async()=>{
 const service=await fixture()
 await rm(join(dirs[dirs.length-1],'quiz.env'))
 await expect(service.start()).rejects.toThrow('quiz.env')
})
