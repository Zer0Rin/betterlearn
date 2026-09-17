export function isAnswerCorrect(selected: string[], answer: string[]) {
  const choices = new Set(selected)
  return choices.size > 0 && choices.size === answer.length && answer.every(key => choices.has(key))
}
