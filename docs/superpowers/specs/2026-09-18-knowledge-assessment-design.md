# 知识点练习证据评估设计（已确认）

日期：2026-09-18。前端暂停，保留全部未提交改动，不操作用户日常 home。

## 当前问题与本阶段结果

已有知识点版本统计提供总正确率、首次正确率和最近正确率，但没有解释证据数量的评估摘要。目标评估若直接使用总正确率，会让同题反复练习掩盖独立题目内容不足。

本阶段增加只读知识点练习证据摘要。它回答“这一历史知识点版本有多少不同题目内容、首次作答表现如何、还缺多少内容才能消除少样本上限”，不据此声明掌握、不解锁课程。期限与目标分数实体、考试和跨类型掌握判定留给后续阶段。

## 已核实源码及复用边界

用户提供的 DeepTutor HEAD 为 `31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f`。

- `deeptutor/learning/mastery.py::compute_mastery`：最近五次权重为 0.5、0.7、0.85、0.95、1.0；不足五次取末尾对应权重；一次上限 0.5，两次上限 0.8。
- `deeptutor/learning/policy.py`：memory/procedure 的定量门槛为 0.9，concept/design 使用独立质性评估。其 objective 是知识点，不是带期限和目标分数的独立管理实体。
- BetterLearn Core 类型是 concept/process/comparison/formula/fact/code，没有与上游门槛一一等价的评估条件，故本阶段不移植门槛。
- 直接改编 mastery 纯函数并保留 Apache-2.0 许可证与来源说明；调用前由 BetterLearn 做用户隔离、版本隔离和精确内容去重。不会引入上游运行时和持久化层。

## 方案选择

1. **推荐：只读练习证据摘要。** 可直接使用现有可信历史，无迁移；先建立可审计的评分输入，后续目标实体可以引用这个带版本的政策。
2. 直接创建期限/目标分数实体。需要额外约定截止时间、目标范围、版本变化、修改历史和达标语义；现有目标尚未明确，暂不开展。
3. 将 Quiz 正确率写回 Core 掌握度。实现表面简单，但会混淆选择题证据和概念解释，也会影响既有学习/复习状态，本阶段不采用。

## API 和数据来源

新增 GET `/nobei/quiz/v1/question-bank/knowledge-assessment`，私有 Quiz 路径 `/api/v1/question-bank/knowledge-assessment`。

请求必须同时提供 `knowledge_point_id` 与 `content_version`，格式沿用 knowledge-history；拒绝额外/重复参数和其他方法。它查询历史版本，不要求当前 Core 单元仍存在，不从当前绑定重建历史。

复用 knowledge_stats_repository 的可信历史查询和 question_content_key 算法：只统计当前用户的已提交、非 legacy 作答，且交卷时存在可信来源快照。跨课程相同 ID/版本合并；不同版本分离；自由标签不参与关联。

一个数据库快照内读出匹配历史，并按 question_bank_attempts.id 升序处理，不能依赖客户端时间或单次分页。统计和评分须使用同一批行，避免跨查询并发交卷产生矛盾摘要。响应只返回末五个评分依据和计数，不返回完整历史或题目答案。

## 评估政策 `distinct_first_v1`

1. 按现有精确题目内容键去重，每种内容仅取首次可信交卷的正确性和持久关联序号。
2. 按首次关联序号排列，选择最近五种内容的首次正确性。
3. 将这组布尔值传给改编的 DeepTutor compute_mastery；不改变权重/上限。
4. 同内容重答、复制到其他题卷再答均不新增评分证据，不替换首次结果。改正后的表现仍由已有 latest_accuracy 呈现。
5. 没有证据时 evidence_score 为 null；有证据且全错时为 0。分值范围 0..1，不与百分制正确率混用。计算保留原始浮点精度，响应最多保留六位小数。
6. 不同内容不等于独立能力证据；首次可信交卷也不保证此前没看过答案。本政策没有语义去重、难度校准、跨类型能力门槛或时间遗忘模型。

例：同一道题答对十次，distinct_question_count=1、window_count=1、evidence_score=0.5。两种内容首次均对为 0.8。三种内容首次均对为 1.0，但仍不输出 mastered=true。首答错后重答正确保留首次错误；latest_accuracy 会反映改正。

## 响应

ApiResponse.data 包含：

- knowledge_point_id、content_version、policy_version=`distinct_first_v1`。
- source：同统计接口的历史来源摘要，零证据为 null；不包含完整 evidence。
- answer_count、distinct_question_count、repeated_answer_count；first_accuracy、latest_accuracy 使用现有百分制口径，零证据为 null。
- evidence_score：上述 0..1 或 null；window_count（0..5）、window_limit=5。
- small_sample_cap：零证据为 null，一/二种内容为 0.5/0.8，至少三种为 1.0；只是政策上限，不是统计置信区间。
- evidence_state：no_evidence / limited_evidence / available，分别对应 0 / 1..2 / 至少3种内容；available 不表示足以证明掌握。
- basis：最多五项，按首次关联顺序包含 question_content_key、entry_id、attempt_id、is_correct、submitted_at。可通过原有题库入口追溯，不包含正确答案或用户答案正文。

空结果无论不存在还是不归当前用户，都返回相同零计数/null/basis=[]，不泄露其他用户数据存在性。返回前不调用模型、不创建任务、不修改 XP/掌握度/调度/来源。

## 实现范围及兼容

- 在 Quiz services 增加带来源声明的纯评分函数；repository 增加单快照聚合。
- 增加严格请求模型、只读路由和 Host GET 白名单，契约与测试同步。
- 不改变现有统计字段或正确率算法，不重算旧成绩。
- Quiz schema5/Core schema2 不变，不增加数据库表或索引。
- 本阶段先提供 HTTP API；不增加 MCP 工具，不改前端，不重装插件。
- 数据量性能与现有统计相同，仍需扫描该用户匹配的版本历史；不会以截断历史换取错误评分。

## 验证清单

- 纯函数空输入、一/二次上限、最近五次权重、全错、超过五次的窗口选择。
- 首次错误后改正、重复十次、跨卷复制、元数据变化均不抬高首次证据数量或分数；不同题目内容正常累计。
- 不同版本、不同用户、无来源/legacy/未交卷隔离；当前来源修改/删除不重写历史。
- 同毫秒与时间倒退依旧按持久关联顺序确定窗口；basis 与分数可独立重算一致。
- 零证据与零分区分；只读调用不增加任务、成绩、XP 或其他持久状态。
- HTTP 格式、参数白名单、方法限制、认证及真实 Host→Quiz 链路；fake provider、临时 home，无真实模型调用。
- 与改动面相关的 Quiz/Host 回归、构建和 diff check；保留其他阶段测试结果的原始日期和范围。

## 状态

源码与当前数据链路已只读核对，设计已自查：无待填字段；历史版本/去重/少样本/空结果口径均明确。用户已确认本阶段范围，实施与验证结果记录在同名计划和交接文档中。
