import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { it, expect } from 'vitest'
import { QuizReport } from './QuizReport.js'
import type { AnswerRecord, QuizData } from '../types.js'
const quiz: QuizData = { quiz_id: 'quiz1', title: 'one', summary: '', questions: [
  { id: 'q1', stem: 'Question 1', type: 'single', options: [{ key:'A', text:'one' },{ key:'B', text:'two' }], answer:['A'], explanation:'explanation', knowledge_point:'point', difficulty:'easy' },
  { id: 'q2', stem: 'Question 2', type: 'single', options: [{ key:'A', text:'one' },{ key:'B', text:'two' }], answer:['A'], explanation:'explanation', knowledge_point:'point', difficulty:'easy' },
] }
const record = (question_id: string, is_correct: boolean): AnswerRecord => ({ question_id, selected_answers:['A'], is_correct, duration_ms: 1000 })
function render(records: AnswerRecord[], score?: {accuracy:number; correct_count:number; total_questions:number; xp_gain:number}) {
  let renderer: ReactTestRenderer
  act(() => { renderer = create(<QuizReport quiz={quiz} records={records} score={score} onRestart={() => {}}/>) })
  return renderer!
}
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
it('uses authoritative scores and preserves zero XP on repeated practice', () => {
  const view=render([record('q1',true),record('q2',true)],{accuracy:0,correct_count:0,total_questions:2,xp_gain:0})
  expect(view.root.findByProps({className:'zl-xp-badge'}).children.join('')).toBe('+0 XP')
  expect(view.root.findByType('h1').children.join('')).toBe('正确率 0%')
})
it('does not claim an unsubmitted local result is saved or award XP', () => {
  const view=render([record('q1',true)])
  expect(view.root.findByType('h1').children.join('')).toBe('尚未交卷')
  expect(view.root.findAllByProps({className:'zl-xp-badge'})).toHaveLength(0)
})
it('shows saved results with an explicit independent AI report action', () => {
  const view=render([record('q1',false)],{accuracy:0,correct_count:0,total_questions:2,xp_gain:0})
  expect(text(view)).toContain('成绩已保存')
  expect(text(view)).toContain('生成 AI 报告')
  expect(text(view)).not.toContain('当前标签页')
})
