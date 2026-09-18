import { ArrowRight, CheckCircle2, XCircle } from 'lucide-react'
import type { AnswerRecord, QuizData, ReportData } from '../types.js'

export interface QuizScore { accuracy: number; correct_count: number; total_questions: number; xp_gain: number; submitted_at?: string | null }
export interface QuizReportProps { score?: QuizScore; legacy?: boolean; reportStatus?: string; quiz: QuizData; records: AnswerRecord[]; report?: ReportData; busy?: boolean; error?: string; onRetry?(): void; onRestart(): void }
export function QuizReport({ quiz, records, report, busy, error, onRetry, onRestart, score, legacy, reportStatus }: QuizReportProps) {
  const correct = score?.correct_count ?? 0
  const wrong = score ? score.total_questions - correct : 0
  const accuracy = score ? Math.round(score.accuracy) : undefined
  return <div className="zl-module"><header className="zl-heading"><div className="zl-eyebrow">练习复盘</div><h1>{score ? `正确率 ${accuracy}%` : legacy ? '历史复盘报告' : '尚未交卷'}</h1><p>{quiz.title}</p></header>
    {score && <section className="zl-report-score zl-panel"><div className="zl-score-ring" style={{ background: `conic-gradient(var(--zl-accent) ${accuracy}%, var(--zl-line) 0)` }}><div><b>{accuracy}<small>%</small></b><span>答题正确率</span></div></div><div><span className="zl-eyebrow">本次练习完成</span><h2>答对 {correct} / {score.total_questions} 道题</h2><p>{report?.share_quote || '查看本次答题结果与知识点复盘。'}</p><div className="zl-report-tags"><span className="zl-tag"><CheckCircle2 size={14}/>答对 {correct} 题</span><span className="zl-tag danger"><XCircle size={14}/>答错 {wrong} 题</span><span className="zl-xp-badge">+{score.xp_gain} XP</span></div><span className="zl-tag"><CheckCircle2 size={14}/>成绩已保存</span>{score.submitted_at && <p className="zl-muted">交卷时间：{score.submitted_at} UTC</p>}</div></section>}
    {busy && <p className="zl-notice" role="status">正在生成复盘报告，请稍候…</p>}
    {error && <p className="zl-error" role="alert">{error}</p>}
    {!report && !busy && !!score && <div className="zl-empty"><p>成绩已保存。AI 报告使用已配置的模型独立生成，不影响本次成绩。</p><button className="zl-primary" disabled={!onRetry || reportStatus === 'running'} onClick={onRetry}>{reportStatus === 'running' ? '报告生成中' : reportStatus === 'failed' ? '重试 AI 报告' : '生成 AI 报告'}</button></div>}
    {report && <div className="zl-report-grid">{([['知识总结', report.three_line_summary], ['本次表现较好的知识点', report.mastered_points], ['重点再练', report.weak_points], ['下一步建议', report.advice]] as const).map(([title,items]) => <section className="zl-panel zl-report-section" key={title}><h3>{title}</h3>{items.length ? <ul>{items.map((item,i) => <li key={i}>{item}</li>)}</ul> : <p className="zl-muted">本次没有需要补充的内容。</p>}</section>)}</div>}
    <section className="zl-panel zl-review"><h2>题目回顾</h2>{quiz.questions.map((q,i) => { const answer = records.find(r => r.question_id === q.id); return <details key={q.id}><summary><span className={`zl-result-dot ${answer?.is_correct ? 'correct' : 'wrong'}`}>{i+1}</span><span>{q.stem}</span><span className="zl-muted">{answer?.is_correct ? '答对' : answer ? '答错' : '未答'}</span></summary><div className="zl-review-content">{q.image_url && <img className="zl-question-image" src={q.image_url} alt="题目配图"/>}<ul>{q.options.map(option => <li key={option.key}>{option.key}. {option.text}</li>)}</ul><p>你的答案：{answer?.selected_answers.join('、') || '未答'} · 正确答案：{q.answer.join('、')}</p><p>{q.explanation}</p><small>知识点 · {q.knowledge_point}</small></div></details> })}</section>
    <div className="zl-footer-actions"><button className="zl-primary" onClick={onRestart}>创建新练习<ArrowRight size={17}/></button></div>
  </div>
}
