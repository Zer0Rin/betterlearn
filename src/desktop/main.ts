import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startStandalone } from '../standalone/server.js'
import { discoverPython312, prepareDesktopRuntime, readDesktopRuntime, validateDesktopRuntime } from './runtime.js'
import type { DesktopRuntime, PythonInstallation } from './runtime.js'

app.setName('BetterLearn')
const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const home = resolve(process.env.BETTERLEARN_HOME ?? join(homedir(), '.betterlearn-web'))
// Isolated verification homes must not share Chromium storage or the instance lock.
app.setPath('userData', process.env.BETTERLEARN_HOME
  ? join(home, 'desktop-profile') : join(app.getPath('appData'), 'BetterLearn'))
const packageRoot = app.isPackaged ? join(process.resourcesPath, 'standalone') : resolve(moduleDirectory, '../standalone')
const setupURL = pathToFileURL(join(moduleDirectory, 'setup.html')).href
let window: BrowserWindow | undefined
let service: Awaited<ReturnType<typeof startStandalone>> | undefined
let operation: Promise<void> | undefined
let nativeGlass: { setGlass(handle: Buffer, frost: number): boolean } | undefined
let stopping = false
let stopped = false
const abort = new AbortController()
type State = { phase: 'loading' | 'setup' | 'preparing' | 'error'; message: string; python: string; home: string; installations: PythonInstallation[]; needsSetup: boolean }
let state: State = { phase: 'loading', message: '正在打开学习工作台…', python: '', home, installations: [], needsSetup: false }

function publish(update: Partial<State>): void {
  state = { ...state, ...update }
  if (window && !window.isDestroyed() && window.webContents.getURL() === setupURL) {
    window.webContents.send('betterlearn:setup-state', state)
  }
}

function assertSetup(event: IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
    || event.senderFrame.url !== setupURL || stopping) throw new Error('UNTRUSTED_SETUP_REQUEST')
}

async function launchService(runtime: DesktopRuntime): Promise<void> {
  await validateDesktopRuntime(runtime, abort.signal)
  publish({ needsSetup: false })
  if (stopping) return
  const port = Number(process.env.BETTERLEARN_PORT ?? 3210)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('BETTERLEARN_PORT 必须为 0 到 65535 的整数')
  publish({ message: '正在启动本机学习服务…' })
  service = await startStandalone({ home, packageRoot, ...runtime, port })
  if (stopping) return
  await window!.loadURL(service.url)
}

async function boot(): Promise<void> {
  publish({ phase: 'loading', message: '正在检查本机学习环境…' })
  let runtime: DesktopRuntime | null
  if (process.env.BETTERLEARN_PYTHON || process.env.BETTERLEARN_QUIZ_PYTHON) {
    if (!process.env.BETTERLEARN_PYTHON || !process.env.BETTERLEARN_QUIZ_PYTHON) {
      throw new Error('请同时设置 BETTERLEARN_PYTHON 和 BETTERLEARN_QUIZ_PYTHON')
    }
    runtime = { pythonExecutable: resolve(process.env.BETTERLEARN_PYTHON), quizPythonExecutable: resolve(process.env.BETTERLEARN_QUIZ_PYTHON) }
  } else {
    publish({ needsSetup: true })
    runtime = await readDesktopRuntime(home)
  }
  if (runtime) {
    await launchService(runtime); return
  }
  await detectPython()
}

async function detectPython(): Promise<void> {
  const installations = await discoverPython312(abort.signal)
  const python = installations[0]?.path
  if (stopping) return
  publish({ phase: 'setup', needsSetup: true, installations, python: python ?? '', message: python
    ? '首次使用需要联网准备学习环境，完成后即可配置模型 API。'
    : '未检测到 Python 3.12。安装后点击“重新检查”，应用会自动识别。' })
}

function run(task: () => Promise<void>): void {
  if (operation || stopping) return
  operation = task().catch(async error => {
    if (stopping) return
    await service?.close()
    service = undefined
    const message = (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? '本机端口已被占用，请先关闭其他 BetterLearn 实例后重试。'
      : error instanceof Error ? error.message.slice(0, 500) : '启动失败，请检查本机环境后重试。'
    const occupied = message.includes('正在使用该数据目录') || (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    if (state.needsSetup && !occupied && !state.installations.length) await detectPython()
    publish({ phase: 'error', needsSetup: occupied ? false : state.needsSetup, message: occupied
      ? '另一个 BetterLearn 实例或维护任务正在运行。请先关闭它或等待任务完成，再点击“重新检查”。无需重新选择 Python。' : message })
    if (window && !window.isDestroyed() && window.webContents.getURL() !== setupURL) await window.loadURL(setupURL)
  }).finally(() => { operation = undefined })
}

async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  abort.abort()
  try {
    await operation
    await service?.close()
  } catch {
    dialog.showErrorBox('BetterLearn 退出异常', '本地服务未能正常关闭。重新打开应用前，请确认原进程已经退出。')
  } finally {
    stopped = true
    app.quit()
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() } })
  app.on('activate', () => { window?.show(); window?.focus() })
  app.on('before-quit', event => {
    if (stopped) return
    event.preventDefault()
    // Let renderer beforeunload protect unsent work before touching the backend.
    if (window && !window.isDestroyed()) window.close()
    else void shutdown()
  })
  app.on('window-all-closed', () => { void shutdown() })
  void app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      dialog.showErrorBox('暂不支持 Windows', '当前本地数据锁和 Python 环境支持 macOS／Linux。')
      void shutdown(); return
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'BetterLearn', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
    ]))
    window = new BrowserWindow({ title: 'BetterLearn', width: 1280, height: 860, minWidth: 800, minHeight: 600,
      // Chromium must also use a transparent compositor when AppKit clears the window.
      // A clear backgroundColor alone leaves old page pixels in the native surface.
      transparent: process.platform === 'darwin',
      backgroundColor: process.platform === 'darwin' ? '#00000000' : '#edf3fa', show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: { preload: join(moduleDirectory, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    })
    if (process.platform === 'darwin') {
      try { nativeGlass = createRequire(import.meta.url)('./native/glass.node'); nativeGlass?.setGlass(window.getNativeWindowHandle(), 35) }
      catch { nativeGlass = undefined; window.setVibrancy('sidebar') }
    }
    ipcMain.handle('betterlearn:appearance', (event, frost: unknown) => {
      if (!window || !service || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || new URL(event.senderFrame.url).origin !== service.url || typeof frost !== 'number' || !Number.isFinite(frost)) throw new Error('UNTRUSTED_APPEARANCE_REQUEST')
      const active = nativeGlass?.setGlass(window.getNativeWindowHandle(), Math.max(0, Math.min(100, frost))) ?? false
      if (!active && process.platform === 'darwin') window.setVibrancy('sidebar')
      return { nativeGlass: active }
    })
    window.once('ready-to-show', () => window?.show())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (!service || new URL(url).origin !== service.url) event.preventDefault()
    })
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(window!, { type: 'warning', title: '仍有内容未保存',
        message: '学习书仍在保存，或上次保存失败。', detail: '建议返回工作台，等待保存完成或处理错误后再退出。',
        buttons: ['返回工作台', '仍然退出'], defaultId: 0, cancelId: 0,
      })
      if (choice === 1) event.preventDefault()
    })
    window.on('closed', () => { window = undefined; void shutdown() })
    ipcMain.handle('betterlearn:setup-state', event => { assertSetup(event); return state })
    ipcMain.handle('betterlearn:use-python', (event, path: unknown) => {
      assertSetup(event)
      if (!operation && state.needsSetup && typeof path === 'string' && state.installations.some(item => item.path === path)) publish({ python: path })
      return state
    })
    ipcMain.handle('betterlearn:select-python', async event => {
      assertSetup(event)
      if (operation) return state
      const selection = await dialog.showOpenDialog(window!, { title: '选择 Python 3.12', properties: ['openFile'] })
      if (!selection.canceled && selection.filePaths[0]) publish({ python: selection.filePaths[0] })
      return state
    })
    ipcMain.handle('betterlearn:prepare', event => {
      assertSetup(event)
      if (!state.needsSetup) return state
      if (!state.python) throw new Error('请先选择 Python 3.12')
      run(async () => {
        publish({ phase: 'preparing', message: '正在准备学习环境…' })
        const runtime = await prepareDesktopRuntime({ home, packageRoot, python: state.python, signal: abort.signal,
          onProgress: message => publish({ message }),
        })
        if (!stopping) await launchService(runtime)
      })
      return state
    })
    ipcMain.handle('betterlearn:retry', event => { assertSetup(event); run(boot); return state })
    await window.loadURL(setupURL)
    if (!stopping) run(boot)
  }).catch(error => {
    if (stopping) return
    dialog.showErrorBox('BetterLearn 无法启动', error instanceof Error ? error.message : '请重新打开应用。')
    void shutdown()
  })
}
