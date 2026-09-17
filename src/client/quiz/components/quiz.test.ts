import { it, expect } from 'vitest'
import { isAnswerCorrect } from './quiz-logic.js'
it('requires exactly all correct choices, independently of selection order', () => {
  expect(isAnswerCorrect(['B','A'], ['A','B'])).toBe(true)
  expect(isAnswerCorrect(['A'], ['A','B'])).toBe(false)
  expect(isAnswerCorrect(['A','B','C'], ['A','B'])).toBe(false)
  expect(isAnswerCorrect([], ['A'])).toBe(false)
})
