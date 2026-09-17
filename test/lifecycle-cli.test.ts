import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { parseArguments } from '../bin/betterlearn.mjs'
const exec = promisify(execFile)
const cli = resolve('bin/betterlearn.mjs')
const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'betterlearn cli ')); temporary.push(home)
  const log = join(home, 'argv.json')
  const tool = join(home, 'fake executable.mjs')
  await writeFile(tool, `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({argv:process.argv.slice(2), dshHome:process.env.DSH_HOME, data:process.env.NOBEI_PHASE1C_DATA_ROOT, python:process.env.NOBEI_PHASE1C_PYTHON_EXECUTABLE, pythonPath:process.env.PYTHONPATH, token:process.env.NOBEI_PHASE1C_OWNERSHIP_TOKEN, quizPython:process.env.BETTERLEARN_QUIZ_PYTHON_EXECUTABLE, quizEnv:process.env.BETTERLEARN_QUIZ_ENV_FILE, quizData:process.env.BETTERLEARN_QUIZ_DATA_ROOT}));\n`)
  await chmod(tool, 0o700)
  const config = { kind: 'betterlearn-local-v1', dsh: tool, python: tool, dshVersion: '0.1.0-rc.8', dshHome: join(home, 'dsh'), dataRoot: join(home, 'data'), packageRoot: join(home, 'packages', 'current'), ownershipToken: 'private-test-token', packageFile: join(home, 'old.tgz') }
  await writeFile(join(home, 'config.json'), JSON.stringify(config), { mode: 0o600 })
  return { home, log, config }
}
test.each([
  ['install', '--home', '/x'], ['start', '--home', '/x', '--port', '65536'],
  ['backup', '--home', '/x'], ['restore', '--home', '/x'],
  ['start', '--home', '/x', '--unknown', 'x'], ['uninstall', '--home', '/x', '--home', '/y'],
])('rejects invalid lifecycle argv %j', argv => { expect(() => parseArguments(argv)).toThrow() })
test('start isolates profile/environment and safely forwards paths with spaces', async () => {
  const { home, log, config } = await fixture()
  const result = await exec(process.execPath, [cli, 'start', '--home', home, '--port', '3001'])
  const call = JSON.parse(await readFile(log, 'utf8'))
  expect(call).toEqual({ argv: ['--profile', 'betterlearn', '--port', '3001'], dshHome: config.dshHome, data: config.dataRoot, python: config.python, pythonPath: join(config.packageRoot, 'python'), token: config.ownershipToken })
  expect(result.stdout + result.stderr).not.toContain(config.ownershipToken)
})
test.each(['backup', 'restore'])('%s forwards packaged maintenance entry without DSH restart', async command => {
  const { home, log, config } = await fixture()
  const file = join(home, 'backup with spaces.sqlite')
  const result = await exec(process.execPath, [cli, command, '--home', home, command === 'backup' ? '--to' : '--from', file])
  const call = JSON.parse(await readFile(log, 'utf8'))
  expect(call.argv).toEqual(['-m', 'nobei_core.maintenance', command, '--data-root', config.dataRoot,
    ...(command === 'backup' ? ['--to', file] : ['--ownership-token', config.ownershipToken, '--from', file, '--backup-dir', join(home, 'backups')])])
  expect(result.stdout + result.stderr).not.toContain(config.ownershipToken)
  expect((await stat(join(home, 'config.json'))).mode & 0o777).toBe(0o600)
})
test('install refuses unknown existing data before package, Python or DSH writes', async () => {
  const { home, log, config } = await fixture()
  await rm(join(home, 'config.json'))
  await mkdir(config.dataRoot)
  await writeFile(join(config.dataRoot, 'unknown'), 'keep this')
  await expect(exec(process.execPath, [cli, 'install', '--home', home, '--dsh', config.dsh, '--dsh-version', '0.1.0-rc.8', '--package', join(home, 'missing.tgz')])).rejects.toThrow('Refusing to initialize nonempty unknown data directory')
  expect(await readFile(join(config.dataRoot, 'unknown'), 'utf8')).toBe('keep this')
  await expect(stat(log)).rejects.toThrow()
})


test('start forwards SIGTERM and waits for the child to exit without orphaning it', async () => {
  const { home, config } = await fixture()
  const ready = join(home, 'ready')
  const stopped = join(home, 'stopped')
  await writeFile(config.dsh, `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)); process.on('SIGTERM', () => { setTimeout(() => { fs.writeFileSync(${JSON.stringify(stopped)}, 'stopped'); process.exit(0) }, 50) }); setInterval(() => {}, 1000);\n`)
  const child = spawn(process.execPath, [cli, 'start', '--home', home], { stdio: 'ignore' })
  const done = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  try {
    await expect.poll(async () => { try { return await readFile(ready, 'utf8') } catch { return '' } }).not.toBe('')
    const pid = Number(await readFile(ready, 'utf8'))
    child.kill('SIGTERM')
    expect(await done).toEqual({ code: 0, signal: null })
    expect(await readFile(stopped, 'utf8')).toBe('stopped')
    expect(() => process.kill(pid, 0)).toThrow()
  } finally { child.kill('SIGKILL') }
})


test('start forwards managed quiz paths from config and clears inherited quiz settings for legacy installs', async () => {
  const { home, log, config } = await fixture()
  const inherited = { ...process.env, BETTERLEARN_QUIZ_ENV_FILE: '/unrelated/secret.env' }
  await exec(process.execPath, [cli, 'start', '--home', home], { env: inherited })
  expect(JSON.parse(await readFile(log, 'utf8')).quizEnv).toBeUndefined()
  const quiz = { quizPythonExecutable: join(home, 'quiz-venv/bin/python'), quizEnvFile: join(home, 'quiz.env'), quizDataRoot: join(home, 'quiz-data') }
  await writeFile(join(home, 'config.json'), JSON.stringify({ ...config, ...quiz }))
  await exec(process.execPath, [cli, 'start', '--home', home], { env: inherited })
  expect(JSON.parse(await readFile(log, 'utf8'))).toMatchObject({ quizPython: quiz.quizPythonExecutable, quizEnv: quiz.quizEnvFile, quizData: quiz.quizDataRoot })
})

test.each(['upgrade', 'install', 'fresh-install'])('%s prepares isolated quiz runtime and preserves env on repeat', async mode => {
  const command = mode === 'fresh-install' ? 'install' : mode
  const { home, config } = await fixture()
  if (mode === 'fresh-install') await rm(join(home, 'config.json'))
  const calls = join(home, 'calls.jsonl')
  // Emulates only process boundaries; no pip, MySQL or user installations are touched.
  const fake = `#!${process.execPath}\nimport fs from 'node:fs'; import {spawnSync} from 'node:child_process'; import path from 'node:path';
const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({exe:process.argv[1],args})+'\\n');
if(args[0]==='-m' && args[1]==='venv'){const target=path.join(args[2],'bin/python');fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(process.argv[1],target);fs.chmodSync(target,0o700)}
if(args[0]==='-c' && args[1].includes('json.load(sys.stdin)')){for(const argv of JSON.parse(fs.readFileSync(0,'utf8'))){const r=spawnSync(argv[0],argv.slice(1),{env:process.env,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1)}}
`
  await writeFile(config.python, fake)
  await mkdir(join(home, 'venv/bin'), { recursive: true })
  await writeFile(join(home, 'venv/bin/python'), fake, { mode: 0o700 })
  const stage = join(home, 'fixture/package')
  await mkdir(join(stage, 'python/nobei_core'), { recursive: true })
  await mkdir(join(stage, 'services/quiz/app'), { recursive: true })
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name: '@nobei/dsh-phase1' }))
  for (const name of ['python/requirements-phase1.lock', 'python/nobei_core/maintenance.py', 'services/quiz/requirements.txt', 'services/quiz/run_managed.py', 'services/quiz/app/main.py']) await writeFile(join(stage, name), '')
  await writeFile(join(stage, 'services/quiz/.env.example'), 'MYSQL_PASSWORD=\nJWT_SECRET=change-me\nDEEPSEEK_MODEL=deepseek-chat\n')
  const tarball = join(home, 'new.tgz')
  await exec('tar', ['-czf', tarball, '-C', join(home, 'fixture'), 'package'])
  const argv = [cli, command, '--home', home, '--package', tarball, ...(command === 'install' ? ['--dsh', config.dsh, '--dsh-version', '0.1.0-rc.8', '--python', config.python] : [])]
  await exec(process.execPath, argv)
  const updated = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))
  expect(updated.quizPythonExecutable).toBe(join(home, 'quiz-venv/bin/python'))
  expect(updated.quizDataRoot).toBe(join(home, 'quiz-data'))
  expect(updated.quizEnvFile).toBe(join(home, 'quiz.env'))
  expect((await stat(updated.quizEnvFile)).mode & 0o777).toBe(0o600)
  expect(await readFile(updated.quizEnvFile, 'utf8')).toMatch(/JWT_SECRET=[a-f0-9]{64}/)
  const secret = 'DEEPSEEK_MODEL=my-existing-model\nJWT_SECRET=keep-my-secret\n'
  await writeFile(updated.quizEnvFile, secret)
  await exec(process.execPath, argv)
  expect(await readFile(updated.quizEnvFile, 'utf8')).toBe(secret)
  const history = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(history.filter(call => call.exe === updated.quizPythonExecutable && call.args.includes('pip'))).toHaveLength(2)
  expect(history.some(call => call.args.includes(join(updated.packageRoot, 'services/quiz/requirements.txt')))).toBe(true)
})


test.each([{ quizEnvFile: '/a/quiz.env' }, { quizPythonExecutable: 'relative/python', quizEnvFile: '/a/quiz.env', quizDataRoot: '/a/data' }])('rejects incomplete or relative quiz config before starting DSH', async quiz => {
  const { home, log, config } = await fixture()
  await writeFile(join(home, 'config.json'), JSON.stringify({ ...config, ...quiz }))
  await expect(exec(process.execPath, [cli, 'start', '--home', home])).rejects.toThrow('Invalid quiz configuration')
  await expect(stat(log)).rejects.toThrow()
})
