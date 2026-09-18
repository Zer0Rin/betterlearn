# DeepTutor 学习流程源码复用核对

核对日期：2026-09-18。来源为用户提供的本地 DeepTutor 仓库，提交
`31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f`。
本次没有修改 DeepTutor，也没有迁移用户学习数据。

## 已接入：确定性的选择题判分

从 `deeptutor/learning/grading.py` 的 choice 分支改编
`services/quiz/app/services/choice_grading.py`，适配无序多选答案。
许可证与修改说明保存在 `services/quiz/third_party/DeepTutor/`，构建会复制该目录。

BetterLearn 的持久化报告现在按当前用户加载 SQLite 中的题目和标题，校验
题号完整且不重复、选项合法、题型数量正确，再重新计算每道题的正确性。
客户端的正确标志与修改后的题目不参与持久化计分；模型生成报告的 accuracy
也由确定性计分覆盖。既有报告重试仍返回原报告，不重复增加经验。

兼容边界：旧的匿名报告接口仍接受请求中的题目，但不写持久成绩或经验。
已有历史报告没有自动重算。浏览器即时反馈仍是本地计算，正式持久化结果由服务端决定。
成绩与报告已拆分：独立作答轮次先原子保存答案、成绩和首次 XP，再按该轮快照生成报告。
报告失败不丢成绩，重试不再次发 XP；旧报告入口也走这条路径。前端草稿/多轮入口尚未接入。

## 适合继续复用的源码

| DeepTutor 文件 | 已核实行为 | BetterLearn 接入要求 |
| --- | --- | --- |
| `deeptutor/learning/service.py` 的 `grade_and_record` / `_apply_grade` | 判分、追加作答、更新掌握度、调度、保存，不依赖生成复盘报告 | 借鉴事务边界，保留 SQLite 和幂等；增加独立 attempt ID、逐题保存和完成提交，报告单独关联 attempt |
| `deeptutor/learning/mastery.py` | 最近五次加权正确率；一次正确最高 0.5、两次最高 0.8 | 可直接移植纯函数，但须先区分新题、看过答案的即时复测和间隔复习，避免同题刷掌握度；不是校准过的能力测量 |
| `deeptutor/learning/scheduler.py` | 按知识类型使用间隔表，答错回退间隔，错误知识点优先，生成到期队列 | 适配 Core 的知识类型、时间格式、SQLite 状态；新增复习轮次，解除“已掌握不能再次提交”的限制；跨课程队列需自行汇总 |
| `deeptutor/learning/models.py` | 作答、错误、复习状态都关联 knowledge_point_id | Core ID 与来源版本必须显式传递；不能靠 Quiz 的自由文本标签自动匹配 |
| `deeptutor/learning/policy.py` | 未完成题优先处理，到期复习先于新知识；概念/设计类与记忆/程序类采用不同掌握判断 | 参考流程规则，不把一个正确率直接等同所有类型的掌握 |
| `deeptutor/book/progress.py` | 从每题最新作答派生分数和薄弱章节，改正后可移出薄弱列表 | 适合当前状态摘要；学习曲线仍应保留每次历史，不应覆盖历史成绩 |

## 不直接移植的部分

- `book` 作答接口仍接收客户端 `is_correct`，不能解决服务端权威判分问题。
- `api/routers/quiz_judge.py` 是基于客户端提供参考答案的模型反馈接口，不能作为可信考试计分入口。
- `grading.py` 简答题使用字符串相似度，开放题使用关键词覆盖率；本次未引入这些启发式判分。
- DeepTutor 的整个 agent、会话、JSON 文件存储和模型运行时不需要引入 BetterLearn。

## 补查：题库、错题与历史语义

2026-09-18 再次只读检查，本地 DeepTutor HEAD 仍为上述提交。未运行其测试。

| 入口 | 核实结果 | 复用边界 |
| --- | --- | --- |
| `deeptutor/api/routers/question_notebook.py` | 题目及答案入库、分类、收藏、列表筛选与统计；upsert 请求接受 `correct_answer` 和 `is_correct` | 不能照搬客户端判分信任边界；BetterLearn 必须使用服务端题目快照与判分结果 |
| `deeptutor/services/session/sqlite_store.py` | `notebook_entries` 唯一键是 `(session_id, turn_id, question_id)`；冲突更新 `user_answer`、`is_correct`、时间，以及显式提供的答案图片 | 同一键重答会覆盖之前答案，不是追加成绩历史；题干和参考答案在该 upsert 冲突分支不更新 |
| 同文件的题库查询 | 分类关联表、收藏、未分类、`is_correct`、会话与文本筛选；列表和计数共用筛选逻辑 | 可用于后续题库状态投影；错题过滤表示当前保存的错误状态，不能据此统计历次错误次数 |
| `deeptutor/learning/service.py::record_quiz_attempt` | `quiz_attempts` 追加作答；错误记录按题目和知识点查找，追加 retry history，状态为 active/retrying/graduated | 与 notebook 覆盖行语义不同；移植时保留独立作答历史及显式知识点 ID |
| `deeptutor/learning/service.py::grade_and_record` / `_apply_grade` | 确定性判分、记录作答、更新掌握和复习状态，再保存；没有等待 AI 复盘 | 复用已改编的 choice 判分代码；流程适配 BetterLearn SQLite 原子事务，不直接搬入其整个 progress 存储 |
| `web/components/space/question-bank/` | 题库 UI 与 wrong 筛选入口 | 前端继续暂停，仅作为后续行为参考 |
| `web/components/space/learning/`、`deeptutor/api/routers/mastery_path.py` | 学习路径、目标详情、作答活动入口 | 不等于已有考试成绩折线或期限目标实体 |

回归参考入口：`tests/api/test_question_bank_api.py`、
`tests/tools/test_question_bank_tool.py`、
`deeptutor/learning/tests/test_mastery_tools.py::test_grade_syncs_mastery_attempt_to_question_bank`。

`deeptutor/tools/question/exam_mimic.py` 是仿题生成入口，不能据此宣称有完整计时考试与统一交卷流程。

后续顺序：成绩与报告分离 → 题库/错题状态及可再次提交的复习轮次 → 显式知识点关联 → 基于完整历史的掌握度策略。
成绩分离设计见 `docs/superpowers/specs/2026-09-18-quiz-attempt-report-design.md`，后端已实现。
成绩分离阶段增加的是 BetterLearn SQLite 事务适配，流程参考 grade_and_record；
随后题库阶段增加了下述查询源码改编，仍不引入 DeepTutor 的整个存储或 agent 运行时。


## 已接入：题库、错题状态与分类收藏（后端）

`app/repositories/question_bank_repository.py` 已改编 DeepTutor sqlite_store 的 LIKE 字面转义、
共用筛选、批量分类读取、分页/计数、统计及分类关联 SQL。完整来源见第三方 PROVENANCE。
BetterLearn 增加用户归属和题目版本键，使用可信交卷事务更新状态；不是仅参考流程重新造查询。

- 原卷 ID + 题号 + 内容 hash 区分条目，未答题为 null。
- wrong 为该版本最新作答错误，ever_wrong 表示曾错；改对不删除历史。
- 收藏、分类与统计均按用户隔离；历史关联原 attempt，不覆盖成绩。
- v3 回填可信 v2 作答，旧客户端判分原文不加入可信错题统计；不重发 XP。
- 尚未接前端，也不包含重新组卷、单题复习、Core 到期调度或知识点掌握度关联。


## 2026-09-18 Core 复习后端补充

已实际适配 deeptutor/learning/scheduler.py 至 python/nobei_core/learning_schedule.py：
类型间隔、连续正确推进、错误回退及上下界；Core 队列采用补救优先和类型优先级。
存储、幂等、最新作答版本校验与课程过滤由 BetterLearn 实现，不引入上游运行时。
来源和 Apache-2.0 许可证位于 python/nobei_core/third_party/DeepTutor 并随构建复制。
接口契约见 contracts/learning-reviews.md。固定题重复练习尚不能作为独立新题的能力证据。

## 2026-09-18 知识点练习证据评估

已改编 `deeptutor/learning/mastery.py::compute_mastery` 至
`services/quiz/app/services/evidence_scoring.py`，原权重与一/二次上限保留。
BetterLearn 在调用前按历史知识点版本和精确题目内容去重，只输入每种内容的首次可信作答，
避免重复练习替换初始表现。查询单个数据库快照返回统计及最多五条可追溯依据。

这不是掌握度写回：不移植 policy.py 的 memory/procedure 0.9 门槛或 concept/design
质性通过，因为 Core 类型与现有选择题评估不满足这些假设。分数不代表校准能力，首次交卷
也不证明未见题目。没有期限/目标分数实体或模拟考试。契约见 contracts/knowledge-assessment.md。
源码 revision 与许可证记录于 services/quiz/third_party/DeepTutor/PROVENANCE.md。


## 2026-09-18 期限学习目标补充

期限＋目标证据分数的管理实体由BetterLearn实现，复用已改编的DeepTutor评分函数和既有来源版本/可信作答查询；不是移植DeepTutor完整目标管理模块。冻结条件、截止过滤、幂等创建、归档CAS和schema6迁移属于BetterLearn适配层。不导入policy.py的掌握门槛，也不提供模拟考试成绩认证。契约见contracts/learning-goals.md。

## 2026-09-18 多来源组卷与计时自测补充

再次只读核对本地 `deeptutor/tools/question/exam_mimic.py`：它是AgentCoordinator仿题生成包装，没有可直接迁入的计时考试状态机。本次复用已改编的DeepTutor选择题判分、题库，以及BetterLearn已有精确内容键和成绩/报告投影；新增组卷匹配、覆盖审核、计时/CAS、schema7持久化属于BetterLearn适配层，不伪称来自上游完整考试模块。

多来源按知识点版本配额从已有题库组卷，缺口显式返回，题库不足时使用既有来源出题能力补充，不在组卷时调用模型。覆盖需要用户逐题显式审核；本机自测不能保证未看过答案。成绩原子进入可信历史，AI报告仍独立。契约见 contracts/exams.md。

## 2026-09-18 题库与复习前端

已改编 `web/components/space/question-bank/CategoryManager.tsx` 的新建、行内改名、
忙碌状态、中文输入法 Enter 保护至 `src/client/quiz/components/BankCategoryManager.tsx`。
来源仍为 revision `31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f`，核对该文件无本地修改。
去除上游 i18n/Tailwind 依赖，使用现有 BetterLearn 样式与类型；删除改为页面内确认，
并明确仅解除分类关联。Apache-2.0 完整许可证随既有 Quiz third_party 构建资源分发。

题库范围、收藏和分类交互参考同目录 BankScopeRail/QuestionBankSection；列表、详情、
可信作答历史适配器和 Core 复习请求恢复状态机由 BetterLearn 实现。复习读取既有
learning-reviews API，不引入 DeepTutor 客户端判分、模型配置或 agent 运行时。
