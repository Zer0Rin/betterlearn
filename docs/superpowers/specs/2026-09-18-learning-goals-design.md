# 学习目标后端设计（已确认并实现）

日期：2026-09-18。前端暂停，现有工作树全部保留，不操作日常 home、不调用模型。

## 目标与范围

为单个冻结 Core 知识点版本设置一个明确截止时间、目标练习证据分数和最低题目内容数，持久保存目标并读取可追溯进度。用户可创建、列表、查看和归档；第一阶段不提供目标条件修改或硬删除。

默认 target_percent=90（对应 evidence_score >= 0.9），min_distinct_questions=5；两者创建时可显式指定。得分沿用已完成的 distinct_first_v1：最近五种精确题目内容的首次可信作答加权，同题重答不替换首次证据。达标仅表示达到用户设定的练习条件，不宣称知识点掌握或考试90分。

计入该知识点版本全部已保存的可信作答，包括目标创建前的历史。目标固定来源版本，后续课程变化不自动切换。

## 方案对比

1. **推荐：以现有练习证据分数为目标。** 直接复用DeepTutor派生算法及已验证的去重、版本与用户隔离，目标含义可追溯；限制是启发式练习条件，不能解释为考试分数。
2. 以首答正确率为目标。更容易按百分比理解，但与现有最近五种加权政策不同，需要另立度量及结果解释，本阶段不混用。
3. 以模拟考试成绩为目标。更适合考试90分等诉求，但依赖独立试卷、交卷前隐藏答案、统一计分及期限规则，尚不具备，另行设计。

## 已核对的复用点

- DeepTutor HEAD `31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f` 的 learning/mastery.py 已改编为 Quiz evidence_scoring.py。本阶段使用已有适配，不复制新的评分算法。
- DeepTutor learning/policy.py 的 objective 是知识点掌握门槛，没有在已核对的 learning 与 mastery_path 入口找到期限＋目标分数管理实体，不声称完整源码移植。
- Host quiz-source.ts 提供可信 Core 冻结来源；source-generation.ts 提供创建前查询已接受请求、来源删除后仍可重放的模式。
- Quiz knowledge_stats_repository.py 提供 owned/trusted/version 查询、题目内容键和单事务聚合。
- Quiz db.py 已有升级前 SQLite backup 与迁移事务，maintenance 覆盖整个 quiz-data。

## 对外 HTTP 接口

均位于 `/nobei/quiz/v1/learning-goals`；私有 Quiz 对应 `/api/v1/learning-goals`。第一阶段不新增 MCP 工具。

### POST /learning-goals

严格接受：

- request_id：UUID，用于目标创建幂等；命名空间仅为当前用户的目标创建，与出题请求分开。
- title：trim后1..120字符。
- source：仅 `{courseId, unitId}`，沿用已有ID格式。
- target_percent：严格整数1..100，默认90。不是正确率字段，也不是考试分数。
- min_distinct_questions：严格整数3..100，默认5。达到数量要求后，分数仍只使用最近五种内容。
- due_at：必填，含时区的RFC3339时间，最多毫秒精度；统一转UTC。新创建必须晚于服务端当前时间。

Host拒绝外部来源内容、hash、状态、用户ID或分数。先读取当前用户已接受的创建请求，再决定是否需要Core解析；新目标仅能绑定active课程中的真实单元。私有创建必须有受管理Host认证。

Quiz事务内根据 `(user_id,request_id)` 查询。已有相同规范化输入返回同一目标的当前表示，包括归档状态；参数不同409。重放先于“截止时间必须在未来”校验，因此过期或Core删除后的重复请求仍可读回已有目标。首次并发创建只保存一条。

规范化摘要包含title、UTC截止时间、默认展开后的数值和冻结来源。保存原始规范化创建条件；归档不会改写创建摘要。源内容改变但相同course/unit重试，应使用已接受的冻结快照完成摘要比较，不能重拍快照。

### GET /learning-goals

仅接受 page（1..1000000，默认1）、page_size（1..50，默认20）、status（active/archived/all，默认active），拒绝重复和额外参数。按创建序号倒序稳定分页。

列表只返回目标定义、来源摘要和归档状态，不为每一行执行完整历史聚合。要读取评分使用详情，避免目标列表产生N次全历史扫描。

### GET /learning-goals/{goal_id}

读取目标定义、冻结来源摘要和progress。goal_id=`goal_`＋32位小写hex。不存在或其他用户目标均404。已归档目标仍可读取。

### PUT /learning-goals/{goal_id}/archive

严格接受 `{expected_revision, archived}`；revision是非负严格整数，archived是严格布尔值。只改变归档状态，不修改来源、阈值或期限。

使用CAS：当前revision等于expected时应用变更并递增；已达到expected+1且状态相同则幂等返回；其余409。归档不改变创建请求摘要，重放创建不会恢复归档状态。可显式取消归档，但已过期限不重新开始计时。

私有 `GET /learning-goals/request/{request_id}` 仅用于Host的幂等预查询，必须验证用户和受管理Host身份；不开放公共代理。它返回创建规范化输入，未知为404。

## 进度、截止时间与达标口径

详情在一次SQLite快照中读取目标与匹配作答，使用服务端读取时刻 `evaluated_at`。`evidence_cutoff_at=min(evaluated_at,due_at)`。

只有该用户、该ID/版本、已提交、非legacy且带可信来源修订的作答可进入候选；再限制服务端记录的submitted_at不晚于cutoff（等于截止时刻计入）。对范围内记录按持久关联ID确定每种精确内容的首次作答，再使用既有评估政策。不得直接拿当前assessment响应冒充截止时刻的评估。

截止前计入已有历史且随新作答变化；截止后晚交记录不补入目标结果。原有独立knowledge-assessment接口继续展示全部历史，不受目标截止时间影响。

progress返回与评估契约一致的分数、数量、首答/最近正确率和最多五条basis，附：

- policy_version=`distinct_first_v1`；evaluated_at、evidence_cutoff_at。
- deadline_passed：evaluated_at >= due_at。
- criteria_met：证据分数非null、分数 >= target_percent/100、distinct_question_count >= min_distinct_questions。
- remaining_distinct_questions=max(0,min_distinct_questions-distinct_question_count)。数量补足并不保证分数达标。

不持久化“第一次达标”或永久完成徽章。截止前criteria_met可能随新的首次错答回落；截止后表示截至截止时刻的证据是否满足条件，不代表曾在更早时刻首次达标。归档状态单独保存，不混入评分状态。

时间依据本机服务端记录的UTC；不宣称提供可信远程计时或防系统时钟修改。数据库外部篡改/删除不在保证范围内，正常接口不允许回填或修改submitted_at。

## 存储与升级

Quiz schema5→6，Core schema2不变。新建learning_goals表，字段至少包括：自增id、唯一goal_id、user_id外键、request_id、request_digest、create_request_json、title、source_json、knowledge_point_id、content_version、target_percent、min_distinct_questions、due_at（规范化UTC）、policy_version、archived、revision、created_at。唯一约束(user_id,request_id)，用户/创建序号索引。

不修改旧作答、分数、XP、Core掌握度或复习队列。旧home首次启动升级前生成`.pre-v6-*.bak`；v1..v5及全新库路径均需验证。失败回滚schema与版本，备份可独立打开。不得迁移用户日常home做开发测试。

整个quiz-data已包含在现有备份/恢复范围，需回归验证目标与创建去重随之保留。不增加独立文件存储或新模型配置。

## 实现组织

- 新增Quiz goal model/repository/router/migration；库内评估函数提取可接受现有cursor与可选cutoff的内部聚合入口，现有HTTP/MCP评估行为不变。
- 新增Host目标创建适配器，复用可信来源编解码与错误处理，不绕过用户身份。
- 显式解析截止UTC；不要用字符串比较混用SQLite空格时间和RFC3339时间。条件比较需统一精度和UTC。
- 目标列表不聚合；详情一次性计算，结果不分页或截断输入，不调用模型。
- 同步跨语言契约、来源与范围文档、迁移测试、Host边界与真实服务测试。

## 验收

1. 未配置模型可创建和读取目标，零模型请求；Core缺失/归档/单元不存在拒绝新建。
2. 同请求并发、重启重放、Core删除后重放、过去截止时间下重放均返回同一目标；修改title/目标/来源/期限后复用ID为409。
3. 空证据null、零分0、三种内容满分但最低数量五时未达标；五种内容满足默认目标时达标；同题重复和复制不补数量。
4. 创建前历史计入；不同知识点版本隔离。截止前、正好截止、截止后记录边界；后续评估与当前全历史评估不同且解释清楚。
5. 首次作答及window仍按关联序号，同毫秒不乱序；读目标与读答案使用同一事务。
6. 跨用户404、strict参数、duplicate query、方法/来源认证、恶意来源快照拒绝；列表稳定分页。
7. 归档CAS并发、重放、冲突、取消归档；创建重放保留归档状态，不创建新目标。
8. v1..v5迁移备份、回滚、重启无重复升级、备份恢复后创建去重；不重算XP或改变既有报告/来源任务。
9. 临时home真实Host→Quiz→Core链路、fake provider仅用于已有夹具，不使用收费模型；相关全量回归、构建、diff check及独立审查。

## 状态

设计已自查接口、去重、时间、版本及达标语义。用户以“继续”确认方案后完成实现。最新验证记录见同名执行计划与交接文档；之前Web531/Quiz304为历史验证记录。
