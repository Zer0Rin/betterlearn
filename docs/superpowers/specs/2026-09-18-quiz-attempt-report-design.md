# Quiz 成绩与 AI 报告分离

日期：2026-09-18。状态：用户已确认；后端实现完成，迁移仅在临时数据库验证。

## 范围与依据

承接 `docs/handoffs/2026-09-18-learning-foundations.md`。
前端暂停，保留现有工作区改动，不调用真实收费模型，不操作日常 home。
这一阶段实现独立作答、草稿恢复、交卷与报告重试，不同时开发题池、错题本、
Core 复习调度、知识点关联或学习曲线。

当前 `report_service.handle_report_generate` 在模型成功后调用
`quiz_repository.save_report_atomic`，一起写答案、报告和 XP。
`answer_records` 与 `reports` 都按 quiz_id 唯一，schema version 为 1。
现有 `get_user_quiz_list` 将未交卷正确率变成 0，时间使用出题时间。

DeepTutor 的 `grade_and_record` 提供先判分并记录、独立于复盘的流程参考；
继续使用已从其源码改编的 `choice_grading.py`。其 notebook upsert 会覆盖同题答案，
不能替代独立 attempt 历史。具体核对见 `docs/deeptutor-reuse.md`。

## 方案比较

1. 只把现有 answer_records 写入提前：改动小，但仍只能每卷一次，后续还要重做轮次和幂等。
2. **推荐：增加 attempt/answers/report 表，保留旧表作为兼容历史。** 独立表达每轮作答，迁移不删除旧记录。
3. 直接移植 DeepTutor progress 与 session store：会引入另一套持久化及身份边界，且 notebook 本身不保存完整多次历史。

## 数据结构和状态

新增 `quiz_attempts`：attempt_id、quiz_id、user_id、创建 request_id、题目和标题快照、
status（draft/submitted）、revision、created_at、submitted_at、total_questions、
correct_count、accuracy、xp_gain、submission_hash、legacy_source。
attempt_id 由服务端产生；`(user_id, request_id)` 唯一。
请求键与业务内容冲突返回 409，不静默创建新轮次。
草稿的成绩与交卷时间为 NULL，真实零分为 0。

新增 `quiz_attempt_answers`：按 `(attempt_id, question_id)` 唯一，保存选项、时长和判分。
草稿不保存可信对错；提交时替换为完整的服务端判分结果。

新增 `quiz_attempt_reports`：attempt_id 唯一、status（running/completed/failed）、
generation_token、report_json、error_message、updated_at。
错误消息使用固定用户提示，不存模型密钥和原始异常。
AI 内容不修改 attempt 成绩。

所有新接口要求当前用户身份，归属检查同时约束 attempt 与 quiz。
没有权限的对象与不存在的对象统一返回 404。

## API 与事务

在 quiz Python 路由增加下列接口，同步增加 Host `src/product/quiz-routes.ts` 白名单。
路径中的 ID 遵守现有字母、数字、下划线、连字符及长度限制。

- `POST /quiz/{quiz_id}/attempts`：使用 request_id 幂等创建草稿，快照来自服务端题卷。
- `GET /quiz/{quiz_id}/attempts`：返回该卷自己的轮次摘要，按创建时间及 ID 稳定排序。
- `GET /quiz/attempts/{attempt_id}`：读取状态、revision、草稿或正式答案、成绩与报告状态。
- `PUT /quiz/attempts/{attempt_id}/answers`：保存完整的部分作答快照；携带 expected_revision，
  过期修订返回 409，避免两个窗口覆盖新草稿。检查题号唯一、归属、选项与非负时长；
  未作答题可不提供。submitted 状态拒绝修改。
- `POST /quiz/attempts/{attempt_id}/submit`：携带最终完整答案和 expected_revision。
  同一事务内加载快照、验证、判分、保存答案、转 submitted 并处理 XP。
  重试比较规范化 submission_hash：一致则返回原成绩，不再次判分、改时间或发 XP；
  不一致则 409。规范化包括题号排序、选项排序和时长，忽略客户端 is_correct。
  缺题或非法答案返回 422，数据库内容保持原样。
- `POST /quiz/attempts/{attempt_id}/report`：仅接受已交卷轮次，不接受新的题目或答案。
  completed 直接返回；running 返回 409；failed 可显式重试。
  先用短事务 claim 状态，再在事务外调用模型；最后按 generation_token 条件写入。
  启动时把遗留 running 标记 failed；取消也需释放状态。报告失败不回滚成绩。

交卷过程中没有模型调用。SQLite 事务序列化与唯一约束共同裁决并发提交。
报告 claim 限制同一轮并发模型调用；网络中断不能保证供应商没有收费，
所以不进行自动生成重试。报告生成应进入 active-tasks 检查，避免换设置或维护时漏掉活动调用。

## XP 和历史

推荐每份题卷只发一次 XP：首次正式交卷按现有 `10 + correct * 2` 计算；
同卷后续轮次保留独立成绩，xp_gain 为 0，避免更换 attempt ID 无限刷同卷经验。
提交事务依据该卷是否已有发奖记录裁决，包含旧成绩，不能依赖客户端标记。

现有用户汇总统计切到提交轮次，平均正确率采用按次平均；草稿不参与。
每卷历史列表仍是一卷一行，以最近一次已交卷成绩作为摘要，并添加对应 attempt_id、
submitted_at、status；旧 created_at 继续表示题卷创建时间。
为避免暂停前端时把 accuracy 从 number 改为 null 导致渲染问题，旧列表字段暂保留兼容，
明确其未完成时的 0 是历史占位；新 attempt 接口必须用 NULL 区分未完成和零分。
未来图表只使用 attempt 的 submitted_at 和明确的成绩，不能读取旧占位值。

## 旧调用兼容

旧 `POST /report/generate` 的已保存报告继续返回原结果，不重算历史。
尚无报告的有身份请求映射到每卷唯一的 legacy 轮次：先保存可信成绩及 XP，再生成报告。
首次模型失败后，重试只读取该轮已保存答案，不让新请求改变成绩。
旧 quiz detail 返回该兼容轮次的答案和报告；新多轮记录通过 attempt API 读取，
避免将某轮答案和另一轮报告拼在一起。
匿名旧接口保持不持久化、不发 XP。

`save_report_atomic` 不再作为新业务写入口；旧测试应改为覆盖新的两段事务行为。
不得保留一条会再次给已迁移成绩发 XP 的旁路。

## 数据库升级与恢复

schema 1 → 2 采用新增表和导入旧行，旧表保留。
每个旧 answer_records 行导入一条稳定 ID 的 submitted attempt，关联旧 reports；
旧成绩不重算，不再次发 XP，保留原 accuracy 与记录时间，并标为 legacy。
实现时补充：导入历史的 records_json 存为 legacy_records_json，原样保留重复和未知题号；
不将旧系统允许的数据强行写入新 answers 唯一约束，避免迁移失败或静默丢失记录。
只有报告而没有答案的异常旧行继续由旧查询读取，不虚构作答历史。
没有旧答案的题卷不自动生成已提交轮次。

升级代码先只读检查版本；对 v1 使用 SQLite backup API 创建完整、不会覆盖既有文件的备份，
备份失败则中止升级。备份路径和恢复方法应写入升级文档，不能把 WAL 文件单独复制当作完整备份。
迁移在事务内重新检查版本；失败回滚，user_version 仅在所有步骤成功时更新。
高于支持版本的数据库在任何 schema 修改前拒绝。
恢复使用停服后的备份副本和匹配的旧版本程序，不直接覆盖运行中的库。

本轮实施验证只使用临时 v1/v2 数据库，不启动或迁移用户日常 home。

## 验证清单

- 模型失败时成绩、答案、交卷时间和一次 XP 已存在；之后报告重试成功不改变它们。
- 并发重复创建、提交和报告请求分别由请求键、状态和 generation_token 裁决。
- 同一卷多轮记录不覆盖，后续轮次不重复发 XP；改变已提交答案返回冲突。
- 跨用户对创建、草稿、详情、列表、交卷、报告的访问全部拒绝。
- 草稿保存、修订冲突、进程重启读取与提交后禁止编辑。
- 服务端题目快照决定成绩；伪造客户端题目、is_correct、LLM accuracy 无效。
- v1 导入保留旧成绩、报告、时间和 XP；再次初始化不重复导入；失败回滚与备份可恢复。
- AI 生成并发只调用一次；失败、取消和进程重启允许显式重试；草稿不能生成报告。
- Host 白名单允许新接口，非法路径、方法、参数与跨来源仍拒绝。
- 运行 quiz 全套测试、相关 Host 路由测试、构建和 git diff 检查；全部使用 fake provider。

## 审阅重点

本方案把“同卷多次练习可记录成绩”和“同卷只发一次 XP”分开。
此产品语义已由用户确认，实施与验证记录见对应 implementation plan。
