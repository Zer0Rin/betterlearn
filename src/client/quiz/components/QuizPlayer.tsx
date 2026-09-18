import { useEffect, useState } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import type { AnswerRecord, QuizData } from '../types.js'
import { isAnswerCorrect } from './quiz-logic.js'

export interface QuizPlayerProps {
  busy?: boolean;
  quiz: QuizData; records: AnswerRecord[]; index: number
  onAnswer(record: AnswerRecord): void; onIndexChange(index: number): void; onFinish(): void
}
export function QuizPlayer({ quiz, records, index, onAnswer, onIndexChange, onFinish, busy }: QuizPlayerProps) {
  const question = quiz.questions[index]
  const record = records.find(item => item.question_id === question?.id)
  const [selected, setSelected] = useState<string[]>(record?.selected_answers ?? [])
  const [started, setStarted] = useState(Date.now())
  useEffect(() => { setSelected(record?.selected_answers ?? []); setStarted(Date.now()) }, [quiz.quiz_id, index, question?.id, record])
  if (!question) return <div className="zl-empty">没有可显示的题目，请重新生成练习。</div>
  function select(key: string) {
    if (record || busy) return
    setSelected(previous => question.type === 'multiple' ? previous.includes(key) ? previous.filter(k => k !== key) : [...previous, key] : [key])
  }
  return <div className="zl-module">
    <header className="zl-heading"><div className="zl-eyebrow">专注练习 · {records.length} / {quiz.questions.length} 已完成</div><h1>{quiz.title}</h1><p>{quiz.summary}</p></header>
    {quiz.image_notice && <p className="zl-notice" role="status">{quiz.image_notice}</p>}
    <div className="zl-quiz-layout"><section className="zl-panel zl-question">
      <div className="zl-question-meta"><span>{({ single:'单选题', multiple:'多选题', judge:'判断题' })[question.type]}</span><span>{({ easy:'入门', medium:'进阶', hard:'挑战' })[question.difficulty]}</span><b>{String(index + 1).padStart(2,'0')} <small>/ {quiz.questions.length}</small></b></div>
      <h2>{question.stem}</h2>
      {question.image_url && <img className="zl-question-image" src={question.image_url} alt="题目辅助配图" />}
      <p className="zl-muted">{question.type === 'multiple' ? '选择所有正确选项' : '选择一个正确选项'}</p>
      <div className="zl-options">{question.options.map(option => {
        const correct = !!record && question.answer.includes(option.key)
        const wrong = !!record && selected.includes(option.key) && !correct
        return <button type="button" key={option.key} aria-pressed={selected.includes(option.key)} disabled={!!record || busy} onClick={() => select(option.key)} className={`zl-option ${selected.includes(option.key) ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrong ? 'wrong' : ''}`}><span className="zl-option-key">{option.key}</span><span>{option.text}</span>{correct && <Check size={18}/>}{wrong && <X size={18}/>}</button>
      })}</div>
      {record ? <div className={`zl-feedback ${record.is_correct ? 'correct' : 'wrong'}`} role="status"><strong>{record.is_correct ? '回答正确' : '再理解一下这个知识点'}</strong><p>正确答案：{question.answer.join('、')}</p><p>{question.explanation}</p><small>知识点 · {question.knowledge_point}</small></div> : null}
      <div className="zl-question-actions"><button className="zl-secondary" disabled={busy || index === 0} onClick={() => onIndexChange(index - 1)}>上一题</button>{record ? <button className="zl-primary" disabled={busy} onClick={() => index === quiz.questions.length - 1 ? onFinish() : onIndexChange(index + 1)}>{index === quiz.questions.length - 1 ? '交卷并查看成绩' : '下一题'}<ArrowRight size={17}/></button> : <button className="zl-primary" disabled={busy || !selected.length} onClick={() => onAnswer({ question_id: question.id, selected_answers: selected, is_correct: isAnswerCorrect(selected, question.answer), duration_ms: Math.max(0, Date.now() - started) })}>确认答案</button>}</div>
    </section><aside className="zl-panel zl-question-map"><h3>本次练习</h3><div className="zl-question-dots">{quiz.questions.map((q,i) => { const answer = records.find(r => r.question_id === q.id); return <button key={q.id} aria-label={`第 ${i+1} 题`} aria-current={i === index ? 'step' : undefined} disabled={busy || i > records.length} className={answer ? answer.is_correct ? 'correct' : 'wrong' : ''} onClick={() => onIndexChange(i)}>{i+1}</button> })}</div><p>先独立思考，再查看解析。做错的题，也是在发现新的学习机会。</p></aside></div>
  </div>
}
