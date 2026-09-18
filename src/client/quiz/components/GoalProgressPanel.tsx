import type {GoalDetail} from '../goal-types.js'
import {goalTime,goalTimeZone} from '../services/goal-time.js'
const percent=(value:number|null)=>value===null?'暂无证据':`${value.toLocaleString('zh-CN',{maximumFractionDigits:2})}%`
export function GoalProgressPanel({goal,busy,onArchive}:{goal:GoalDetail;busy:boolean;onArchive():void}) {
 const p=goal.progress
 const status=p.deadline_passed?(p.criteria_met?'截止时已达标':'已截止，未达标'):(p.criteria_met?'当前已达标':'进行中，尚未达标')
 return <section className="zl-panel zl-goal-detail"><div className="zl-bank-controls"><h2>{goal.title}</h2><span>{goal.archived?'已归档 · ':''}{status}</span></div>
  <p>{goal.source.title}：{goal.source.statement}</p>
  <p>截止时间：{goalTime(goal.due_at)}（{goalTimeZone()}）</p>
  <div className="zl-goal-metrics"><div><span>证据分数</span><strong>{percent(p.evidence_score===null?null:p.evidence_score*100)}</strong><small>目标 ≥ {goal.target_percent}%</small></div><div><span>不同题目</span><strong>{p.distinct_question_count} / {goal.min_distinct_questions}</strong><small>还需 {p.remaining_distinct_questions} 道</small></div></div>
  <p className="zl-muted">{p.deadline_passed?'按记录的交卷时间统计截止前证据。截止前已到期的考试若稍后结算，仍可能更新此结果。':'截止前的达标状态会随新证据变化。'} 证据分数用于练习反馈，不代表已经掌握知识点。</p>
  <dl className="zl-goal-statistics"><div><dt>累计有效作答</dt><dd>{p.answer_count} 次</dd></div><div><dt>重复内容作答</dt><dd>{p.repeated_answer_count} 次</dd></div><div><dt>首次正确率</dt><dd>{percent(p.first_accuracy)}</dd></div><div><dt>最近正确率</dt><dd>{percent(p.latest_accuracy)}</dd></div></dl>
  <h3>评分依据</h3><p className="zl-muted">最近 {p.window_count} / 最多 {p.window_limit} 道不同题目的首次答案；改答会影响最近正确率，不会替换首次证据。{p.small_sample_cap!==null&&p.small_sample_cap<1?`当前小样本分数上限 ${p.small_sample_cap*100}%。`:''}</p>
  {p.basis.length?<ol className="zl-goal-basis">{p.basis.map(b=><li key={b.question_content_key}><span>{b.is_correct?'首次答对':'首次答错'}</span><time>{goalTime(b.submitted_at)}</time></li>)}</ol>:<p>暂无可计入证据。普通主题练习或未关联此知识点版本的题目不会计入。</p>}
  <p className="zl-muted">评估时间：{goalTime(p.evaluated_at)} · 证据截止：{goalTime(p.evidence_cutoff_at)}（{goalTimeZone()}）</p>
  <details><summary>目标绑定的知识点版本</summary><p className="zl-goal-version">{goal.source.content_version}</p><p>创建时冻结来源；课程后来修改或删除，不改变已有目标。</p></details>
  <button className="zl-secondary" disabled={busy} onClick={onArchive}>{goal.archived?'恢复目标':'归档目标'}</button><p className="zl-muted">归档只影响列表展示，保留目标与证据；恢复不会延长截止时间。</p>
 </section>
}
