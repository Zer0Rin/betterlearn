import { verifyDesktopLearning, verifyDesktopLearningRestart } from './verify-desktop-learning.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { _electron as electron } from '@playwright/test'
import { build } from 'esbuild'
import { execFileSync, spawn } from 'node:child_process'

// Opt-in real desktop verification. Uses only temporary data and a fake provider.
await access('dist/desktop/main.mjs')
const root = await mkdtemp(join(tmpdir(), 'betterlearn-desktop-'))
let app, fake, lockHolder, failed = false
const rendererErrors = []
async function closeDesktop() {
  const current = app
  if (!current) return
  const closed = current.waitForEvent('close', { timeout: 30000 })
  void closed.catch(() => {})
  await current.evaluate(({ app }) => app.quit()).catch(() => {})
  await closed
  app = undefined
}
try {
  const fixture = join(root, 'provider.mjs')
  await build({ entryPoints: ['test/fixtures/standalone-provider.ts'], outfile: fixture, bundle: true, platform: 'node', format: 'esm' })
  const providerFixture = await import(pathToFileURL(fixture).href)
  fake = await providerFixture.startFakeProvider()
  const home = join(root, 'home')
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const env = { ...process.env, BETTERLEARN_HOME: home, BETTERLEARN_PORT: String(port) }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.BETTERLEARN_PYTHON
  delete env.BETTERLEARN_QUIZ_PYTHON
  const launch = () => electron.launch({
    ...(process.env.BETTERLEARN_DESKTOP_EXECUTABLE
      ? { executablePath: resolve(process.env.BETTERLEARN_DESKTOP_EXECUTABLE), args: [] }
      : { args: [resolve('dist/desktop/main.mjs')] }), env,
  })
  app = await launch()
  let page = await app.firstWindow()
  await page.getByRole('button', { name: '准备学习环境' }).waitFor({ timeout: 30000 })
  assert.match(await page.locator('body').innerText(), /Python 3.12/)
  await page.waitForFunction(() => document.querySelector('#python-list').options.length > 0)
  assert.ok(await page.locator('#python-list').inputValue())
  assert.equal(await page.locator('details').getAttribute('open'), null)
  assert.equal(await page.locator('#prepare').isEnabled(), true)
  await mkdir('dist/desktop-verification', { recursive: true })
  await page.screenshot({ path: 'dist/desktop-verification/setup.png' })
  await closeDesktop()
  await assert.rejects(access(join(home, 'runtime.json')))

  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'runtime.json'), JSON.stringify({
    pythonExecutable: resolve('.venv-phase1b/bin/python'),
    quizPythonExecutable: resolve('services/quiz/.venv/bin/python'),
  }))
  lockHolder = spawn(resolve('.venv-phase1b/bin/python'), ['-c', "import fcntl,sys; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); print('ready',flush=True); sys.stdin.read()", join(home,'.app.lock')])
  await new Promise((resolve, reject) => { lockHolder.stdout.once('data', resolve); lockHolder.once('error', reject) })
  app = await launch()
  page = await app.firstWindow()
  await page.getByText(/无需重新选择 Python/).waitFor({timeout:60000})
  assert.equal(await page.locator('#setup').isVisible(), false)
  assert.equal(await page.getByRole('button', {name:'重新检查'}).isEnabled(), true)
  await page.screenshot({path:'dist/desktop-verification/occupied.png'})
  await closeDesktop()
  const unlocked = new Promise(resolve => lockHolder.once('close', resolve))
  lockHolder.stdin.end(); await unlocked; lockHolder = undefined
  app = await launch()
  page = await app.firstWindow()
  page.on('pageerror', error => rendererErrors.push(error.message))
  await page.waitForURL('http://127.0.0.1:**', { timeout: 60000 })
  await page.getByRole('button', { name: '设置', exact: true }).waitFor({ timeout: 30000 })
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await assert.rejects(page.evaluate(() => window.betterlearnSetup.getState()), /UNTRUSTED/)
  await page.waitForFunction(() => document.documentElement.dataset.desktop)
  assert.equal(await page.locator('.workbench-window-actions').count(), 0)
  if (process.platform === 'darwin') {
    assert.deepEqual(await page.evaluate(() => window.betterlearnDesktop.setFrost(0)), {nativeGlass:true})
    assert.deepEqual(await page.evaluate(() => window.betterlearnDesktop.setFrost(100)), {nativeGlass:true})
    await assert.rejects(page.evaluate(() => window.betterlearnDesktop.setFrost('bad')), /UNTRUSTED/)
  }
  const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
  assert.equal(prefs.nodeIntegration, false)
  assert.equal(prefs.contextIsolation, true)
  assert.equal(prefs.sandbox, true)
  await page.evaluate(() => localStorage.setItem('desktop-verification', 'persisted'))

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('文本模型服务地址', { exact: true }).fill(fake.url)
  await page.getByLabel('文本模型名称', { exact: true }).fill('fake')
  await page.getByLabel('文本模型密钥', { exact: true }).fill('desktop-secret')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByText('设置已保存。新的任务将使用更新后的模型。', { exact: true }).waitFor()
  const settings = await page.evaluate(async () => {
    const response = await fetch('/api/settings')
    return { status: response.status, body: await response.json() }
  })
  assert.equal(settings.status, 200)
  assert.equal(settings.body.text.apiKeySet, true)
  assert.ok(!JSON.stringify(settings.body).includes('desktop-secret'))
  await page.getByRole('button', { name: '开始练习', exact: true }).click()
  await page.getByLabel('练习内容', { exact: true }).fill('光合作用')
  await page.getByRole('combobox', { name: /题目数量/ }).click()
  await page.getByRole('option', { name: '3 道题', exact: true }).click()
  await page.getByRole('button', { name: '生成练习', exact: true }).click()
  await page.getByRole('heading', { name: '第1题：光合作用将光能转化为什么？' }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'A 化学能', exact: true }).click()
  await page.getByRole('button', { name: '确认答案', exact: true }).click()
  await page.getByText('回答正确', { exact: true }).waitFor()
  await mkdir('dist/desktop-verification', { recursive: true })
  await page.screenshot({ path: 'dist/desktop-verification/quiz.png' })
  assert.ok(fake.calls.length > 0)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('文本模型名称', { exact: true }).waitFor()
  await mkdir('dist/desktop-verification', { recursive: true })
  await page.screenshot({ path: 'dist/desktop-verification/settings.png' })
  if (process.platform === 'darwin') {
    const id = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getMediaSourceId().split(':')[1])
    execFileSync('/usr/sbin/screencapture',['-x','-l',id,'dist/desktop-verification/native-window.png'])
    for (const frost of [0,100]) {
      await page.locator('#glass-frost').fill(String(frost))
      await page.waitForTimeout(500)
      execFileSync('/usr/sbin/screencapture',['-x','-l',id,`dist/desktop-verification/native-glass-${frost}.png`])
    }
  }
  const background = page.locator('#glass-frost')
  const components = page.locator('#component-opacity')
  await background.fill('20')
  await components.fill('90')
  assert.equal(await background.inputValue(), '20')
  const fills = () => page.evaluate(() => ({
    main:getComputedStyle(document.querySelector('.standalone-main')).backgroundColor,
    card:getComputedStyle(document.querySelector('.appearance-settings')).backgroundColor,
    text:getComputedStyle(document.querySelector('.appearance-settings')).opacity,
  }))
  async function captureLayers(name) {
    if (process.platform !== 'darwin') return
    await page.waitForTimeout(250)
    const id = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getMediaSourceId().split(':')[1])
    execFileSync('/usr/sbin/screencapture',['-x','-l',id,`dist/desktop-verification/${name}.png`])
  }
  await captureLayers('layers-background20-components90')
  const dense = await fills()
  assert.equal(dense.main, 'rgba(0, 0, 0, 0)')
  assert.equal(dense.text, '1')
  await components.fill('25')
  assert.equal(await background.inputValue(), '20')
  assert.notEqual((await fills()).card, dense.card)
  await captureLayers('layers-background20-components25')
  await background.fill('80')
  assert.equal(await components.inputValue(), '25')
  assert.equal((await fills()).text, '1')
  await background.fill('20'); await components.fill('90')
  const mcp = new Client({name:'desktop-mcp-verifier',version:'1.0'})
  try {
    const mcpScript = process.env.BETTERLEARN_DESKTOP_EXECUTABLE
      ? resolve(process.env.BETTERLEARN_DESKTOP_EXECUTABLE,'../../Resources/standalone/mcp.mjs')
      : resolve('dist/standalone/mcp.mjs')
    await mcp.connect(new StdioClientTransport({command:process.execPath,args:[mcpScript,'--home',home],stderr:'pipe'}))
    const history = await mcp.callTool({name:'betterlearn_list_quizzes',arguments:{}})
    assert.ok(!history.isError)
    assert.equal(JSON.parse(history.content[0].text).total,1)
  } finally { await mcp.close() }
  const learning = await verifyDesktopLearning(page, providerFixture.sourceText)
  await captureLayers('exam-draft-native')
  const calls = fake.calls.length
  await page.evaluate(() => fetch('/nobei/quiz/v1/user/quizzes').then(r => r.json()))
  assert.equal(fake.calls.length, calls)
  const origin = new URL(page.url()).origin
  await closeDesktop()
  await assert.rejects(fetch(origin + '/api/settings'))
  // Starting again exercises data-lock release and persisted runtime/data.
  app = await launch()
  page = await app.firstWindow()
  await page.waitForURL('http://127.0.0.1:**', { timeout: 60000 })
  page.on('pageerror', error => rendererErrors.push(error.message))
  const saved = await page.evaluate(() => fetch('/api/settings').then(r => r.json()))
  assert.equal(saved.text.apiKeySet, true)
  assert.equal(await page.evaluate(() => localStorage.getItem('desktop-verification')), 'persisted')
  await page.getByRole('button', {name:'设置',exact:true}).click()
  assert.equal(await page.locator('#glass-frost').inputValue(), '20')
  assert.equal(await page.locator('#component-opacity').inputValue(), '90')
  await verifyDesktopLearningRestart(page, learning)
  await captureLayers('knowledge-history-native')
  assert.equal(fake.calls.length, calls)
  assert.deepEqual(rendererErrors, [], 'Renderer must not raise uncaught errors')
  console.log('Desktop verified: first run, secure window, own API quiz generation, secret masking, source generation, goals, reviewed exam draft/restart/submission, knowledge statistics, no automatic report, clean restart.')
} catch (error) {
  failed = true
  if (app) {
    const page = app.windows()[0]
    if (page) {
      console.error(await page.locator('body').innerText().catch(() => 'Page unavailable'))
      await page.screenshot({ path: 'dist/desktop-verification/failure.png' }).catch(() => {})
    }
  }
  throw error
} finally {
  lockHolder?.stdin.end()
  const cleanup = await Promise.allSettled([closeDesktop(), fake?.close()])
  if(app?.process().exitCode === null)app.process().kill('SIGKILL')
  await rm(root, { recursive: true, force: true }).catch(error => { if(!failed)throw error })
  if(!failed) { const error=cleanup.find(result=>result.status==='rejected'); if(error)throw error.reason }
}
