import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { SubprocessHandle, SubprocessSpawnSpec } from '../product/subprocess-port.js'
/** Only the Core's pipe protocol is needed; no shell or inherited credential environment. */
export class NativeSubprocess {
 constructor(private readonly packageRoot:string){}
 async resolveExecutable(command:string):Promise<string>{if(!isAbsolute(command))throw new Error('Python 路径必须是绝对路径');await access(command,constants.X_OK);return command}
 spawn(spec:SubprocessSpawnSpec):SubprocessHandle{
  const child=spawn(spec.argv[0]!,spec.argv.slice(1),{cwd:spec.cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME, ...spec.env,PYTHONPATH:join(this.packageRoot,'python')},stdio:[spec.stdio.stdin,'pipe','pipe'],detached:process.platform!=='win32'})
  child.stderr?.resume()
  let exited=false;let timer:NodeJS.Timeout|undefined
  const done=new Promise<{exitCode:number|null;signal:string|null}>((resolve,reject)=>{
   child.once('error',reject);child.once('close',(exitCode,signal)=>{exited=true;clearTimeout(timer);resolve({exitCode,signal})})
  })
  const kill=(signal:NodeJS.Signals)=>{if(exited||!child.pid)return;try{process.platform==='win32'?child.kill(signal):process.kill(-child.pid,signal)}catch{}}
  return {stdin:child.stdin??undefined,stdout:child.stdout??undefined,done,terminate(){kill('SIGTERM');timer??=setTimeout(()=>kill('SIGKILL'),spec.graceMs);timer.unref()},async waitForExit(){await done;return true}}
 }
}
