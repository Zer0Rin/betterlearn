import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { it, expect, vi } from 'vitest'
import { QuizPlayer } from './QuizPlayer.js'
import type { QuizData } from '../types.js'
const quiz: QuizData = { quiz_id: 'quiz1', title: 'one', summary: '', questions: [{ id: 'q1', stem: 'Question', type: 'single', options: [{ key:'A', text:'one' },{ key:'B', text:'two' }], answer:['A'], explanation:'explanation', knowledge_point:'point', difficulty:'easy' }] }
it('clears selected answers when host replaces quiz with reused question IDs', () => {
  const callbacks = { onAnswer:vi.fn(), onIndexChange:vi.fn(), onFinish:vi.fn() }
  let renderer: ReactTestRenderer
  act(() => { renderer = create(<QuizPlayer quiz={quiz} records={[]} index={0} {...callbacks}/>) })
  const selected = () => renderer.root.findAllByType('button').filter(b => b.props['aria-pressed'] === true)
  act(() => renderer.root.findAllByType('button').find(b => b.props['aria-pressed'] === false)!.props.onClick())
  expect(selected()).toHaveLength(1)
  act(() => renderer.update(<QuizPlayer quiz={{ ...quiz,quiz_id:'quiz2' }} records={[]} index={0} {...callbacks}/>))
  expect(selected()).toHaveLength(0)
  act(() => renderer.unmount())
})
