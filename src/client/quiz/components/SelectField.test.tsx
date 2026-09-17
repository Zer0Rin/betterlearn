import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { SelectField } from './SelectField.js'
import { QuizSetup } from './QuizSetup.js'

function mockDom() {
  const listeners = new Map<string, (event: unknown) => void>()
  vi.stubGlobal('document', { addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) })
  vi.stubGlobal('window', { innerHeight: 600, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  return listeners
}
afterEach(() => vi.unstubAllGlobals())

it('supports keyboard selection, cancellation, outside click and above placement', () => {
  const listeners = mockDom()
  const change = vi.fn()
  let renderer: ReactTestRenderer
  act(() => { renderer = create(<SelectField label="Difficulty" value="easy" options={[{ value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }]} onChange={change} />, { createNodeMock: element => element.type === 'button' ? { getBoundingClientRect: () => ({ top: 530, bottom: 570 }), focus: vi.fn() } : { contains: () => false, children: [] } }) })
  const trigger = () => renderer.root.findByProps({ role: 'combobox' })
  const key = (value: string) => act(() => trigger().props.onKeyDown({ key: value, preventDefault: vi.fn() }))
  key('ArrowDown')
  expect(trigger().props['aria-expanded']).toBe(true)
  expect(renderer!.root.findByProps({ role: 'listbox' }).props.className).toContain('above')
  key('End'); key('Enter')
  expect(change).toHaveBeenCalledWith('hard')
  expect(trigger().props['aria-expanded']).toBe(false)
  key('Enter'); key('ArrowDown'); key('Escape')
  expect(change).toHaveBeenCalledTimes(1)
  key('Enter')
  act(() => listeners.get('pointerdown')?.({ target: {} }))
  expect(trigger().props['aria-expanded']).toBe(false)
  act(() => renderer.unmount())
  expect(listeners.size).toBe(0)
})

it('keeps custom count and difficulty choices in the generation request', () => {
  mockDom()
  const onGenerate = vi.fn()
  let renderer: ReactTestRenderer
  act(() => { renderer = create(<QuizSetup documents={[]} onGenerate={onGenerate} />) })
  const select = (index: number, text: string) => {
    act(() => renderer.root.findAllByProps({ role: 'combobox' })[index].props.onClick())
    act(() => renderer.root.findAllByProps({ role: 'option' }).find(option => option.findByType('span').children[0] === text)!.props.onClick())
  }
  select(0, '3 道题'); select(1, '挑战')
  act(() => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Test topic' } }))
  act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }))
  expect(onGenerate).toHaveBeenCalledWith({ source: { kind: 'topic', text: 'Test topic' }, questionCount: 3, difficulty: 'hard', generateImages: false })
  act(() => renderer.unmount())
})
