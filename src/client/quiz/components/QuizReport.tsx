import { ArrowRight, CheckCircle2, XCircle } from 'lucide-react'
import type { AnswerRecord, QuizData, ReportData } from '../types.js'

/** 按正确率分 5 档给出评价话术（移植自原小程序 report 页） */
function headingByAccuracy(accuracy: number): string {
  if (accuracy >= 100) return '🎉 满分通关，太厉害了！'
  if (accuracy >= 80) return '💪 表现优秀，继续保持！'
  if (accuracy >= 60) return '👍 你这局学得很稳'
  if (accuracy >= 40) return '📚 有进步空间，加油！'
  return '🌱 别灰心，下次会更好！'
}

export interface QuizReportProps { quiz: QuizData; records: AnswerRecord[]; report?: ReportData; busy?: boolean; error?: string; onRetry?(): void; onRestart(): void }
export function QuizReport({ quiz, records, report, busy, error, onRetry, onRestart }: QuizReportProps) {
  const correct = records.filter(r => r.is_correct).length
  const wrong = records.length - correct
  const accuracy = records.length ? Math.round(correct / records.length * 100) : 0
  // 与后端 report_service 的发放规则保持一致：完成闯关 +10，每答对一题 +2
  const xpGain = 10 + correct * 2
  return <div className="zl-module"><header className="zl-heading"><div className="zl-eyebrow">练习复盘</div><h1>{headingByAccuracy(accuracy)}</h1><p>{quiz.title}</p></header>
    <section className="zl-report-score zl-panel"><div className="zl-score-ring" style={{ background: `conic-gradient(var(--zl-accent) ${accuracy}%, var(--zl-line) 0)` }}><div><b>{accuracy}<small>%</small></b><span>答题正确率</span></div></div><div><span className="zl-eyebrow">本次练习完成</span><h2>答对 {correct} / {quiz.questions.length} 道题</h2><p>{report?.share_quote || '把这次的疑问，变成下一次的掌握。'}</p>{records.length > 0 && <div className="zl-report-tags"><span className="zl-tag"><CheckCircle2 size={14}/>答对 {correct} 题</span><span className="zl-tag danger"><XCircle size={14}/>答错 {wrong} 题</span><span className="zl-xp-badge">+{xpGain} XP</span></div>}<span className="zl-tag"><CheckCircle2 size={14}/>已完成逐题回顾</span></div></section>
    {busy && <p className="zl-notice" role="status">正在生成 AI 复盘报告，通常需要几十秒，请稍候…</p>}
    {error && <p className="zl-error" role="alert">{error}</p>}
    {!report && !busy && <div className="zl-empty"><p>答题结果已保存在当前标签页，AI 报告尚未生成。</p><button className="zl-primary" onClick={onRetry}>生成复盘报告</button></div>}
    {report && <div className="zl-report-grid">{([['知识总结', report.three_line_summary], ['已经掌握', report.mastered_points], ['重点再练', report.weak_points], ['下一步建议', report.advice]] as const).map(([title,items]) => <section className="zl-panel zl-report-section" key={title}><h3>{title}</h3>{items.length ? <ul>{items.map((item,i) => <li key={i}>{item}</li>)}</ul> : <p className="zl-muted">本次没有需要补充的内容。</p>}</section>)}</div>}
    <section className="zl-panel zl-review"><h2>题目回顾</h2>{quiz.questions.map((q,i) => { const answer = records.find(r => r.question_id === q.id); return <details key={q.id}><summary><span className={`zl-result-dot ${answer?.is_correct ? 'correct' : 'wrong'}`}>{i+1}</span><span>{q.stem}</span><span className="zl-muted">{answer?.is_correct ? '答对' : answer ? '答错' : '未答'}</span></summary><div className="zl-review-content">{q.image_url && <img className="zl-question-image" src={q.image_url} alt="题目配图"/>}<ul>{q.options.map(option => <li key={option.key}>{option.key}. {option.text}</li>)}</ul><p>你的答案：{answer?.selected_answers.join('、') || '未答'} · 正确答案：{q.answer.join('、')}</p><p>{q.explanation}</p><small>知识点 · {q.knowledge_point}</small></div></details> })}</section>
    <div className="zl-footer-actions"><button className="zl-primary" onClick={onRestart}>再来一组<ArrowRight size={17}/></button></div>
  </div>
}
