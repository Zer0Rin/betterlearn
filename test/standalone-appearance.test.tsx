import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, test, vi } from 'vitest'
import { StandaloneApp } from '../src/standalone/App.js'
import { DEFAULT_GLASS_FROST, GLASS_PREFERENCE_KEY } from '../src/standalone/glass-preference.js'

const settings = {
  text: { baseUrl: 'http://localhost/v1', model: 'fake', apiKeySet: true },
  embedding: { baseUrl: '', model: '', apiKeySet: false },
  image: { baseUrl: '', model: '', apiKeySet: false },
  search: { enabled: false, apiKeySet: false },
}
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

function memory(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear() { data.clear() },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
  }
}

function requests(settingsAvailable = true) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (String(url) === '/api/model') return response({ provider: 'local', model: 'fake' })
    if (String(url) === '/api/library') return response({ books: [], revision: 0 })
    if (String(url) === '/api/settings') return settingsAvailable ? response(settings) : new Response('', { status: 500 })
    throw new Error(`Unexpected request: ${String(url)}`)
  })
}

let root: ReactTestRenderer | undefined
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
})

const workbench = () => root!.root.findByProps({ className: 'workbench-desktop' })
const slider = () => root!.root.findByProps({ id: 'glass-frost' })
async function navigate(label: string) {
  await act(async () => root!.root.findByProps({ 'aria-label': label }).props.onClick())
}
function adjust(frost: number) {
  act(() => slider().props.onChange({ currentTarget: { value: String(frost) } }))
}

test('appearance slider updates the whole workbench immediately without submitting model settings', async () => {
  const request = requests()
  await act(async () => { root = create(<StandaloneApp storage={memory()} fetcher={request as typeof fetch}/>) })
  await navigate('设置')
  expect(slider().props).toMatchObject({ type: 'range', min: '0', max: '100', step: '1', value: DEFAULT_GLASS_FROST })
  const requestCount = request.mock.calls.length

  adjust(0)
  expect(workbench().props['data-glass-frost']).toBe(0)
  expect(workbench().props.style['--glass-blur']).toBe('0.4px')
  expect(workbench().props.style['--glass-tint']).toBeCloseTo(0.08)
  expect(slider().props['aria-valuetext']).toBe('不透明度 0%')

  adjust(100)
  expect(workbench().props['data-glass-frost']).toBe(100)
  expect(workbench().props.style['--glass-blur']).toBe('24px')
  expect(workbench().props.style['--glass-tint']).toBeCloseTo(0.76)
  expect(slider().props['aria-valuetext']).toBe('不透明度 100%')
  expect(request.mock.calls).toHaveLength(requestCount)
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})

test('appearance survives page navigation and a complete app remount', async () => {
  const storage = memory()
  const request = requests()
  await act(async () => { root = create(<StandaloneApp storage={storage} fetcher={request as typeof fetch}/>) })
  await navigate('设置')
  adjust(73)
  const selectedStyle = workbench().props.style
  expect(JSON.parse(storage.getItem(GLASS_PREFERENCE_KEY)!)).toEqual({ version: 1, frost: 73 })

  await navigate('学习空间')
  expect(workbench().props['data-glass-frost']).toBe(73)
  expect(workbench().props.style).toEqual(selectedStyle)
  await navigate('设置')
  expect(slider().props.value).toBe(73)

  act(() => root!.unmount())
  await act(async () => { root = create(<StandaloneApp storage={storage} fetcher={request as typeof fetch}/>) })
  expect(workbench().props['data-glass-frost']).toBe(73)
  expect(workbench().props.style).toEqual(selectedStyle)
  await navigate('设置')
  expect(slider().props.value).toBe(73)
})

test('blocked preference writes show feedback while keeping live appearance adjustments available', async () => {
  const storage = memory()
  storage.setItem(GLASS_PREFERENCE_KEY, JSON.stringify({ version: 1, frost: 40 }))
  const persist = storage.setItem
  storage.setItem = () => { throw new Error('Storage blocked') }
  await act(async () => { root = create(<StandaloneApp storage={storage} fetcher={requests() as typeof fetch}/>) })
  await navigate('设置')

  adjust(75)
  expect(workbench().props['data-glass-frost']).toBe(75)
  expect(slider().props.value).toBe(75)
  const frostedStyle = workbench().props.style
  expect(root!.root.findByProps({ className: 'appearance-save-status' }).children.join('')).toContain('已生效，但浏览器未能保存')

  adjust(20)
  expect(workbench().props['data-glass-frost']).toBe(20)
  expect(workbench().props.style['--glass-tint']).toBeLessThan(frostedStyle['--glass-tint'])
  expect(JSON.parse(storage.getItem(GLASS_PREFERENCE_KEY)!).frost).toBe(40)

  storage.setItem = persist
  adjust(21)
  expect(JSON.parse(storage.getItem(GLASS_PREFERENCE_KEY)!).frost).toBe(21)
  expect(root!.root.findByProps({ className: 'appearance-save-status' }).children.join('')).toContain('自动记住你的选择')
})

test('appearance remains usable when the model settings API fails to load', async () => {
  const request = requests(false)
  const storage = memory()
  await act(async () => { root = create(<StandaloneApp storage={storage} fetcher={request as typeof fetch}/>) })
  await navigate('设置')
  expect(JSON.stringify(root!.toJSON())).toContain('设置加载失败，请重试。')
  expect(slider().props.disabled).not.toBe(true)
  const requestCount = request.mock.calls.length

  adjust(87)
  expect(workbench().props['data-glass-frost']).toBe(87)
  expect(slider().props.value).toBe(87)
  expect(JSON.parse(storage.getItem(GLASS_PREFERENCE_KEY)!).frost).toBe(87)
  expect(request.mock.calls).toHaveLength(requestCount)
})
