import { act, create } from 'react-test-renderer'
import { afterEach, expect, test, vi } from 'vitest'
import { QuickNavigation } from '../src/standalone/QuickNavigation.js'
afterEach(() => vi.unstubAllGlobals())
test('filters navigation actions and activates only the matching destination', () => {
  vi.stubGlobal('window', {addEventListener:vi.fn(),removeEventListener:vi.fn()})
  const library=vi.fn(), settings=vi.fn()
  const root=create(<QuickNavigation actions={[{label:'学习空间',onSelect:library},{label:'设置',onSelect:settings}]}/> )
  act(()=>root.root.findByType('input').props.onChange({currentTarget:{value:' 设置 '}}))
  expect(root.root.findByProps({className:'workspace-command-results'}).findAllByType('button')).toHaveLength(1)
  act(()=>root.root.findByType('input').props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault:vi.fn()}))
  expect(settings).toHaveBeenCalledTimes(1)
  expect(library).not.toHaveBeenCalled()
  act(()=>root.unmount())
})
test('does not navigate while confirming an IME composition or when no result matches', () => {
  vi.stubGlobal('window', {addEventListener:vi.fn(),removeEventListener:vi.fn()})
  const select=vi.fn()
  const root=create(<QuickNavigation actions={[{label:'知识提取',onSelect:select}]}/> )
  act(()=>root.root.findByType('input').props.onKeyDown({key:'Enter',nativeEvent:{isComposing:true},preventDefault:vi.fn()}))
  act(()=>root.root.findByType('input').props.onChange({currentTarget:{value:'xyz'}}))
  act(()=>root.root.findByType('input').props.onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault:vi.fn()}))
  expect(select).not.toHaveBeenCalled()
  expect(root.root.findByProps({role:'status'}).children.join('')).toContain('没有找到相关页面')
  act(()=>root.unmount())
})
