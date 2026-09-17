import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { it, expect } from 'vitest'
import { QuizReport } from './QuizReport.js'
import type { AnswerRecord, QuizData } from '../types.js'
const quiz: QuizData = { quiz_id: 'quiz1', title: 'one', summary: '', questions: [
  { id: 'q1', stem: 'Question 1', type: 'single', options: [{ key:'A', text:'one' },{ key:'B', text:'two' }], answer:['A'], explanation:'explanation', knowledge_point:'point', difficulty:'easy' },
  { id: 'q2', stem: 'Question 2', type: 'single', options: [{ key:'A', text:'one' },{ key:'B', text:'two' }], answer:['A'], explanation:'explanation', knowledge_point:'point', difficulty:'easy' },
] }
const record = (question_id: string, is_correct: boolean): AnswerRecord => ({ question_id, selected_answers:['A'], is_correct, duration_ms: 1000 })
function render(records: AnswerRecord[]) {
  let renderer: ReactTestRenderer
  act(() => { renderer = create(<QuizReport quiz={quiz} records={records} onRestart={() => {}}/>) })
  return renderer!
}
const texts = (node: { children?: unknown }): string[] =>
  (Array.isArray(node.children) ? node.children : []).flatMap(c => typeof c === 'string' ? [c] : c && typeof c === 'object' && 'children' in c ? texts(c as { children?: unknown }) : [])
const text = (renderer: ReactTestRenderer) => texts(renderer.root.findAllByType('h1')[0]).join('')
const tags = (renderer: ReactTestRenderer) => renderer.root.findAll(n => typeof n.props.className === 'string' && /zl-tag|zl-xp-badge/.test(n.props.className)).map(n => texts(n).join(''))

it('shows the measured accuracy in the heading', () => {
  expect(text(render([record('q1', true), record('q2', true)]))).toBe('正确率 100%')
  expect(text(render([record('q1', true), record('q2', false)]))).toBe('正确率 50%')
  expect(text(render([record('q1', false), record('q2', false)]))).toBe('正确率 0%')
})

it('shows the correct/wrong tags and the XP gained using the backend rule', () => {
  const one = tags(render([record('q1', true), record('q2', false)]))
  expect(one).toContain('答对 1 题')
  expect(one).toContain('答错 1 题')
  expect(one).toContain('+12 XP')
  expect(tags(render([record('q1', true), record('q2', true)]))).toContain('+14 XP')
})

it('omits the XP badge when nothing has been answered', () => {
  expect(tags(render([]))).not.toContain('+10 XP')
})
