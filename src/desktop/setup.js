const bridge = window.betterlearnSetup
const status = document.getElementById('status')
function render(state) {
  status.textContent = state.message
  status.dataset.error = String(state.phase === 'error')
  document.getElementById('setup').hidden = state.phase === 'loading' || !state.needsSetup
  const list = document.getElementById('python-list')
  list.replaceChildren()
  for (const item of state.installations) {
    const option = document.createElement('option')
    option.value = item.path
    option.textContent = `Python ${item.version} · ${item.path.includes('/homebrew/') ? 'Homebrew' : item.path}`
    list.append(option)
  }
  if (state.python && !state.installations.some(item => item.path === state.python)) {
    const option = document.createElement('option')
    option.value = state.python; option.textContent = '手动指定的 Python（准备时验证版本）'; list.append(option)
  }
  list.value = state.python
  document.getElementById('python-note').textContent = state.python
    ? '已选择可用环境，可直接点击“准备学习环境”。' : '尚未找到 Python 3.12。安装后重新检查即可，无需寻找文件。'
  document.getElementById('python').textContent = state.python || '尚未选择'
  document.getElementById('home').textContent = state.home
  const busy = state.phase === 'preparing' || state.phase === 'loading'
  list.disabled = busy || !state.installations.length
  document.getElementById('choose').disabled = busy
  document.getElementById('prepare').disabled = busy || !state.python
  document.getElementById('retry').disabled = busy
}
async function action(fn) {
  try { render(await fn()) }
  catch { status.textContent = '操作未完成，请重新检查环境后再试。'; status.dataset.error = 'true' }
}
bridge.onState(render)
void action(() => bridge.getState())
document.getElementById('choose').addEventListener('click', () => action(() => bridge.selectPython()))
document.getElementById('prepare').addEventListener('click', () => action(() => bridge.prepare()))
document.getElementById('retry').addEventListener('click', () => action(() => bridge.retry()))

document.getElementById('python-list').addEventListener('change', event => action(() => bridge.usePython(event.target.value)))
