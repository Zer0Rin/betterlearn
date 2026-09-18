import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, mkdir, rm, stat, access, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const lock = vi.hoisted(() => ({ unlock: vi.fn(async () => {}), acquire: vi.fn() }))
vi.mock('../src/standalone/home.js', () => ({ acquireHomeLock: lock.acquire }))
import { prepareDesktopRuntime, readDesktopRuntime, validateDesktopRuntime, findPython312, discoverPython312 } from '../src/desktop/runtime.js'
let root: string, home: string, python: string
beforeEach(async () => {
 root = await mkdtemp(join(tmpdir(), 'desktop-runtime-')); home=join(root,'home'); python=join(root,'python')
 lock.unlock.mockClear(); lock.acquire.mockReset(); lock.acquire.mockResolvedValue(lock.unlock)
 await writeFile(python, `#!${process.execPath}\nconst fs=require('fs'),p=require('path');const a=process.argv.slice(2);const root=${JSON.stringify(root)};\nif(a[0]==='-c'){if(fs.existsSync(p.join(root,'hang-probe'))||(a[1].startsWith('import fastapi')&&fs.existsSync(p.join(root,'hang-import')))){fs.writeFileSync(p.join(root,'pid'),String(process.pid));setInterval(()=>{},1000);return;}if(a[1].startsWith('import fastapi')&&fs.existsSync(p.join(root,'bad-import')))process.exit(1);if(fs.existsSync(p.join(root,'bad-version')))process.exit(1);console.log(JSON.stringify({executable:process.argv[1],version:[3,12]}))}\nelse if(a[1]==='venv'){fs.mkdirSync(p.join(a[2],'bin'),{recursive:true});fs.copyFileSync(process.argv[1],p.join(a[2],'bin/python'));fs.chmodSync(p.join(a[2],'bin/python'),0o700)}\nelse if(a[1]==='pip'){if(fs.existsSync(p.join(root,'fail'))) {console.error('secret-key-value');process.exit(1)};if(fs.existsSync(p.join(root,'hang'))){const sub=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(p.join(root,'descendant'),String(sub.pid));fs.writeFileSync(p.join(root,'pid'),String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}}\n`,{mode:0o700})
})
afterEach(async () => {vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})})
function prepare(signal=new AbortController().signal){return prepareDesktopRuntime({home,packageRoot:root,python,signal,onProgress:()=>{}})}
test('missing configuration returns null; malformed and relative saved paths are actionable',async()=>{
 expect(await readDesktopRuntime(home)).toBeNull();await mkdir(home)
 for(const contents of ['{',JSON.stringify({pythonExecutable:'python',quizPythonExecutable:python})]){
  await writeFile(join(home,'runtime.json'),contents)
  await expect(readDesktopRuntime(home)).rejects.toThrow(/重新|修复|准备/)
 }
})
test('rejects invalid Python before acquiring lock or creating home',async()=>{
 await writeFile(join(root,'bad-version'),'')
 await expect(prepare()).rejects.toThrow(/3\.12/)
 expect(lock.acquire).not.toHaveBeenCalled();await expect(access(home)).rejects.toThrow()
})
test('publishes private runtime only after preparation and validates both environments',async()=>{
 const runtime=await prepare()
 expect(await readDesktopRuntime(home)).toEqual(runtime)
 expect((await stat(join(home,'runtime.json'))).mode&0o777).toBe(0o600)
 await expect(validateDesktopRuntime(runtime)).resolves.toBeUndefined()
 expect(lock.unlock).toHaveBeenCalledOnce()
})
test('failed install keeps learning data, hides subprocess output, and can retry',async()=>{
 await mkdir(home);await writeFile(join(home,'learning.txt'),'keep');await writeFile(join(root,'fail'),'')
 await expect(prepare()).rejects.toThrow(/安装/)
 expect(await readDesktopRuntime(home)).toBeNull();expect(await readFile(join(home,'learning.txt'),'utf8')).toBe('keep')
 expect(lock.unlock).toHaveBeenCalledOnce();await rm(join(root,'fail'));await prepare()
 expect(await readDesktopRuntime(home)).not.toBeNull()
})
test('cancellation waits for an uncooperative child before releasing lock',async()=>{
 await writeFile(join(root,'hang'),'');const controller=new AbortController()
 const pending=prepare(controller.signal);const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'})
 let pid=0
 for(let i=0;i<100;i++){try{pid=Number(await readFile(join(root,'pid'),'utf8'));break}catch{await new Promise(r=>setTimeout(r,20))}}
 expect(pid).toBeGreaterThan(0)
 const descendant=Number(await readFile(join(root,'descendant'),'utf8'))
 lock.unlock.mockImplementationOnce(async()=>{expect(()=>process.kill(pid,0)).toThrow()})
 controller.abort();await rejected
 expect(lock.unlock).toHaveBeenCalledOnce();expect(await readDesktopRuntime(home)).toBeNull()
 await expect.poll(()=>{try{process.kill(descendant,0);return true}catch{return false}}).toBe(false)
})

test('discovery resolves an executable from PATH by running it',async()=>{
 await symlink(python,join(root,'python3.12'));vi.stubEnv('PATH',root)
 expect(await findPython312()).toBe(join(root,'python3.12'))
})
test('missing imports prevent publishing a prepared runtime',async()=>{
 await writeFile(join(root,'bad-import'),'')
 await expect(prepare()).rejects.toThrow(/依赖/)
 expect(await readDesktopRuntime(home)).toBeNull();expect(lock.unlock).toHaveBeenCalledOnce()
})
test('already cancelled preparation does not mutate home',async()=>{
 const controller=new AbortController();controller.abort()
 await expect(prepare(controller.signal)).rejects.toMatchObject({name:'AbortError'})
 expect(lock.acquire).not.toHaveBeenCalled();await expect(access(home)).rejects.toThrow()
})

for (const stage of ['discovery','validation'] as const) {
 test(`cancels a hanging ${stage} subprocess promptly`,async()=>{
  const controller=new AbortController()
  await writeFile(join(root,stage==='discovery'?'hang-probe':'hang-import'),'')
  await symlink(python,join(root,'python3.12'));vi.stubEnv('PATH',root)
  const pending=stage==='discovery'?findPython312(controller.signal):validateDesktopRuntime({pythonExecutable:python,quizPythonExecutable:python},controller.signal)
  const outcome=pending.then(()=> 'resolved',error=>(error as Error).name)
  let pid=0
  for(let i=0;i<150;i++){try{pid=Number(await readFile(join(root,'pid'),'utf8'));break}catch{await new Promise(r=>setTimeout(r,20))}}
  try {
   expect(pid).toBeGreaterThan(0);controller.abort()
   expect(await Promise.race([outcome,new Promise(resolve=>setTimeout(()=>resolve('timeout'),500))])).toBe('AbortError')
   expect(()=>process.kill(pid,0)).toThrow()
  } finally {if(pid){try{process.kill(-pid,'SIGKILL')}catch{}}await outcome}
 })
}

test('discovery skips incompatible versions and deduplicates symlinked installations', async () => {
 const alias = join(root, 'python3.12')
 await symlink(python, alias)
 const invalid = join(root, 'old-python')
 await writeFile(invalid, '#!/bin/sh\nexit 1\n', {mode:0o700})
 expect(await discoverPython312(undefined, [invalid, python, alias])).toEqual([{path:python,version:'3.12'}])
 expect(await discoverPython312(undefined, [invalid])).toEqual([])
})
