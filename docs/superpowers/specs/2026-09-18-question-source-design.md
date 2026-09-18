# Quiz 题目与 Core 来源快照

延续已授权后端路线，前端暂停。采用题库单题显式关联冻结 Core 课程单元：
Host 读取 Core getLearningCourse，验证 active/course/unit，提取知识点 ID、
类型、标题、陈述与 evidence。关联表示用户选择的来源，非自动证明题目考查该知识点。
不采用标签自动匹配；不直接让 Quiz 读取 Core SQLite 或接受浏览器提供的内容/hash。

每个题库内容版本最多一个当前 source；PUT /question-bank/entries/{id}/source
接收 {expected_revision, source: {courseId,unitId}|null}。Host 将 source 转成
snake_case 的完整快照，sha256 对 knowledge_point_id/type/title/statement/evidence
规范 JSON（排序键，UTF-8，无空白）生成 content_version，schema_version=1。
course_id/unit_id 定位冻结课程；content_version 表示本次导出快照内容而非当前
knowledge_points.content_hash。来源删除/更新不改写已保存快照。

Quiz 私有 PUT /question-bank/entries/{id}/source 接收 Host 快照；要求 loopback、
managed host secret 和用户归属，禁用未受管理的写入口。公开 Host 严格字段校验。
expected_revision 提供乐观并发，重复相同请求在 expected+1 状态返回同一结果，
Host 在 Core 读取前先检查已保存来源以支持课程删除后的重放，最终仍由 Quiz 校验修订号。其他过期提交 409。null 为解除，修订号仍递增。读取当前 source/revision 可重试。

Quiz schema v4 新增 question_bank_sources，给 question_bank_attempts 添加
source_json/source_revision。交卷 record_attempt 同事务冻结当前关联。
已交成绩、对错、XP 不变；重放不重拍来源；旧历史不回填。当前源读取来自
题库详情/列表与 source GET；历史页返回交卷时 source/source_revision。

新库/旧 v1-v3 全链测试，升级前一致性备份 .pre-v4-*.bak，失败事务回滚，
不升级日常 home。Core schema/RPC 不新增。后续再做多来源、生成归因、
来源过滤统计；不据此修改 Core 掌握度。

验证：Host 伪造字段拒绝/来源不存在或归档/请求来源认证/可信快照；
Quiz 归属/并发修订/重放/解绑/新旧历史/版本隔离/重启/迁移备份回滚。
