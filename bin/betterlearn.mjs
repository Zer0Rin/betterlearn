#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, chmod, mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = '@nobei/dsh-phase1'
const PROFILE = 'betterlearn'
const USAGE = `betterlearn install --home DIR --dsh FILE --dsh-version VERSION --python PYTHON3.12 --package FILE.tgz
betterlearn start --home DIR [--port N]
betterlearn backup --home DIR --to FILE.sqlite
betterlearn restore --home DIR --from FILE.sqlite
betterlearn upgrade --home DIR --package FILE.tgz
betterlearn uninstall --home DIR`
const OPTIONS = {
  install: ['home', 'dsh', 'dsh-version', 'python', 'package'], start: ['home', 'port'],
  backup: ['home', 'to'], restore: ['home', 'from'], upgrade: ['home', 'package'], uninstall: ['home'],
}
export function parseArguments(argv) {
  const [command, ...rest] = argv
  if (!OPTIONS[command]) throw new Error(USAGE)
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '')
    if (!rest[i]?.startsWith('--') || !OPTIONS[command].includes(key) || key in options || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(USAGE)
    options[key] = rest[i + 1]
  }
  if (!options.home) throw new Error(USAGE)
  if (command === 'install' && (!options.dsh || !options['dsh-version'] || !options.package)) throw new Error(USAGE)
  if (command === 'backup' && !options.to || command === 'restore' && !options.from || command === 'upgrade' && !options.package) throw new Error(USAGE)
  if (options['dsh-version'] && !['0.1.0-rc.7', '0.1.0-rc.8'].includes(options['dsh-version'])) throw new Error('Only DSH 0.1.0-rc.7 / 0.1.0-rc.8 are supported.')
  if (options.port && (!/^\d+$/.test(options.port) || Number(options.port) > 65535)) throw new Error('Invalid port.')
  return { command, options }
}

function run(executable, args, { env = process.env, cwd, input, forwardSignals = false } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'] })
    let requestedSignal
    const forward = signal => { requestedSignal = signal; child.kill(signal) }
    const onInterrupt = () => forward('SIGINT')
    const onTerminate = () => forward('SIGTERM')
    const cleanup = () => {
      if (forwardSignals) { process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate) }
    }
    if (forwardSignals) { process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate) }
    child.once('error', () => { cleanup(); reject(new Error(`Cannot run ${executable}.`)) })
    child.once('exit', (code, signal) => {
      cleanup()
      if (code === 0 || requestedSignal || signal === 'SIGINT') done()
      else reject(new Error(`Command failed (${code ?? signal}): ${executable}`))
    })
    if (input !== undefined) child.stdin.end(input)
  })
}
function environment(config) {
  return { ...process.env, DSH_HOME: config.dshHome, PYTHONPATH: join(config.packageRoot, 'python'),
    NOBEI_PHASE1C_PYTHON_EXECUTABLE: config.python, NOBEI_PHASE1C_DATA_ROOT: config.dataRoot,
    NOBEI_PHASE1C_OWNERSHIP_TOKEN: config.ownershipToken,
    BETTERLEARN_QUIZ_PYTHON_EXECUTABLE: config.quizPythonExecutable,
    BETTERLEARN_QUIZ_ENV_FILE: config.quizEnvFile, BETTERLEARN_QUIZ_DATA_ROOT: config.quizDataRoot }
}
async function saveConfig(home, config) {
  const target = join(home, 'config.json')
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, target)
  await chmod(target, 0o600)
}
async function loadConfig(home) {
  const config = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))
  if (config.kind !== 'betterlearn-local-v1' || !config.ownershipToken || !isAbsolute(config.dataRoot)) throw new Error('Invalid BetterLearn configuration.')
  const quizPaths = [config.quizPythonExecutable, config.quizEnvFile, config.quizDataRoot]
  if (quizPaths.some(value => value !== undefined) && !quizPaths.every(value => typeof value === 'string' && isAbsolute(value))) throw new Error('Invalid quiz configuration: all three paths must be absolute or omitted.')
  return config
}
async function stagePackage(home, tarball) {
  const stage = join(home, 'packages', randomUUID())
  await mkdir(stage, { recursive: true })
  await run('tar', ['-xzf', resolve(tarball), '-C', stage])
  const packageRoot = join(stage, 'package')
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== NAME) throw new Error('The tarball is not the BetterLearn DSH plugin.')
  await access(join(packageRoot, 'python', 'requirements-phase1.lock'))
  await access(join(packageRoot, 'python', 'nobei_core', 'maintenance.py'))
  return packageRoot
}
const pipArgs = packageRoot => ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(packageRoot, 'python', 'requirements-phase1.lock')]
// The quiz service has an independent dependency graph and persistent data directory.
async function prepareQuiz(home, config, packageRoot) {
  const quizPythonExecutable = config.quizPythonExecutable ?? join(home, 'quiz-venv', 'bin', 'python')
  const quizEnvFile = config.quizEnvFile ?? join(home, 'quiz.env')
  const quizDataRoot = config.quizDataRoot ?? join(home, 'quiz-data')
  for (const file of ['requirements.txt', 'run_managed.py', 'app/main.py', '.env.example']) await access(join(packageRoot, 'services', 'quiz', file))
  await mkdir(quizDataRoot, { recursive: true, mode: 0o700 })
  const template = await readFile(join(packageRoot, 'services', 'quiz', '.env.example'), 'utf8')
  try {
    await writeFile(quizEnvFile, template.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(32).toString('hex')}`), { flag: 'wx', mode: 0o600 })
  } catch (error) { if (error.code !== 'EEXIST') throw error }
  await chmod(quizEnvFile, 0o600)
  const commands = []
  try { await access(quizPythonExecutable, constants.X_OK) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (config.quizPythonExecutable) throw new Error('Configured quiz Python is missing; restore that environment before upgrading.')
    commands.push([config.python, '-m', 'venv', join(home, 'quiz-venv')])
  }
  commands.push([quizPythonExecutable, '-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(packageRoot, 'services', 'quiz', 'requirements.txt')])
  return { config: { ...config, quizPythonExecutable, quizEnvFile, quizDataRoot }, commands }
}
const addArgs = packageFile => ['plugin', '--profile', PROFILE, 'add', packageFile]
const maintenanceArgs = (command, config, extra) => ['-m', 'nobei_core.maintenance', command, '--data-root', config.dataRoot, ...extra]

// Hold the same Core lease throughout upgrade/uninstall. A concurrent start is rejected.
async function locked(config, commands) {
  const script = `import json, os, subprocess, sys\nfrom nobei_core.ownership import CoreLease\nlease = CoreLease.acquire(os.environ['NOBEI_PHASE1C_DATA_ROOT'], os.environ['NOBEI_PHASE1C_OWNERSHIP_TOKEN'])\ntry:\n for argv in json.load(sys.stdin):\n  subprocess.run(argv, check=True)\nfinally:\n lease.close()\n`
  await run(config.python, ['-c', script], { env: environment(config), input: JSON.stringify(commands) })
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === '--help') { console.log(USAGE); return }
  const { command, options } = parseArguments(argv)
  const home = resolve(options.home)
  if (command === 'install') {
    await mkdir(home, { recursive: true, mode: 0o700 })
    let config
    try { config = await loadConfig(home) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const dsh = resolve(options.dsh)
    await access(dsh, constants.X_OK)
    const dataRoot = join(home, 'data')
    await mkdir(dataRoot, { recursive: true, mode: 0o700 })
    if (!config && (await readdir(dataRoot)).length) throw new Error('Refusing to initialize nonempty unknown data directory.')
    const packageRoot = await stagePackage(home, options.package)
    const bootstrapPython = options.python ?? 'python3.12'
    await run(bootstrapPython, ['-c', "import sys; assert sys.version_info[:2] == (3, 12), 'Python 3.12 required'"])
    const venv = join(home, 'venv')
    if (!config) await run(bootstrapPython, ['-m', 'venv', venv])
    const python = join(venv, 'bin', 'python')
    const isNew = !config
    config = { ...config, kind: 'betterlearn-local-v1', dsh, dshVersion: options['dsh-version'],
      dshHome: join(home, 'dsh'), dataRoot, python, packageRoot, packageFile: resolve(options.package),
      ownershipToken: config?.ownershipToken ?? randomBytes(32).toString('hex') }
    const env = environment(config)
    if (isNew) await run(python, pipArgs(packageRoot), { env })
    if (isNew) await run(python, ['-c', "import os; from nobei_core.ownership import initialize_owned_root; initialize_owned_root(os.environ['NOBEI_PHASE1C_DATA_ROOT'], os.environ['NOBEI_PHASE1C_OWNERSHIP_TOKEN'])"], { env })
    if (isNew) await saveConfig(home, config)
    if (isNew) await run(python, ['-c', "import os; from nobei_core.database import Phase1Database; db = Phase1Database.open(os.environ['NOBEI_PHASE1C_DATA_ROOT'], os.environ['NOBEI_PHASE1C_OWNERSHIP_TOKEN']); db.close()"], { env })
    const quiz = await prepareQuiz(home, config, packageRoot)
    config = quiz.config
    await locked(config, [
      ...quiz.commands,
      ...(!isNew ? [[python, ...pipArgs(packageRoot)]] : []),
      [dsh, ...addArgs(`@deepseek-ai/dsh-base@${config.dshVersion}`)],
      [dsh, ...addArgs(`@deepseek-ai/dsh-web-app@${config.dshVersion}`)],
      [dsh, ...addArgs(config.packageFile)],
    ])
    await saveConfig(home, config)
    console.log(`Installed BetterLearn. Start: betterlearn start --home ${JSON.stringify(home)}`)
    return
  }
  const config = await loadConfig(home)
  const env = environment(config)
  if (command === 'start') {
    await run(config.dsh, ['--profile', PROFILE, ...(options.port ? ['--port', options.port] : [])], { env, forwardSignals: true })
  } else if (command === 'backup') {
    await run(config.python, maintenanceArgs('backup', config, ['--to', resolve(options.to)]), { env })
  } else if (command === 'restore') {
    await run(config.python, maintenanceArgs('restore', config, ['--ownership-token', config.ownershipToken, '--from', resolve(options.from), '--backup-dir', join(home, 'backups')]), { env })
  } else if (command === 'upgrade') {
    const packageRoot = await stagePackage(home, options.package)
    await mkdir(join(home, 'backups'), { recursive: true })
    const backup = join(home, 'backups', `before-upgrade-${Date.now()}-${randomUUID()}.sqlite`)
    const quiz = await prepareQuiz(home, config, packageRoot)
    await locked(quiz.config, [
      [config.python, ...maintenanceArgs('backup', config, ['--to', backup])],
      [config.python, ...pipArgs(packageRoot)],
      ...quiz.commands,
      [config.dsh, ...addArgs(resolve(options.package))],
    ])
    await saveConfig(home, { ...quiz.config, packageRoot, packageFile: resolve(options.package) })
    console.log(`Upgrade complete. Previous data backup: ${backup}`)
  } else if (command === 'uninstall') {
    await locked(config, [[config.dsh, 'plugin', '--profile', PROFILE, 'remove', NAME]])
    console.log(`Plugin removed. Data, backups and configuration preserved in ${home}`)
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
