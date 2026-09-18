# 题库集成与数据迁移

当前独立 Web 与 Electron 共用内置 Python 题库服务，Host 管理其启动、认证和退出。题库使用 SQLite，不需要 DSH 或 MySQL。页面通过 Host 的本机接口访问题库，无须手工复制 JWT。

## 代码来源

主要来源为 liyupi/yu-ai-learn 的本地修改副本，基线提交为 `32c7c1623d2bd88139534ed19c04f0545e72a0f8`，并非原样拷贝。MIT 许可证保存在 `services/quiz/LICENSE`，修改说明见 `services/quiz/PROVENANCE.md`。

选择题判分另从 DeepTutor 改编，Apache-2.0 许可证及出处在 `services/quiz/third_party/DeepTutor/`。具体接入范围见 [DeepTutor 复用说明](deeptutor-reuse.md)。

## 当前目录与配置

以下数据路径以 `--home` 为根，默认 `~/.betterlearn-web`：

| 内容 | 路径 |
| --- | --- |
| Core 数据库 | `core/phase1.db` |
| 题库数据库 | `quiz-data/quiz.sqlite` |
| 上传文件、向量、本地配图 | `quiz-data/uploads/`、`quiz-data/chroma/`、`quiz-data/images/` |
| 私有模型设置 | `settings.json` |
| 派生的题库环境配置 | `quiz.env`，由应用生成，不要手工编辑 |
| Python 环境 | `venv/`、`quiz-venv/` |
| MCP 请求去重记录 | `mcp-requests/` |

服务源码在仓库的 `services/quiz/app`，构建后位于 `dist/standalone/services/quiz/app`；桌面包包含对应 standalone 资源。源码和 Python 环境不是学习数据。

通过应用设置配置文本、Embedding、图片和检索服务。首次准备环境使用 Python 3.12，Core 与题库依赖相互隔离。启动和初始化命令见 [独立版说明](standalone-web.md)。

## 成绩与报告的当前边界

持久化报告使用当前用户数据库中的题目重新判分，客户端 `is_correct` 与请求中修改的答案不决定成绩；模型返回的正确率由服务端计分覆盖。既有历史报告没有自动重算。

成绩、答案和首次经验现在在交卷事务中保存，不等待 AI。报告只读取该轮题目快照与已保存答案；失败、取消或服务重启后可以单独重试，不能修改成绩。同一题卷可有多轮成绩，但仅首次交卷发放 `10 + 答对数 × 2` XP。

旧 `/report/generate` 入口也先保存唯一兼容轮次，再生成报告；失败后重试采用首次提交的答案，已有报告直接返回。匿名旧入口仍不保存成绩和经验。

前端已接入服务端草稿、多轮作答、交卷成绩与独立 AI 报告。未知结果保留原请求供重试，旧浏览器答题缓存需显式恢复。题库来源通过课程/单元 ID 显式绑定，或按知识点出题时自动关联；题目文字标签不作为可信来源。课程掌握度与题库统计仍各自保存。

## 作答 API

以下相对路径在 Host 下的前缀为 `/nobei/quiz/v1`，Python 内部为 `/api/v1`。所有新接口要求用户身份，Host 持有令牌，不让页面保存令牌。

| 方法、路径 | 作用 |
| --- | --- |
| `POST /quiz/{quiz_id}/attempts` | `{ "request_id": "稳定请求编号" }` 幂等创建轮次；同编号用于不同题卷返回 409 |
| `GET /quiz/{quiz_id}/attempts` | 该卷轮次摘要，包含未提交状态；按创建时间和内部序号倒序 |
| `GET /quiz/attempts/{attempt_id}` | 读取草稿、revision、正式成绩、报告状态 |
| `PUT /quiz/attempts/{attempt_id}/answers` | `{ "expected_revision": 0, "answer_records": [...] }` 保存完整的部分答案快照 |
| `POST /quiz/attempts/{attempt_id}/submit` | 同上结构，要求完整答案；原子判分、保存、发奖 |
| `POST /quiz/attempts/{attempt_id}/report` | 仅按该轮已保存成绩生成报告；完成后重复请求直接返回 |

`request_id` 和路径 ID 限 1–100 个 ASCII 字母、数字、下划线或连字符。
答案项包含 `question_id`、`selected_answers` 和非负 `duration_ms`，不信任客户端 `is_correct`。
草稿修订冲突、已提交后修改、已在生成报告返回 409；非法答案返回 422；无权限与不存在统一返回 404。
同一轮交卷重试允许题目和多选选项顺序变化，但答案与时长必须一致。

草稿成绩和 submitted_at 为 null；真实零分为 0。正式成绩汇总采用按次平均，草稿不参与。
旧历史列表仍一卷一行，显示最近一次提交的摘要，并提供 attempt_id/submitted_at/status；
旧 accuracy 字段为兼容页面保留未完成时的 0 占位，不应据此绘图。
旧题卷详情返回兼容轮次；完整多轮事实使用新接口读取。
这些是练习接口，题目快照含参考答案，不是隐藏答案的考试接口。

## SQLite v1/v2/v3/v4/v5/v6 → v7 升级

题库启动时检查 schema，v1/v2/v3/v4/v5/v6 先使用 SQLite backup API 生成同目录
`quiz.sqlite.pre-v7-<随机编号>.bak`，包含已提交 WAL 内容，文件权限为 0600；
备份失败则不执行迁移。备份成功后在事务中创建作答、答案和报告表，并创建题库、来源关联、持久化来源出题任务、学习目标和考试表，全部成功才更新版本为 7。
新库直接初始化 v7，后续启动不会重复导入。更高版本会被拒绝。

旧表保留，旧成绩、时间、报告和累计 XP 不重算、不重复发奖。
导入轮次通过 legacy_records_json 原样保留历史答案，包括旧版本允许的重复或未知题号；
新轮次仍使用严格约束的答案表。只有报告而没有答案的旧行保留兼容读取，不虚构成绩。
重启会把中断的报告标为 failed，成绩保持原样；报告生成也纳入 active-tasks 检查。

回退时先退出使用该 home 的应用，保留当前完整 home，并使用完整备份恢复到新目录。
若单独检查升级前数据库，应把 `.bak` 复制为另一目录下的 `quiz.sqlite`，用匹配的旧版本程序读取；
不要覆盖运行中的数据库，也不要把当前 WAL/SHM 与升级前数据库混合。
此自动备份只覆盖 quiz SQLite，不能代替下文的完整 home 备份。

## 题库与错题本 API

在 `/nobei/quiz/v1/question-bank` 下新增：

| 方法、路径 | 内容 |
| --- | --- |
| `GET /entries` | 分页条目；支持 scope、category_id、quiz_id、search、sort |
| `GET /stats` | total、wrong、ever_wrong、bookmarked、uncategorized |
| `GET /entries/{id}` | 题目快照、最新对错、作答/错误次数及分类 |
| `GET /entries/{id}/history` | 原始作答历史分页，包含 attempt_id、答案、对错、时长、交卷时间 |
| `PUT /entries/{id}` | 仅接受 `{ "bookmarked": true/false }` |
| `GET/POST /categories` | 列出/创建自己的分类（创建体为 `{ "name": "分类名" }`） |
| `PUT/DELETE /categories/{id}` | 改名/删除；删除仅解除分类关联，不删题目或历史 |
| `PUT/DELETE /entries/{id}/categories/{category_id}` | 幂等设置/移除分类关联 |

分页使用 page（默认 1）和 page_size（默认 20、最大 100）；sort 为 recent/oldest（按条目录入时间及 ID）。
搜索最多 200 字符，对题干、讲解和知识点标签按字面匹配，%/_ 不作为通配符。
scope 为 all/wrong/ever_wrong/bookmarked/uncategorized；显式 category_id 优先于 uncategorized。
每个用户的分类名称 trim 后按 casefold 去重；跨用户对象统一 404。

合法保存题目进入题库，未答题不算错题。题目按原题卷、题号和内容 hash 区分版本；
不同版本的状态独立。交卷在同一事务内保存成绩和题库状态，重复提交不重复计数。
wrong 为最新作答错误；改对后移出 wrong，ever_wrong 和历史仍保留。
新作答历史按提交关联的递增序号倒序，同毫秒交卷也与最新状态一致；旧 v2 回填按已保存的提交时间、原作答序号建立顺序。
报告成败不影响题库。不能通过题库 API 上传对错结果或修改成绩。

v3 升级回填已有题目及可信 v2 作答。v1 导入的 legacy_records_json 是旧客户端判分历史，
仍可从原历史接口读取，但不作为可信错题事实；不合法的旧题目不自动入库。
前端“题库”已接入筛选、搜索、收藏、分类和逐题作答历史。模拟考试使用已有题库组卷；“到期复习”读取独立的 Core 课程队列，题库状态不自动改变 Core 掌握度。

## 题目与 Core 知识点关联

GET/PUT `/question-bank/entries/{id}/source` 读取/修改当前关联。
公开写请求为 `{expected_revision, source: {courseId, unitId} | null}`。
Host 读取 Core 冻结课程单元，验证来源并生成内容版本，不接受浏览器提供的陈述或 hash。
每个题目内容版本最多一个当前关联；修订号避免覆盖并发修改，重复相同请求可安全重试。
来源已保存后，即使 Core 课程删除/归档，成功写入的相同请求仍可重放。
来源内容版本是导出的冻结单元快照 hash，不是当前 Core 知识点记录的 content_hash。

题库列表/详情返回 source/source_revision；交卷时在成绩事务中冻结当时关联，
历史页返回交卷时版本，之后解绑、改关联或删除 Core 课程都不改写旧成绩。
v4 迁移不推断历史来源；旧历史 null/null，新交卷从未关联时 null/0。
Quiz 私有写接口仅受管理的本机 Host 可用，并检查 JWT 用户归属。
关联表示用户选择的来源，不表示系统已证明该题评估该知识点；不自动更新掌握度。
前端题库详情已提供来源读取、版本展示、绑定和解除；用户选择活动课程与知识点，页面只发送 ID 和预期修订号。单题绑定为用户显式归因，按来源生成也只代表出题意图；模型不能自行写入可信来源。
完整契约与跨语言样例见 contracts/quiz-source.md / quiz-source-v1.json。

## 知识点版本作答统计

GET `/question-bank/knowledge-stats` 按交卷时知识点 ID＋内容版本汇总，
支持 page/page_size、knowledge_point_id/content_version 过滤。
GET `/question-bank/knowledge-stats/history` 要求指定 ID＋版本，返回可核对的作答明细。
只纳入可信已交成绩与当时已捕获的来源，不读取当前映射；后续关联/解绑不会回填历史。

总正确率按全部作答计算；首次和最近正确率按每种题目内容计算。
题目内容按题型、题干、选项、答案和图片 URL 精确去重，忽略题号、卷 ID、标签、
难度和讲解，区分重复作答与不同内容。同 ID 不同来源版本分别统计，同版本跨课程合并。
时间相同也按持久提交关联序号确定先后。摘要省略长 evidence，原条目历史保留完整来源。

此结果是练习统计，不是校准掌握度；不自动推进 Core 课程状态。
接口只读，当前 schema 为 v7；聚合会扫描用户相关历史，分页仅限制响应规模。
前端“学习统计”已展示知识点版本统计、分页作答明细及对应成绩入口；无证据与真实零分分开显示。完整字段与分母定义见 contracts/knowledge-stats.md。

## 按 Core 单个知识点出题

POST `/quiz/generate/from-source` 提交 request_id 与 source:{courseId,unitId}，
可选 user_input/question_count/difficulty/generate_images。默认5题，仍限制3–10题。
Host 校验 Core 冻结单元并固定内容；Quiz 持久化完整请求与来源，以用户＋request_id 去重。
相同请求重放返回同一任务，不重复调用模型；同键异参数409。Core 来源删除后也可重放已接受请求。

工作器只领取一次任务，以该来源替代联网/RAG上下文，复用当前文本/图片模型配置。
生成结果先通过题数、题号与既有判分规则校验，再把题卷、题库、来源关联与任务成功状态同事务落库。
模型输出中的额外来源 ID 不会进入可信映射。用户选择的是预期出题范围，不代表题目覆盖性已审核。
生成后正常交卷即可参与知识点版本统计，不回写 Core 掌握度。

失败/重启中断保留失败任务；重放不自动重试，需用户显式使用新请求 ID 发起另一次生成。
图片和模型调用不在数据库事务内，已发生的费用不能回滚。轮询沿用 /quiz/task/{task_id}，
来源任务检查用户归属。私有来源请求查询未暴露到公共代理白名单。
本入口已由 MCP 的 `betterlearn_generate_source_quiz` 暴露，并提供学习书/课程发现与知识点统计工具；前端“知识点出题”已接入显式生成、原请求恢复、任务查询与练习入口。MCP 不开放配图或来源快照参数，复用持久请求日志。契约见 contracts/source-generation.md 与 contracts/mcp-learning.md。

## 当前独立版备份与恢复

先退出使用该 home 的应用。`backup` 使用同一数据目录锁，运行中的实例会阻止备份。当前备份清单为：

- `core/` 与整个 `quiz-data/`，包括两个数据库、上传文件、Chroma 和本地图片。
- `settings.json`、`identity.json`、`library.json`、`library-delete.json`。
- `mcp-requests/`，用于保留请求去重事实，避免恢复后丢失该记录。

备份带文件校验清单，也包含私有模型设置，应按私有数据保存。不包含 Python 环境、`runtime.json`、派生的 `quiz.env`、运行期连接令牌或外部 COS 对象。

恢复仅支持全新目录，验证文件及校验值后写入。恢复后运行 `init` 重建环境，应用重新生成匹配路径的 `quiz.env`。不要拼接不同时间点的数据库、文件与向量目录。`init` 不会自动备份，升级前须自行备份。

## 旧教程或 DSH 数据迁移

旧 MySQL 数据库、旧 DSH home 与当前 SQLite home 不兼容。当前没有通用的 MySQL → SQLite 数据转换器，不能把旧数据库导出文件直接交给 `restore`，也不能沿用旧 `packages/<安装标识>/package/` 安装说明。

迁移前保留原环境，对原数据库、上传文件、向量和外部对象分别做可恢复备份。需要专项转换用户归属、文档与题目 ID、答题记录和文件路径，并在全新目标 home 验证；不要直接操作日常使用的原库。已有向量还需核对 Embedding 模型和维度，不能仅复制目录就认定迁移成功。

本次文档修订没有执行用户数据迁移或恢复。

## 知识点练习证据评估（只读后端）

GET `/nobei/quiz/v1/question-bank/knowledge-assessment` 必须提供知识点 ID 与历史 content_version，返回练习证据分数、数量和最多五条可追溯的首次作答依据。

按已有精确题目内容键去重，每种内容只取首次可信交卷，再取最近五种内容，复用 DeepTutor mastery 的加权及少样本上限。相同题目跨卷复制或重答不增加证据分数；纠错仍反映在 latest_accuracy。证据分数为 0..1，无证据为 null，正确率仍为百分制。

available 表示至少三种题目内容，不代表已经掌握；首次交卷也不保证未看过答案。该查询不更新 Core 掌握度、复习或 XP，不调用模型。评估本身不新增迁移，当前 Quiz schema7/Core schema2；前端学习目标详情展示对应期限内的证据评估，独立的不限期限评估仍通过 HTTP API 与 MCP 使用。MCP 已通过 `betterlearn_knowledge_assessment` 提供同一只读评估（共 17 工具）。详细口径和限制见 contracts/knowledge-assessment.md。


## 带期限的学习目标

`/nobei/quiz/v1/learning-goals` 支持创建、列表、详情与归档。公开创建仅接收课程/单元ID，由Host冻结来源；默认目标证据分数0.9、至少5种题目内容，并要求一个明确的未来截止时间。条件创建后不可修改，归档使用revision防并发覆盖。

计入相同知识点历史版本的已有可信作答；详情在同一数据库快照内只评估截止时刻之前（含该时刻）的交卷。重复题目不补内容数量，晚交不追溯改变期限目标；独立评估接口继续展示全部历史。criteria_met是当前目标条件判定，不是永久完成记录或能力认证。

同用户同request_id同参数重放返回原目标，包括归档状态；来源删除或期限已过仍可重放，改参数复用编号409。新增Quiz schema6及升级前备份，现有quiz-data备份恢复包含目标和去重。目标操作无需模型，不自动出题、不回写Core。MCP已接入目标列表、详情、显式创建和归档／恢复（共17工具）；前端已接入创建、列表、进度、归档和恢复。契约见contracts/learning-goals.md。

## 多来源试卷、覆盖审核与模拟考试（2026-09-18）

新增 `/exam-papers` 的预览、幂等创建、逐题审核，以及 `/exam-sessions` 的计时、草稿保存和统一交卷。按已冻结知识点版本分配题库题数，全卷精确内容去重；数量不足返回缺口，不自动调用模型。全部显式审核通过后开考，考试接口交卷前隐藏答案。截止后只结算此前保存的草稿，重启不延长时限。GET只读返回expired；POST submit执行到期结算。

成绩与冻结来源在同一事务进入普通作答历史，报告继续通过独立attempt报告入口生成。考试XP为0，不自动回写Core掌握度。Quiz当前schema为 **7**，旧版本升级前`.pre-v7-*.bak`备份，Core schema2不变。新HTTP API契约及边界见 [contracts/exams.md](../contracts/exams.md)。前端已接入组卷缺口预览、逐题覆盖审核、计时答题、草稿、结算和成绩；MCP仍17工具（考试经HTTP使用），本机自测不提供防作弊保证。
