import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { atomicJson } from '../standalone/config.js'
import { acquireHomeLock } from '../standalone/home.js'

export interface DesktopRuntime { pythonExecutable: string; quizPythonExecutable: string }
const probe = 'import json,sys; assert sys.version_info[:2] == (3,12); print(json.dumps({"executable":sys.executable,"version":list(sys.version_info[:3])}))'
function aborted(): Error { const error = new Error('环境准备已取消'); error.name = 'AbortError'; return error }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw aborted() }
async function executable(path: unknown): Promise<void> {
 if (typeof path !== 'string' || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw new Error('请选择 Python 3.12 可执行文件的绝对路径')
 try { await access(path, constants.X_OK); if (!(await stat(path)).isFile()) throw new Error() }
 catch { throw new Error('Python 可执行文件不存在或不可执行，请重新准备环境') }
}
// Never forward pip output: index URLs and subprocess diagnostics can contain credentials.
function run(python: string, args: string[], signal?: AbortSignal, timeout = 10_000): Promise<string> {
 checkAbort(signal)
 return new Promise((resolve, reject) => {
  const env = {...process.env}; delete env.PYTHONHOME; delete env.PYTHONPATH
  const child = spawn(python, args, { detached: true, stdio: ['ignore','pipe','pipe'], env })
  let output = '', cancelled = false, timedOut = false
  const kill = () => {
   if (!child.pid) return
   try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL') }
  }
  const cancel = () => { cancelled = true; kill() }
  const timer = setTimeout(() => { timedOut = true; kill() }, timeout)
  signal?.addEventListener('abort', cancel, {once:true})
  if (signal?.aborted) cancel()
  child.stdout.on('data', (data: Buffer) => { if (output.length < 16_384) output += data.toString().slice(0,16_384-output.length) })
  child.stderr.resume()
  let spawnFailed = false
  child.once('error', () => { spawnFailed = true })
  // close, unlike exit, waits for the child's streams; no lock is released while it runs.
  child.once('close', code => {
   clearTimeout(timer); signal?.removeEventListener('abort', cancel)
   if (cancelled) reject(aborted())
   else if (spawnFailed || timedOut || code !== 0) reject(new Error('Python 子进程执行失败'))
   else resolve(output.trim())
  })
 })
}
async function verifyPython(python: string, signal?: AbortSignal): Promise<string> {
 checkAbort(signal)
 await executable(python)
 try {
  const result: unknown = JSON.parse(await run(python, ['-c',probe], signal))
  if (!result || typeof result !== 'object') throw new Error()
  const value = result as {executable?:unknown;version?:unknown}
  if (!Array.isArray(value.version) || value.version[0] !== 3 || value.version[1] !== 12) throw new Error()
  await executable(value.executable)
  return value.executable as string
 } catch (error) { if ((error as Error).name === 'AbortError') throw error; throw new Error('需要可用的 Python 3.12，请安装后重新选择 Python 可执行文件') }
}
export async function readDesktopRuntime(home: string): Promise<DesktopRuntime|null> {
 let text: string
 try { text = await readFile(join(home,'runtime.json'),'utf8') }
 catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('无法读取运行环境配置，请检查数据目录权限并重新准备环境') }
 try {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
  const runtime = value as DesktopRuntime
  await executable(runtime.pythonExecutable); await executable(runtime.quizPythonExecutable)
  return {pythonExecutable:runtime.pythonExecutable,quizPythonExecutable:runtime.quizPythonExecutable}
 } catch { throw new Error('运行环境配置损坏或 Python 不可用，请重新准备环境；学习数据会保留') }
}
export interface PythonInstallation { path: string; version: string }
export async function discoverPython312(signal?: AbortSignal, candidates = ['python3.12','/opt/homebrew/bin/python3.12','/usr/local/bin/python3.12','/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12','/usr/bin/python3.12']): Promise<PythonInstallation[]> {
 const found: PythonInstallation[] = []
 const seen = new Set<string>()
 for (const candidate of candidates) {
  checkAbort(signal)
  try {
   const value = JSON.parse(await run(candidate,['-c',probe],signal)) as {executable:string;version:number[]}
   const path = await verifyPython(value.executable,signal)
   const identity = await realpath(path)
   if (!seen.has(identity)) {
    seen.add(identity)
    found.push({path, version:value.version.join('.')})
   }
  } catch (error) { if ((error as Error).name === 'AbortError') throw error }
 }
 return found
}
export async function findPython312(signal?: AbortSignal): Promise<string|null> {
 return (await discoverPython312(signal))[0]?.path ?? null
}
async function validate(runtime: DesktopRuntime, signal?: AbortSignal): Promise<void> {
 for (const [python, imports] of [
  [runtime.pythonExecutable,'jsonschema, pypdf'],
  [runtime.quizPythonExecutable,'fastapi, uvicorn, pydantic_settings, langchain_core, langchain_openai, langchain_tavily, langgraph, langchain_chroma, langchain_community, chromadb, pypdf, docx2txt, multipart, structlog, dotenv, cryptography, jwt, httpx, dashscope, qcloud_cos, PIL'],
 ] as const) {
  checkAbort(signal)
  await verifyPython(python, signal)
  try { await run(python,['-c',`import ${imports}`],signal,60_000) }
  catch (error) { if ((error as Error).name === 'AbortError') throw error; throw new Error('Python 依赖缺失或无法加载，请重新准备环境') }
 }
}
export async function validateDesktopRuntime(runtime: DesktopRuntime, signal?: AbortSignal): Promise<void> { await validate(runtime,signal) }
export async function prepareDesktopRuntime(options: {
 home: string; packageRoot: string; python: string; signal: AbortSignal; onProgress: (message: string) => void
}): Promise<DesktopRuntime> {
 const {home, packageRoot, python, signal, onProgress} = options
 checkAbort(signal)
 if (!isAbsolute(home) || !isAbsolute(packageRoot)) throw new Error('数据目录与应用资源目录必须是绝对路径')
 onProgress('正在检查 Python 3.12')
 await verifyPython(python,signal); checkAbort(signal)
 const unlock = await acquireHomeLock(home,python)
 try {
  checkAbort(signal)
  await mkdir(home,{recursive:true,mode:0o700})
  for (const [folder, requirements, label] of [
   ['venv','python/requirements-phase1.lock','核心'],
   ['quiz-venv','services/quiz/requirements.txt','学习'],
  ] as const) {
   onProgress(`正在创建${label}环境`)
   try { await run(python,['-m','venv',join(home,folder)],signal,120_000) }
   catch (error) { if ((error as Error).name === 'AbortError') throw error; throw new Error(`无法创建${label}环境，请检查 Python 3.12 的 venv 支持和数据目录权限后重试`) }
   onProgress(`正在安装${label}依赖，首次准备可能需要几分钟`)
   try { await run(join(home,folder,'bin/python'),['-m','pip','install','--disable-pip-version-check','--no-input','-r',join(packageRoot,requirements)],signal,20*60_000) }
   catch (error) { if ((error as Error).name === 'AbortError') throw error; throw new Error(`${label}依赖安装失败，请检查网络连接、Python 3.12 和磁盘空间后重试`) }
  }
  const runtime = {pythonExecutable:join(home,'venv/bin/python'),quizPythonExecutable:join(home,'quiz-venv/bin/python')}
  onProgress('正在验证运行环境')
  await validate(runtime,signal); checkAbort(signal)
  await atomicJson(join(home,'runtime.json'),runtime)
  return runtime
 } finally { await unlock() }
}
