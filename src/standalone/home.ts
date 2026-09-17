import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicJson } from './config.js'
const execute=promisify(execFile)
export async function acquireHomeLock(home:string,python:string):Promise<()=>Promise<void>>{
 await mkdir(home,{recursive:true,mode:0o700})
 const child=spawn(python,['-c',`import fcntl,sys,os\nf=open(sys.argv[1], 'a')\nos.chmod(sys.argv[1],0o600)\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(73)\nprint('ready',flush=True)\nsys.stdin.buffer.read()`,join(home,'.app.lock')],{stdio:['pipe','pipe','pipe']})
 child.stderr.resume()
 const done=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve())})
 void done.catch(()=>{})
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>reject(new Error('应用或维护操作正在使用该数据目录')));child.stdout.once('data',()=>resolve())})
 return async()=>{child.stdin.end();await done}
}
export async function initializeCore(home:string,python:string,packageRoot:string):Promise<{dataRoot:string;ownershipToken:string}>{
 const path=join(home,'identity.json');let identity:{ownershipToken:string}
 try{identity=JSON.parse(await readFile(path,'utf8'));if(!/^[a-f0-9]{64}$/.test(identity.ownershipToken))throw new Error('无效本机身份')}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;identity={ownershipToken:randomBytes(32).toString('hex')};await atomicJson(path,identity)}
 const dataRoot=join(home,'core');await mkdir(dataRoot,{recursive:true,mode:0o700})
 await execute(python,['-c',`import sys\nfrom pathlib import Path\nfrom nobei_core.ownership import initialize_owned_root\nfrom nobei_core.database import Phase1Database\np=Path(sys.argv[1])\nif not (p/'.nobei-phase1-owned.json').exists(): initialize_owned_root(p,sys.argv[2])\ndb=Phase1Database.open(p,sys.argv[2]);db.close()`,dataRoot,identity.ownershipToken],{env:{PATH:process.env.PATH,HOME:process.env.HOME,PYTHONPATH:join(packageRoot,'python')},timeout:15000}).catch(()=>{throw new Error('无法初始化 Core，请检查 Python 3.12 环境和数据目录权限')})
 return {dataRoot,...identity}
}
