import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { startStandalone } from './server.js'
import { acquireHomeLock } from './home.js'
import { atomicJson,SettingsStore } from './config.js'
import { backupHome,restoreHome } from './maintenance.js'
const packageRoot=fileURLToPath(new URL('.',import.meta.url))
const {values,positionals}=parseArgs({allowPositionals:true,options:{home:{type:'string'},python:{type:'string'},'quiz-python':{type:'string'},port:{type:'string'},to:{type:'string'},from:{type:'string'},help:{type:'boolean'}}})
const command=positionals[0],home=resolve(values.home??join(homedir(),'.betterlearn-web'))
function run(argv:string[]):Promise<void>{return new Promise((resolve,reject)=>{const child=spawn(argv[0]!,argv.slice(1),{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Python 环境准备失败')))})}
async function main(){
 if(values.help||!command){console.log('BetterLearn 本地单人 Web\ninit --home DIR --python /path/to/python3.12\nstart --home DIR [--port 3210]\nbackup --home DIR --to NEW_DIR\nrestore --home NEW_DIR --from BACKUP_DIR\n备份包含模型密钥，请妥善保存。');return}
 if(command==='init'){
  const python=values.python??'python3.12';await run([python,'-c',"import sys; assert sys.version_info[:2] == (3,12), 'Python 3.12 required'"])
  await mkdir(home,{recursive:true,mode:0o700});const unlock=await acquireHomeLock(home,python)
  try{for(const [folder,requirements] of [['venv','python/requirements-phase1.lock'],['quiz-venv','services/quiz/requirements.txt']]){await run([python,'-m','venv',join(home,folder!)]);await run([join(home,folder!,'bin/python'),'-m','pip','install','-r',join(packageRoot,requirements!)])}
   await SettingsStore.open(home);await atomicJson(join(home,'runtime.json'),{pythonExecutable:join(home,'venv/bin/python'),quizPythonExecutable:join(home,'quiz-venv/bin/python')});console.log('初始化完成。运行 start 后在设置中填写模型连接。')
  }finally{await unlock()}return
 }
 let runtime:{pythonExecutable?:string;quizPythonExecutable?:string}={}
 try{runtime=JSON.parse(await readFile(join(home,'runtime.json'),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
 const python=values.python?resolve(values.python):runtime.pythonExecutable??'python3.12'
 if(command==='backup'){if(!values.to)throw new Error('缺少 --to');await backupHome(home,resolve(values.to),python);console.log('备份完成，包含私有模型配置。');return}
 if(command==='restore'){if(!values.from)throw new Error('缺少 --from');await restoreHome(resolve(values.from),home,python);console.log('恢复完成。请运行 init 准备 Python 环境，再运行 start。');return}
 if(command!=='start')throw new Error('未知命令')
 if(!values.python&&!runtime.pythonExecutable)throw new Error('请先运行 init')
 const port=values.port===undefined?3210:Number(values.port);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('无效端口')
 const app=await startStandalone({home,packageRoot,pythonExecutable:python,quizPythonExecutable:values['quiz-python']?resolve(values['quiz-python']):runtime.quizPythonExecutable??python,port})
 console.log(`BetterLearn ${app.url}`)
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>{process.exitCode=0})})
}
main().catch(error=>{console.error(error instanceof Error?error.message:'启动失败');process.exitCode=1})
