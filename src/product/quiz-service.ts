import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export interface QuizServiceConfig {
  pythonExecutable: string
  envFile: string
  dataRoot: string
  packageRoot: string
}
export interface QuizServicePort {
  start(): Promise<void>
  session(): Promise<{ user: unknown }>
  request(path: string, init?: RequestInit): Promise<Response>
  dispose(): Promise<void>
}
interface Session { token: string; user: unknown }

/** One subprocess per Host. Neither the private host secret nor JWT crosses the browser boundary. */
export class QuizService implements QuizServicePort {
  private child?: ChildProcessWithoutNullStreams
  private baseUrl?: string
  private starting?: Promise<void>
  private login?: Promise<Session>
  private disposed = false
  private stopping?: Promise<void>
  private readonly hostToken = randomBytes(32).toString('hex')
  private readonly jwtSecret = randomBytes(32).toString('hex')

  constructor(private readonly config: QuizServiceConfig,
    private readonly options: { commandArgs?: string[]; startupTimeoutMs?: number } = {}) {}

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('练习服务已停止'))
    if (!this.starting) {
      this.starting = this.launch().catch(async error => {
        await this.stopChild(); this.starting = undefined; throw error
      })
    }
    return this.starting
  }

  private async launch(): Promise<void> {
    try { await access(this.config.envFile, constants.R_OK) }
    catch { throw new Error('无法读取 quiz.env，请恢复练习服务配置后重试') }
    await mkdir(this.config.dataRoot, { recursive: true, mode: 0o700 })
    if (this.disposed) throw new Error('练习服务已停止')
    const child = spawn(this.config.pythonExecutable,
      this.options.commandArgs ?? [join(this.config.packageRoot, 'services/quiz/run_managed.py')], {
        cwd: this.config.dataRoot,
        env: { ...process.env, PYTHONPATH: join(this.config.packageRoot, 'services/quiz'),
          BETTERLEARN_QUIZ_ENV_FILE: this.config.envFile,
          MANAGED_HOST_TOKEN: this.hostToken, JWT_SECRET: this.jwtSecret,
          APP_HOST: '127.0.0.1', APP_DEBUG: 'false', LOCAL_LOGIN_ENABLED: 'false',
          KB_UPLOAD_DIR: join(this.config.dataRoot, 'uploads'),
          CHROMA_PERSIST_DIR: join(this.config.dataRoot, 'chroma'), PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    this.child = child
    let failure: Error | undefined
    let buffer = ''
    child.on('error', () => { failure = new Error('无法启动练习服务，请检查练习 Python 环境') })
    child.on('exit', () => {
      failure ??= new Error('练习服务退出，请检查 quiz.env、MySQL 和模型配置')
      this.baseUrl = undefined; this.login = undefined; this.starting = undefined
    })
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try {
          const value = JSON.parse(line) as { betterlearnQuizPort?: number }
          if (Number.isInteger(value.betterlearnQuizPort) && value.betterlearnQuizPort! > 0 && value.betterlearnQuizPort! <= 65535) {
            this.baseUrl = `http://127.0.0.1:${value.betterlearnQuizPort}`
          }
        } catch { /* Application logs are not the readiness protocol. */ }
      }
      if (buffer.length > 65536) buffer = ''
    })
    // Drain logs without exposing provider credentials or uploaded text in Host output.
    child.stderr.resume()
    const deadline = Date.now() + (this.options.startupTimeoutMs ?? 30000)
    while (Date.now() < deadline) {
      if (failure) throw failure
      if (this.disposed) throw new Error('练习服务已停止')
      if (this.baseUrl) {
        try {
          const response = await fetch(`${this.baseUrl}/api/v1/health`, {
            headers: { 'X-BetterLearn-Host': this.hostToken }, signal: AbortSignal.timeout(500), redirect: 'error',
          })
          if (response.ok && !failure && !this.disposed) return
        } catch { /* Retry only readiness, never a business mutation. */ }
      }
      await delay(50)
    }
    throw new Error('练习服务启动超时，请检查 quiz.env 和 MySQL 是否可用')
  }

  private async raw(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.baseUrl || this.disposed) throw new Error('练习服务不可用')
    const headers = new Headers(init.headers)
    headers.set('X-BetterLearn-Host', this.hostToken)
    const timeout = AbortSignal.timeout(600000)
    return fetch(`${this.baseUrl}/api/v1${path}`, { ...init, headers, redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
  }

  private async authenticate(): Promise<Session> {
    await this.start()
    this.login ??= this.raw('/user/host-session', { method: 'POST' }).then(async response => {
      const body = await response.json() as { code?: number; data?: Session }
      if (!response.ok || body.code !== 0 || !body.data || typeof body.data.token !== 'string') {
        throw new Error('无法建立练习身份，请检查 MySQL 和练习服务配置')
      }
      return body.data
    }).catch(error => { this.login = undefined; throw error })
    return this.login
  }

  async session(): Promise<{ user: unknown }> {
    const { user } = await this.authenticate()
    return { user }
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    // Callers use a separate public allowlist; this guard also protects internal adapters.
    if (!path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path)) throw new Error('Invalid quiz path')
    init.signal?.throwIfAborted()
    const session = await this.authenticate()
    init.signal?.throwIfAborted()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${session.token}`)
    let response = await this.raw(path, { ...init, headers })
    if (response.status === 401) {
      await response.body?.cancel()
      // Only invalidate the session used by this request; concurrent renewal is shared.
      if (await this.login === session) this.login = undefined
      const renewed = await this.authenticate()
      headers.set('Authorization', `Bearer ${renewed.token}`)
      response = await this.raw(path, { ...init, headers })
    }
    return response
  }

  private async stopChild(): Promise<void> {
    const child = this.child
    this.child = undefined; this.baseUrl = undefined; this.login = undefined
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', () => resolve()) })
    child.stdin.end(); child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
    timer.unref()
    await exited
    clearTimeout(timer)
  }

  dispose(): Promise<void> {
    this.disposed = true
    this.stopping ??= (async () => {
      await this.starting?.catch(() => undefined)
      await this.stopChild()
    })()
    return this.stopping
  }
}
