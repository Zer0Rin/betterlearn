# Core 到期复习闭环

本轮继续已确定的学习后端路线；前端暂停，保留全部工作树改动。

## 范围和方案

采用独立复习接口与跨课程队列。仅放开 main 的 mastered 状态会允许未到期刷题，并且旧页面可能用过期答案推进下一轮；另建独立数据库则重复 Core 已有的持久状态。
复用现有 Core learning_attempts 追加记录，review 元数据存于同一记录的 result_json，mastery/due_at 仍在原事务中更新；无需 schema 升级。

- 新 RPC `learning_reviews.queue`，HTTP GET `/nobei/v1/learning-reviews`：limit 默认20最大100，offset 默认0，可选 courseId。只读。
- 队列跨 active 课程包含到期掌握项与待补救项，补救优先，再按 DeepTutor 类型优先级和时间排序。
- 新 RPC `learning_reviews.submit`，HTTP POST `/nobei/v1/learning-reviews/{unitId}/attempts`：assessmentId、optionId、expectedAttemptId、idempotencyKey。
- expectedAttemptId 必须是该 unit 最新作答 ID；幂等回放先于版本/到期检查，同键异请求冲突。
- 已掌握且到期：答 main。答对安排下一复习，答错进入 remediation_required；未到期或 archived 拒绝。
- 待补救：答 evidence。答错保持 learning；答对 mastered_after_remediation。补救不作为独立间隔复习成功来加速间隔。
- 每轮 review.roundId 为首次复习 attemptId，补救沿用该轮；review.spaced 区分初学补救与间隔复习；review.schedule 保存 intervalIndex/consecutiveCorrect/consecutiveWrong。
- 普通初学入口保留；已经进入新复习轮次的补救必须通过新接口，防止旧页面无版本保护地提交。

## 调度代码复用

改编 DeepTutor `learning/scheduler.py` 的间隔表与 schedule_next。
fact→memory；concept/comparison→concept；process/formula/code→procedure。
正确推进1档，连续两次正确再推进2档；错误退1档，保持上下界。memory 的0天在本机适配为至少1天，避免即时刷题。
初学原有3天/补救1天规则保持兼容；进入间隔复习后按类型调度，补救沿用失败后的间隔档，不推进。
旧 strength 100/70/20 不扩展为新能力模型；这是重复练习调度，复用现有固定题，不宣称新题评估或校准掌握度。

## 边界与测试

复习绑定 unit 的冻结知识点来源，跨课程相同 knowledgePointId 不合并；不接 Quiz 自由文本标签。
服务端使用当前 UTC 时间；队列不返回正确选项或历史答案。继续保留完整课程原有历史视图。
事务、并发、幂等和删除级联沿用 Core；新 result_json 字段保留旧读取兼容。

测试：未到期拒绝，到期成功安排下次，错→补救→再到期，过期 expectedAttemptId，幂等回放跨轮保持原响应，
跨课程队列/分页/归档/删除，状态持久化重开，事务失败回滚、并发仅一份生效，RPC与HTTP边界。
