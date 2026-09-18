# BetterLearn 下一 session 交接

更新时间：2026-09-18。仓库 `/Users/guyue/Documents/code/betterlearn-for-dsh`，分支 `codex/electron-desktop`。

## GitHub 提交授权（2026-09-18）

用户已明确要求“推送 GitHub”，此前各节“未提交”是阶段性历史状态。此次统一整理 Electron、MCP/插件、学习后端、共享前端、测试、契约与文档到 `codex/electron-desktop` 分支；目标远端 `origin` 为 Zer0Rin/betterlearn-for-dsh。

推送前重新运行 Web 全套 **624 passed** 并完成构建、diff check 和待提交文件检查；没有构建二进制或常见密钥格式。`.gitignore` 已覆盖整个 output/，本地安装包、验收脚本/截图和用户数据不提交。实际提交编号与远端状态以 Git 历史为准。

## 最新更新：安装镜像与使用文档收尾完成

用户继续授权收尾。此节优先于下文“本轮未重做 DMG”的历史说明；所有源码改动仍未提交。

- 以已验收的最终 `.app` 制作新 DMG，保留旧产物。最新路径：`dist/installers/verified-2026-09-18/BetterLearn-0.1.0-arm64.dmg`。
- 镜像完整性校验有效；只读挂载逐项比对 498 个文件/符号链接，内容/链接目标/可执行标记与已验收 `.app` 一致。临时挂载已卸载。SHA-256 为 `9be91682f04846abd97fa7ec0eea0989e7141d8c74f880455135fa146c78d8b7`，同目录有校验清单与 verification.json。
- 新增 docs/learning-workflows.md，覆盖资料→课程、练习成绩/独立报告、题库来源、来源出题、学习目标与统计、复习、计时考试和恢复边界。README 已指向指南。
- 清理 docs/quiz-integration.md 中“前端暂停/未接入”的旧阶段陈述；保留独立知识评估只读 API 与目标内评估的区别。桌面文档更新验收范围与最新包位置。
- 本轮只改文档和本地构建产物，没有业务变更，不重复全套测试；镜像校验、应用内容比对、文档本地链接检查和 diff check 通过。此前最终桌面与后端验证结果见下一节。
- 未签名/公证，仍需 Python 3.12；未发布远端、未安装到 Applications、未使用日常 home。dist/output 为忽略的本地产物。

## 最新更新：桌面集成与打包应用验收完成

用户继续授权，本轮重点验证已完成前端在真实 Electron 与打包应用中的行为；所有源码改动保留、未提交。

- 桌面验收新增知识点出题、自动来源、题库详情、复习入口、目标、组卷审核、考试草稿与退出重启流程。脚本 scripts/verify-desktop-learning.mjs 由原 verify-desktop.mjs 调用，沿用临时 home/fake provider。
- 重启后恢复原生成任务和考试答案，截止时间不变；交卷 1/3 正确、XP=0，准确成绩和三条知识点历史可打开，报告保持 not_requested。重启后无新增模型调用、无未处理 renderer 错误。
- 原生截图发现页面标题在透明深色背景上对比不足，src/standalone/window.css 给桌面练习页 .zl-heading 增加跟随组件透明度的底色。验收确认底色90%、文字opacity1，并查看最终原生截图。
- 最新验证：桌面构建成功；Core **414 passed**、Quiz **369 passed**（53 既有警告）、相关外观/客户端 **25 passed**、插件 **17 工具** 验证成功。Web 全套上轮624，本轮未全量重跑。
- 重新生成 macOS arm64 `dist/installers/mac-arm64/BetterLearn.app`，用实际打包可执行文件完整通过最终扩展验收。应用未签名/公证；本轮未重做 DMG，勿将旧 DMG 当作本轮最终产物。
- 验收应用和服务均已关闭，临时目录清理；日常数据与真实收费模型未使用。未测试其他平台。

完整记录：docs/desktop-verification.md；执行计划：docs/superpowers/plans/2026-09-18-desktop-learning-verification.md。测试截图位于 dist/desktop-verification，均为忽略的本地构建产物。

## 最新更新：学习统计中的知识点版本统计已接入

用户继续授权完善前端。当前学习统计已有总体指标，本轮补齐已有知识点统计只读 API 的页面入口；所有改动未提交。

- 学习统计新增知识点版本列表：首次/最近/总体正确率、不同题目与重复作答数、交卷轮数、历史来源说明和版本展示。不同版本独立显示，真实零分与暂无证据分开。
- 每个版本可打开分页作答记录，再跳转到准确 quiz/attempt 的成绩；时间按 UTC 转本地，列表保持服务端入库顺序。只用交卷时冻结的来源，不根据当前绑定重算旧记录，不写课程掌握度或调用模型。
- 加载/错误/空态与分页齐全，刷新失败不冒充新数据；记录减少时回退有效页；切换版本或卸载后终止请求并忽略迟到结果。
- 验证：Web **69 文件 / 624 passed**（新增 7 项）；TypeScript / standalone 构建成功。扩展真实 Host 集成测试后单独重跑通过：绑定前旧答案不补算，绑定后恰好 3 份证据，版本过滤/成绩归属准确，读统计无新增模型调用。diff check 通过。
- Playwright 用临时 home / fake provider 验证统计显示 100%、3 道不同题、0 次重复，查看版本的三条历史并进入 100% 的对应成绩；独立 AI 报告仍未自动生成。浏览器 0 errors / 0 warnings；截图 output/playwright/knowledge-statistics.png 已查看。
- 本轮未改后端规则/schema，未重跑 Core/Quiz 全套、桌面打包或插件验证。验收服务和浏览器已关闭，临时 home 已清理；未操作日常数据。

设计：docs/superpowers/specs/2026-09-18-knowledge-statistics-frontend-design.md；执行记录：docs/superpowers/plans/2026-09-18-knowledge-statistics-frontend.md。

## 最新更新：来源绑定与按知识点出题前端已接入

用户在四阶段完成后继续授权，并明确选择“来源绑定与按知识点出题”。此节优先于下方历史范围说明；所有改动保留、未提交。

- 独立应用和共享练习工作台新增“知识点出题”入口，选择活动课程与知识点，指定题数（3–10）、要求、难度及可选配图。显式生成才调用模型。
- 题库详情新增来源读取、版本展示、绑定和解除。只提交课程/单元 ID 与原 source_revision；说明不重算旧成绩，不代表覆盖审核通过。
- SourceOperations 在发送前保存完整请求，未知结果只能重试原请求；刷新恢复稳定请求号/原 revision。存储失败不发送，另一窗口恢复记录不覆盖。确定拒绝后允许显式清除并重读。
- 来源生成保存任务号；只读轮询最多十五分钟，错误后可继续查询。失败不自动重新生成。成功显示“打开这份练习”，进入已有练习流程；准备新一组题目需要显式点击，来源仍需检查覆盖。
- 验证：TypeScript / standalone 构建成功；Web **68 文件 / 617 passed**，新增 9 项回归；最终导航/结果布局调整后直接相关 **19 passed**。真实 Host 测试自动来源映射、丢响应重放同任务且无额外模型调用、解绑和旧版本拒绝；既有练习/目标/考试链一并通过。
- Playwright 用临时 home 与 fake provider 验证选择课程知识点、生成三题、打开练习、查看自动来源、保存绑定、刷新后恢复已完成任务。截图 output/playwright/source-generation.png；浏览器 0 errors / 0 warnings。未调用真实收费 API 或操作日常数据。
- 本轮只改前端、接口客户端与测试/文档；未改后端规则。Core/Quiz 全套、Electron 打包、插件验证本轮未重跑。

设计：docs/superpowers/specs/2026-09-18-source-frontend-design.md；计划：docs/superpowers/plans/2026-09-18-source-frontend.md。

## 最新更新：前端第四阶段——模拟考试完整流程已接入

用户继续授权第四阶段。此节优先于后文历史记录，既定练习/题库复习/学习目标/模拟考试四阶段前端均已接入；所有改动保留、未提交。

- 新增模拟考试导航、分页试卷与考试列表。组卷从题库当前来源快照选择知识点版本和配额，预览缺口/无效候选，条件变化使预览失效；只用已有题库，不自动出题。创建后冻结题目。
- 覆盖审核逐题显示题干、答案解析和来源结论，显式勾选并写备注，保存完整审核。全部已保存通过的当前版本才可确认开考；明确告知开考即计时、首次开考后审核锁定。
- ExamOperations 为创建/审核/开考/草稿/交卷持久化完整原始请求；创建和开考稳定 UUID，CAS 原 revision，未知结果同请求重试，确定拒绝后显式丢弃并重读。存储失败不发送，不覆盖其他窗口待处理请求。
- 考试页仅使用会话白名单题目，单选/判断/多选、本地草稿与显式服务端保存。刷新恢复按 revision 校验，冲突不覆盖；本地损坏记录可明确丢弃，另一窗口更新草稿时停止覆盖。倒计时按本机估算，每 15 秒及聚焦只读核对，服务端 expired 才锁定编辑；明确点击结算到期成绩，迟到本地答案不计入。
- 成绩展示服务端总分、未答、各来源、逐题标准答案和到期原因；进入现有指定 attempt 的独立报告流程。模型不参与组卷、审核、开考与判分；考试不发 XP 或改 Core 掌握度。
- 浏览器验收发现考试投影的 summary 为 null 导致普通详情 Pydantic 校验 500；已添加先失败后通过的 Python 回归，quiz_repository 读取时兼容为空字符串，覆盖既有考试，不修改 schema 或评分规则。
- 最新验证：Web **66 文件 / 608 passed**；Quiz **369 passed**（53 既有警告）；TypeScript / standalone 构建、diff check 通过。真实 Host 验证预览缺口、审核门槛、丢响应开考重放、草稿重启和截止不变、各来源成绩与无自动报告。
- Playwright 实测 1 分钟截止：第一题已保存、第二题仅本地修改，到期仅记 1/3 正确（33%）、未答 2、XP=0、交卷时间等于截止；截图 output/playwright/exam-running.png / exam-result.png。修复后再次验证成绩入口和显式 fake 报告，成绩不变、控制台 0 errors / 0 warnings。
- 使用临时 home 与 fake provider，未操作日常数据/真实收费 API；临时服务及浏览器收尾关闭。未重跑 Core 全套、Electron 打包和插件验证。

设计：docs/superpowers/specs/2026-09-18-exams-frontend-design.md；计划与验证：docs/superpowers/plans/2026-09-18-exams-frontend.md。
本次既定四阶段前端范围已完成。新增来源绑定/来源自动出题的专门前端入口、考试 MCP、打包发布等未作为本轮扩展；若继续应按用户新指示确定范围，不误清理或提交当前工作树。

## 最新更新：前端第三阶段——学习目标已接入

用户继续授权按既定顺序推进。本节优先于下面历史记录；所有改动保留、未提交。

- 导航增加学习目标，支持未归档/归档/全部分页列表、创建和详情。创建从学习空间已有活动课程选择知识点，输入证据分数、不同题目数量和本地时区截止；只传课程/单元 ID，由 Host 冻结来源。没有课程时引导先开始学习；被外部删除的课程不阻塞其他课程，服务故障明确报错。
- 详情读取服务端 criteria_met、deadline_passed 和完整 progress，展示证据分数/数量双门槛、首次与最近正确率、重复作答、最近五份首次答案依据、评估/证据截止时间和冻结版本。暂无证据与零分分开；不把分数当掌握度，不从列表定义推断达标，不自动出题或提醒。
- GoalSession 发送前持久化创建 UUID 与完整请求、归档原 revision；结果未知明确同请求重试，跨页面/刷新恢复，不自动换编号或提升 revision，阻止重复点击和覆盖另一窗口待处理记录。已知拒绝需放弃旧请求再读取。归档/恢复不改条件和截止。
- 浏览器验收发现历史 SQLite 无时区时间被当成本地时间，已以失败测试复现并修正为 UTC 转本地。目标表单/详情内边距也已检查调整。代码按 goal-types、goal-session、goal-time、goal-courses、创建表单、进度详情和列表页面拆分，无新依赖。
- 最新 Web **64 文件 / 596 passed**，TypeScript / standalone 构建和 diff check 通过。真实 Host 验证丢失响应重放不重复创建、来源证据归属、100% 但 3/5 未达标、归档/恢复和旧版本冲突；目标操作不增加模型调用。Playwright 完成创建/刷新/归档/恢复，0 errors / 0 warnings，截图 output/playwright/goal-progress.png。
- 本轮不改后端业务/schema，未重跑 Core/Quiz 全套、Electron 打包或插件验证；使用临时数据与 fake provider，无真实付费 API。验证临时服务和浏览器在收尾时关闭。

设计：docs/superpowers/specs/2026-09-18-goals-frontend-design.md；实施与验证：docs/superpowers/plans/2026-09-18-goals-frontend.md。
下一阶段：模拟考试前端（多来源组卷、缺口提示、覆盖审核、计时答题、成绩及独立报告）。本轮尚未实现。

## 最新更新：前端第二阶段——题库与跨课程复习已接入

用户以“继续”授权推进。此节优先于下面第一阶段及“前端暂停”的历史记录；全部改动保留、未提交。

- 新增题库和到期复习导航。题库支持全部/当前错题/曾经答错/收藏/未分类、字面搜索、分类过滤、排序和分页；详情展示冻结题目、可展开解析、收藏/分类、逐题交卷历史，能跳到原卷对应轮次。
- 分类管理支持新增、改名、显式确认删除；删除只解除关联，保留题目和成绩。复用本地 DeepTutor 分类交互并补充 docs/deeptutor-reuse.md 与 PROVENANCE 记录。写入异常要求先重新读取，不自动重复创建。
- Core 到期/补救队列直接使用独立 review API，不依赖 quiz 登录和模型配置；提交显示服务端判定与下次时间。ReviewSession 在发送前持久化完整冻结请求，恢复后保留选项、同键显式重试；冲突需明确放弃并重读，不覆盖另一窗口记录；损坏记录可显式放弃。
- 最新 `corepack pnpm test`：**60 文件 / 582 passed**，TypeScript / standalone 构建通过。真实 Host 验证错题投影、分类/收藏/历史、Core 补救及无额外模型调用；Playwright 实际完成收藏/分类和补救答题，下次复习时间正确、控制台 0 errors / 0 warnings。截图 output/playwright/question-bank.png 和 output/playwright/review-result.png。
- 本轮未改后端业务或 schema，未重跑 Core/Quiz 全套、Electron 打包和插件验证；使用临时 home 与 fake provider，已关闭临时服务及浏览器。diff check 通过。

设计：docs/superpowers/specs/2026-09-18-bank-review-frontend-design.md；计划与验证：docs/superpowers/plans/2026-09-18-bank-review-frontend.md。
下一阶段按既定顺序接学习目标，再接模拟考试；这两组前端尚未实现。

## 最新更新：前端第一阶段——练习、成绩与独立报告已接入

用户已明确确认恢复前端；本节优先于后文“前端暂停”的历史约束。本轮完成第一阶段，所有现有改动保留、未提交。

- 共享 Web/Electron 练习前端接入六个 attempt API：创建、列表、读取、保存、交卷、独立报告。未改后端规则或 schema。
- 新增 services/practice.ts 管理稳定创建编号、待保存/待交卷原始载荷、服务端修订号、串行写入和结果未知时的只读核对；各轮 pending 分键持久化。草稿保存失败保留本地答案；冲突不提高 revision 覆盖服务端，提供显式舍弃本地入口。浏览器存储不可写时不发送缺少恢复记录的新写请求。
- PracticePanel 与 AttemptHistory 共用轮次控制器。正式成绩、逐题结果、时间、XP 只读服务端；报告失败仍能看成绩。报告仅用户点击生成/重试，运行中有界 GET 轮询，退出解除订阅/轮询，已接受请求仍完成原轮次。
- 历史提供各轮草稿/成绩选择和新一轮练习；没有报告也可查看成绩，同卷第二轮正常显示 0 XP。首页/列表区分未交卷与真实零分，并隐藏旧接口未交卷 0 道题占位。旧浏览器答案需显式恢复为独立草稿，保留原始记录；异常旧报告只读展示，不补造成绩/XP。
- Web **56 文件 / 563 passed**，TypeScript/standalone build 和 diff check 通过。新增真实临时 Host 集成验证草稿重启恢复、无需模型交卷、单独报告、第二轮 XP=0。Playwright 实际答题至 67%/14 XP，再显式生成 fake 报告，成绩不变、控制台无错误；截图 output/playwright/practice-result.png。
- 本轮未重跑 Core/Quiz 全套或插件验证，未打包 Electron；后端历史验证记录见下文。全部新验证使用临时数据及 fake provider，没有使用真实付费 API 或日常 home。

设计：docs/superpowers/specs/2026-09-18-practice-frontend-design.md；计划与验证：docs/superpowers/plans/2026-09-18-practice-frontend.md。
下一阶段依用户既定顺序：题库与复习 → 学习目标 → 模拟考试。这三组前端本轮尚未接入。

## 最新更新：剩余三项后端已补齐——多来源组卷、覆盖审核、计时自测

用户要求“把后端做完”。本节优先于下方历史记录；前端继续暂停，所有现有改动保留，未提交。

- 新增 `/nobei/quiz/v1/exam-papers` 预览/创建/列表/详情/逐题审核和开考，以及 `/exam-sessions` 列表/详情/保存/交卷。严格输入、Host白名单、同源检查和用户隔离沿用现有边界。新能力通过HTTP提供，MCP仍17工具，未安装新插件。
- 多来源以知识点ID＋内容版本＋配额从既有题库选题，1..20来源、总计1..100题；内容精确去重，匹配算法可回退调整分配。预览只读并返回缺口，数量不足不创建部分卷、不自动调用模型。冻结题目和来源快照；题库变化/Core删除不影响原卷。快照8MiB上限，标准答案无法自判为正确的题目不会被选中。
- 覆盖审核必须完整逐题显式批准才能开考，CAS保存可安全重放；首次开考后锁定。数量匹配不等于语义覆盖证明；本机题库仍可查答案，因此定位为自测，不承诺防作弊或未见题。
- 考试服务端UTC计时，60..14400秒，开考UUID去重不重置时限。交卷前会话只给题干/选项等白名单，不暴露答案/解析/正确性。草稿全量替换＋CAS；漏题/空选项算错，多选严格匹配。到期GET只读显示expired；下一次submit只结算此前已保存草稿，不接收迟到答案。
- 交卷事务同时保存成绩和普通quiz/attempt及冻结来源题库历史。旧练习接口只能在交卷后看到该普通quiz。分数含总分/逐题/各来源，XP为0；重复题不增加独立知识证据。报告通过既有attempt报告接口独立生成/失败重试，不影响成绩。不改Core掌握度或调度。
- Quiz schema **7**，v1..6升级前`.pre-v7-*.bak`，失败整笔回滚；Core schema2不变。12项迁移用例验证成功/失败、备份和XP保留。旧迁移测试已同步最新版本断言。
- 最新全量：Quiz **368 passed**（53既有警告），Web **51文件/538 passed**，Core **414 passed**；TypeScript/standalone build、串行插件17工具验证、diff check通过。考试17项专项测试。真实Host测试验证Core删除后组卷、进行中考试经重启和home备份恢复、再交卷及证据去重；fake provider调用数不增加。
- 独立审查发现空白标准答案键会被选入，已补先失败后通过回归并修复；复查无其他明确问题。未调用真实收费模型、未操作日常home/迁移日常库、未改前端、未提交或清理工作树。

契约：contracts/exams.md；设计：docs/superpowers/specs/2026-09-18-exam-backend-design.md；计划：docs/superpowers/plans/2026-09-18-exam-backend.md。源码按 models/exam.py、core/exam_schema.py、repositories/exam_paper_repository.py、repositories/exam_repository.py、services/exam_result.py 和 routes/exam.py 拆分。复用既有DeepTutor改编判分/题库；计时状态机和组卷为BetterLearn适配，不宣称上游已有完整考试。

上一阶段列出的三项后端缺口在上述范围内已完成。未来可选扩展是考试MCP包装、自动多来源生成编排或防作弊产品；本轮不以这些扩展替代已完成的HTTP后端。前端恢复仍须明确指示。

## 最新更新：学习目标已接 MCP（17 工具）

本节优先于下方历史记录。前端继续暂停，所有现有工作区改动保留，未提交。

- 新增 `betterlearn_list_learning_goals`、`betterlearn_read_learning_goal`、`betterlearn_create_learning_goal`、`betterlearn_set_learning_goal_archived`，总计 **17 工具**。复用已实现的目标 HTTP/Quiz 契约，无新增目标评分或期限规则。
- 创建由共享 Host 适配器读取 Core 冻结来源；Quiz 按用户＋request_id 去重，与生成日志命名空间分离。并发同参数返回同一目标，课程删除或重启后仍可重放原目标。目标操作无需模型配置、不调用模型、不写生成日志。
- 所有输入保留 SDK strict 校验。归档原样传递 expected_revision，冲突不自动递增；写入传输失败、5xx或无效成功响应返回 GOAL_RESULT_UNKNOWN，保留原参数/UUID，不自动重试或换编号。准备失败不发送 POST，错误不泄露上游正文。
- 实现在 src/standalone/mcp-goals.ts；安全错误类移至 mcp-errors.ts，mcp-service.ts 保留重导出。三份插件技能源同步：只问进度仅查询，明确要求才创建/归档，缺少期限或时区需澄清；目标不是提醒，不隐式出题。
- 最新 Web **51 文件 / 537 passed**（MCP 11 项），TypeScript/standalone build 通过；串行 test:plugins 通过，两份生成配置均验证 **17 工具**。真实 SDK/Host 验证并发去重、HTTP 一致性、归档冲突、Core 删除及重启重放，保留备份恢复覆盖。独立审查无实现遗留问题，旧契约工具数量已修正。
- 本轮 Python 无改动，Quiz schema6/Core schema2 不变；上阶段 Quiz **339 passed**，本轮未重跑。未调用真实收费模型、未操作日常 home、未改前端或提交工作树。更新了插件源码和生成包，**未重装用户已安装插件**。

计划：docs/superpowers/plans/2026-09-18-mcp-goals.md；契约：contracts/mcp-learning.md、contracts/learning-goals.md。模拟考试、多来源组卷及覆盖审核仍未实现；前端恢复须用户明确指示。

## 最新更新：带期限与目标分数的学习目标后端已实现

用户以“继续”确认方案，本节优先于下方历史记录。前端继续暂停，所有现有工作区改动保留，未提交。

- `/nobei/quiz/v1/learning-goals` 支持POST创建、GET列表；`/{goal_id}`只读详情；`/{goal_id}/archive` PUT归档CAS。公开创建只接受课程/单元ID，Host读取Core冻结来源。默认目标证据分数0.9＋至少5种内容，截止时间必填并规范为UTC毫秒。
- Quiz按用户＋request_id保存规范化摘要和原始冻结条件；相同参数重放原目标，变更条件409。重放先于未来期限校验；Core删除/已过期仍可重放，归档不会被创建重放撤销。私有请求预查询仅受管理Host可访问，公共代理不开放。
- 详情同一事务读取目标和可信历史，cutoff=min(读取时刻,截止时间)，只计截止之前（含该时刻）提交。复用已有distinct_first_v1评估，旧的全历史评估接口口径不变。包含创建前历史，同题重答/复制不补数量。
- criteria_met只是用户条件判定，截止前会随首次错答回落，不保存永久完成徽章；归档可取消但不重置期限。目标操作不调用模型、不改XP/Core掌握度/复习；本机记录UTC是时间依据。
- Quiz schema **6**，v1-v5启动升级前生成`.pre-v6-*.bak`，失败回滚；Core schema2不变。临时库验证所有旧版本成功/失败路径、已有成绩/XP保留。真实临时home验证目标、归档与创建去重经备份恢复后保留。
- 最新 Quiz **339 passed**（53既有警告），Web **51文件 / 534 passed**，TypeScript/standalone build和diff check通过。真实Host链路验证Core删除重放、期限/内容统计、重启及备份恢复；独立审查无需修改问题。
- 未调用真实收费模型、未操作日常home、未改前端/插件工具、未提交或清理现有改动。MCP仍13工具，目标目前仅HTTP；本轮未重装插件。

契约：contracts/learning-goals.md；设计/计划：docs/superpowers/{specs,plans}/2026-09-18-learning-goals*。后续可接入目标MCP；模拟考试、多来源分配/覆盖审核仍未实现。前端恢复须用户明确指示。

## 最新更新：练习证据评估已接 MCP（13 工具）

本节优先于下方历史记录，前端继续暂停。

- 新增只读 `betterlearn_knowledge_assessment`，仅接收统计结果中的 knowledge_point_id＋content_version，转发既有评估GET。原样返回null/0、分数和basis；无需模型配置、不写生成日志、不触发模型或更新掌握度。
- 修复审查发现的MCP注册层问题：原schema.shape丢失strict规则，SDK会静默剥离额外参数；现传递完整schema，真实SDK测试验证评估、status和两种生成工具的额外参数在执行前被拒绝。
- 插件三份技能源说明同步，明确0..1分数、首次内容去重、少样本上限、满分不等于掌握和禁止自动补题。
- Web全量 **51文件 / 531 passed**（MCP8项），构建通过；串行 `test:plugins` 验证两份生成配置均有 **13工具**，未配置模型可读空评估且零模型调用。真实stdio评估与HTTP一致，重启后结果一致。独立复审无遗留问题，diff check通过。
- Python无改动或迁移，上一阶段Quiz304通过记录仍适用但本轮未重跑；Quiz schema5/Core schema2不变。未调用真实模型、未操作日常home、未改前端、未提交或清理工作树。
- 更新的是源码和生成插件包，**没有重装用户已安装插件**。既有安装记录不等于已升级至13工具。

计划：docs/superpowers/plans/2026-09-18-mcp-assessment.md；契约：contracts/mcp-learning.md、contracts/knowledge-assessment.md。期限＋目标分数实体、模拟考试、多来源分配/覆盖审核仍待实现；前端恢复需明确指示。

## 最新更新：知识点练习证据评估已实现

用户已确认设计，本节优先于下方历史记录。前端继续暂停，现有未提交改动全部保留。

- 新增 GET `/nobei/quiz/v1/question-bank/knowledge-assessment`，必须提供 knowledge_point_id＋content_version，严格拒绝额外/重复/分页参数。公共非法参数404、私有422、合法参数下非GET为405；继续使用既有认证和用户隔离。
- 实际改编 DeepTutor `learning/mastery.py::compute_mastery` 为 Quiz 的 evidence_scoring.py，保留末五项权重和一/二项 0.5/0.8 上限，来源与 Apache-2.0 说明已同步。
- 输入取每种精确题目内容的首次可信交卷，再按持久关联序号取最后五种。跨卷复制/元数据变化/重复练习不增加证据；首答错误后改正仅反映在 latest_accuracy，不替换首次证据。
- 单个 SQLite 快照聚合数量、首次/最近正确率和评分依据。返回 evidence_score 0..1（无证据null）、small_sample_cap、evidence_state 以及最多五条可追溯 basis，不返回答案正文。
- 仅为启发式练习证据：available/满分不代表掌握，首次交卷不保证此前未看过答案。不回写 Core 掌握度/调度/XP、不调用模型、不新建任务。Quiz schema5/Core schema2不变，无迁移。
- 最新 Quiz 全量 **304 passed**（53 既有警告），其中新评估21项；Web全量 **51文件 / 529 passed**，含真实Host→Quiz读取评估与重启一致性；build/diff check通过。独立审查无需修改问题，并单独复验21项通过。
- 未操作用户日常home、未调用真实收费模型、未改前端、未提交或清理工作树。MCP仍为12工具，此评估入口暂为HTTP；本轮没有更新或重装插件。

契约：contracts/knowledge-assessment.md；设计/计划：docs/superpowers/{specs,plans}/2026-09-18-knowledge-assessment*。
后续仍未实现期限＋目标分数管理实体、模拟考试、多来源分配/覆盖审核；不能把本摘要说成完整目标管理或能力测量。前端恢复须等待用户明确指示。

## 最新更新：学习来源、统计与来源出题已接 MCP

本节优先于下方历史记录。前端继续暂停，所有既有未提交改动保留。

- 新增 `betterlearn_list_learning_books`、`betterlearn_read_learning_course`、`betterlearn_knowledge_stats`、`betterlearn_knowledge_history`、`betterlearn_generate_source_quiz`，MCP 共 **12 个工具**。前四个只读，不调用模型或修改掌握度。
- 来源出题使用真实课程/单元 ID，由共享 Host 适配器冻结来源；不接受外部快照、图片开关或任意 URL。仅在用户明确要求新练习时使用 BetterLearn 配置的模型。
- 两种生成工具共用 UUID 命名空间与持久日志；旧摘要兼容，跨工具复用编号冲突。发送前记录 dispatching；不确定结果在重启后仍禁止自动重发或换 ID。来源准备失败不会发 POST 或写入 dispatching。
- 已验证真实 SDK stdio 的学习书/课程发现→来源出题→HTTP 交卷→版本统计/明细，以及重启重放、只读无新增模型调用、参数冲突、来源准备失败和不确定结果。新增工具不提供交卷操作。
- 最新 Web 全量 **51 文件 / 528 passed**（其中 MCP 6 项）；`pnpm test:plugins` 串行构建和官方 SDK 验证通过，两份生成配置均发现 12 工具。首次与 Web 构建并行产生 dist 目录冲突，串行复验已消除。独立代码/技能情境审查无遗留问题，diff check 通过。
- 三份插件技能源文档同步，生成包已更新；**未重装用户已安装插件**。未调用真实模型、未操作日常 home、未提交或清理工作树。本轮无 Python 变更或迁移，Quiz schema5/Core schema2 不变；上一阶段 Quiz 283 passed，本轮未重跑。

契约：contracts/mcp-learning.md；设计/计划：docs/superpowers/{specs,plans}/2026-09-18-mcp-learning*。使用与验证范围见 docs/mcp.md、docs/plugins.md。
后续仍未实现多来源分配/覆盖审核、学习目标与模拟考试；前端恢复须等待用户明确指示。

## 最新更新：按单个 Core 知识点生成练习已实现

本节优先于下方历史记录。前端仍暂停，新增独立后端入口：

- POST `/nobei/quiz/v1/quiz/generate/from-source`：request_id＋source:{courseId,unitId}，可选 user_input/question_count/difficulty/generate_images。Host 仅接受来源 ID，固定 Core 冻结快照。
- Quiz schema **v5**：quiz_source_tasks 持久化完整请求/来源/digest，以用户＋request_id 唯一去重。v1-v4 启动前先生成 `.pre-v5-*.bak`，迁移不回填来源或重算 XP；Core schema2 不变。
- 一次性领取任务，使用来源陈述/证据代替联网/RAG上下文，复用已配置模型。输出来源字段不会进入可信关联；所有题目关联用户指定的单来源，表示出题意图，不是模型覆盖性审核。
- 题卷、题库条目、source revision1 和任务成功结果原子提交；保存失败全部回滚。模型/配图外部费用无法回滚。题数/题号/可判分性检查先于图片和保存，复用既有 DeepTutor choice 派生判分规则，不创建伪造学习成绩。
- 相同请求重放不再调用模型；改参数复用同键409。Core 来源删除后仍可重放已接受请求。失败或重启中断不会自动重试，显式新请求才再次调用模型。
- /quiz/task 对来源任务增加用户归属校验；私有 /quiz/source-request 查询只供受管理 Host，公共代理不开放。
- 已验证生成→自动关联→交卷→知识点版本统计链路。Quiz **283 passed**（53 既有警告），Web **525 passed**，build/diff check 通过；独立审查无新增权限/幂等/事务问题。
- 未调用真实模型、未操作日常 home、未改前端、未提交或清理已有工作树。新流程尚未接 MCP。

契约：contracts/source-generation.md；设计/计划：docs/superpowers/{specs,plans}/2026-09-18-source-generation*。
可继续给 MCP 接入只读知识点统计和显式来源生成，生成仍必须稳定 request_id、经过用户授权且使用 BetterLearn 自己的配置。多来源分配/覆盖审核、学习目标与模拟考试仍未实现。

## 最新更新：知识点版本作答统计已实现

本节优先于下方历史记录。新增只读后端，前端仍暂停。

- GET `/question-bank/knowledge-stats`：按交卷时 knowledge_point_id＋content_version 分组；过滤 ID/版本、分页。只纳入可信已交且有来源快照的作答，不读取当前映射/自由标签，不回写 Core 掌握度。
- 返回总作答、正确数、独立内容数、重复作答数、题库条目/轮次数，以及全部作答、首次作答、每题最近一次的正确率；分母已写入契约。
- 内容去重排除题号、题卷、标签、讲解、难度，以题型/题干/排序选项与答案/图片 URL 的 SHA-256 区分。跨卷精确复制不会重复算新题；不做语义去重、不宣称独立能力证据。
- GET `/question-bank/knowledge-stats/history`：指定 ID＋版本，读取作答明细与内容键，可追溯题库 entry。提交先后按持久关联序号，避免同毫秒或时钟回退歧义。
- source 返回历史快照摘要（省略 evidence），完整来源可从原题库条目历史读取。跨课程同版本合并，source 是该组最后一次来源示例。
- 无迁移，Quiz schema4/Core schema2 不变。聚合扫描用户相关历史，分页只限制响应，数据量大后再考虑增量聚合。
- Quiz **270 passed**（53 既有警告），Web 全量 **524 passed**，build/diff check 通过。独立审查无新增问题，复核统计测试9项通过。
- 未改前端、未调用真实模型、未操作日常 home、未提交/清理已有工作树。

契约：contracts/knowledge-stats.md；设计/计划：docs/superpowers/{specs,plans}/2026-09-18-knowledge-stats*。
后续可推进生成阶段的显式来源传递，减少手动关联；需区分用户提供的来源与模型归因候选，不能让模型自由填写可信知识点 ID。学习目标/模拟考试及掌握度策略仍未实现。

## 最新更新：题目与 Core 来源快照关联已实现

本节优先于以下记录。用户继续后已实现显式的单题来源关联，前端仍暂停。

- GET/PUT `/nobei/quiz/v1/question-bank/entries/{id}/source`：公开请求仅课程/单元 ID 或 null，加 expected_revision；Host 读取 Core 冻结单元，构造知识点 ID、陈述、证据与内容 SHA-256。客户端不能上传来源内容/hash。
- 每个题目内容版本有独立关联与修订号；修改/解绑并发冲突返回409。响应丢失后的同请求重试可复用持久快照，即使 Core 课程已归档/删除；仍经过 Quiz 最终修订号检查。
- 列表/详情返回当前 source/source_revision。交卷事务把关联快照写入题库作答历史，之后修改来源不会改变旧成绩，重放不重新拍快照，不回写 Core 掌握度。
- 关联表示用户显式选择的来源，不证明题目已充分评估该知识点；content_version 为导出课程单元快照版本，不是当前 Core content_hash。现阶段单来源，未做自动生成归因、来源统计或多来源。
- Quiz schema **v4**，v1-v3 升级前生成 `.pre-v4-*.bak`；旧历史保持 source/source_revision=null/null，不根据标签补配。Core schema v2 不变。
- Quiz **261 passed**（53 既有警告）；最终 Web 全量 **523 passed**，Host/服务 **16 passed**，来源/迁移定向 **7 passed**；build/diff check 通过。共享 Unicode/引用证据 fixture 同时由 TS 与 Python 校验。
- 独立审查已修复“来源删除后无法重放”及“过期修订号错误码”问题。旧 DSH product-plugin 单测因环境缺少 @deepseek-ai/cordis 未启动；当前独立 Web 默认测试全部通过。
- 未调用真实模型、未操作日常 home、未修改前端、未提交/清理已有工作树。

契约：contracts/quiz-source.md 与 quiz-source-v1.json；方案/计划：docs/superpowers/{specs,plans}/2026-09-18-question-source*。
下一步可基于显式来源与历史快照增加知识点级作答统计，需区分知识点版本、同题重做和不同题证据；不能直接用自由文本标签或当前关联重算历史。

## 最新更新：Core 到期复习后端已打通

本节优先于下方早期记录。复用 DeepTutor scheduler 的间隔表、连续正确推进、错误回退及类型优先级，适配为 Core 纯函数，来源与完整许可证随 Core 打包。

- 新增跨 active 课程只读队列与复习提交 RPC/HTTP，补救优先；队列支持分页和课程过滤，不返回正确答案或上次答案。
- 到期已掌握项可以再次答主测；错误进入证据补救，补救正确后安排下次复习。首次学习补救始终保持一天，重复失败也不会误推进间隔。
- expectedAttemptId 校验 unit 最新作答，拒绝旧页面推进；同幂等键重放原结果，跨轮也不重复更新。旧学习入口保留初学兼容，进入新复习流程后必须走带版本的新入口。
- 复习 roundId/spaced/schedule 存入现有 learning_attempts.result_json，与掌握状态同事务；Core schema 仍为 v2，无数据库迁移。Quiz schema v3 不变。
- Core **414 passed**；产品 HTTP/RPC **159 passed**；build、diff check 通过。已覆盖并发不同键/同键、回滚、重启、跨课程排序分页、归档、删除、跨轮重放及类型间隔上下界。
- 独立审查未发现额外功能问题，指出的测试缺口已补齐。
- 前端继续暂停；未启动日常 home、未调用真实模型、未提交或清理现有改动。

接口见 contracts/learning-reviews.md；设计与执行记录见 docs/superpowers/specs/2026-09-18-learning-review-design.md 和 docs/superpowers/plans/2026-09-18-learning-review.md。
目前仍复用固定主测/证据题，strength 100/70/20 是原有启发式，不能宣称新题能力评估。下一步是显式关联 Quiz 题目与 Core 知识点来源/版本，再推进知识点统计；前端接入仍待用户恢复。

## 最新更新：题库／错题本后端已实现

本节优先于下方早期交接。用户再次要求继续后，已完成下一阶段后端：

- `question_bank_repository.py` 实际改编 DeepTutor sqlite_store 的字面搜索、共用筛选、分页/计数、分类批量加载、统计和关联 SQL；已更新 Apache-2.0 来源记录。
- 合法保存题目自动进入题库，按用户＋原卷＋题号＋内容 hash 区分版本。未答不算错题；wrong 为最新错误，ever_wrong 保留曾错；改对不删历史。
- 交卷事务内同步题库状态，重放不重复计数；历史读取原 attempt_answers，按提交关联序号稳定排序。
- 新增 `/question-bank` 后端与 Host 白名单：分页列表、详情、历史、统计、收藏、分类 CRUD 和分类关联。收藏/分类不能修改对错。
- schema **v3**：v1/v2 启动前先生成 `.pre-v3-*.bak` 完整 SQLite 备份；回填题目与可信 v2 作答，不重发 XP。v1 客户端判分原文不进入可信错题统计，旧历史仍保留。
- Quiz **254 passed**（53 既有警告），Host **10 passed**，build、diff check 通过。独立审查完成；额外修复了同毫秒交卷的历史排序边界。
- 前端未改，新题库入口未接页面；未操作日常 home、未调用真实模型、未提交或清理工作区。

实现说明：`docs/quiz-integration.md`；执行记录：`docs/superpowers/plans/2026-09-18-question-bank.md`。
下一步建议继续 Core 到期复习可再次提交及跨课程队列，再补显式知识点来源 ID；
本轮不包含重新组卷、单题复习入口、模拟考试和掌握度策略，不能据此宣称完整复习闭环已完成。

## 后续开发更新：成绩与报告分离已实现

以下更新优先于本文后续的原始交接记录。用户已确认方案并要求继续。

- 新增 `app/repositories/attempt_repository.py`、`app/models/attempt.py`、`app/api/v1/routes/attempt.py`：独立轮次、部分答案快照/修订号、服务端交卷、同卷首次 XP。
- 报告按已提交轮次生成，有持久 claim/token、失败/取消/重启恢复；生成纳入 active-tasks。旧报告入口也先存成绩，失败重试不改答案。
- schema v2 新增 attempt/answers/reports；启动遇 v1 先生成同目录 SQLite `.pre-v2-*.bak`，再事务迁移。旧表与历史原文保留，含重复/未知题号；不重算历史、不重新发 XP。
- Host 精确白名单已接入；历史汇总使用提交轮次，旧列表一卷一行取最近成绩，添加 submitted_at/status/attempt_id。旧详情保持兼容轮次，新多轮走独立接口。
- 前端没有改动：新草稿恢复/多轮接口还未接页面，浏览器缓存不会自动上传。旧页面调用报告入口时已能先保存成绩。
- 验证：quiz 245 passed（53 既有警告）；Host 9 项通过；build、diff check 通过。独立审查的两个历史兼容问题已修复并复核。
- 所有数据库验证使用临时文件，未启动或升级日常 home、未调用真实模型、未提交/清理工作树。

API、升级恢复说明见 `docs/quiz-integration.md`；实施记录见
`docs/superpowers/plans/2026-09-18-quiz-attempt-report.md`。
原“剩余问题”第 1–3 项已有后端解决；第 4 项新接口已区分 null/0，旧列表为了兼容页面仍有 0 占位，不能直接据此绘图。
下一阶段仍可继续题库/错题本、Core 复习闭环与显式知识点关联，前端继续暂停。

## 用户意图与约束

- BetterLearn 保持 Electron 多端架构、共享 WebUI；macOS 已有原生玻璃桥接。
- 用户明确暂停前端工作。本阶段重点是学习业务后端，不做外观或折线图；如果业务接入必须改 UI 行为，说明范围，不借机重做界面。
- 生成使用用户在 BetterLearn 内配置的 API。Codex / Claude Code 通过 MCP 访问 BetterLearn，不复用宿主账号、订阅额度或内部模型。
- 用户提供 `/Users/guyue/Documents/code/DeepTutor/`，要求“能用源码就用源码”。优先复用其成熟模块，再适配 BetterLearn 数据与幂等边界。
- 最新请求是整理交接。本轮没有要求创建新任务，也没有自动创建新 session。
- 大量 Electron/MCP/插件及其他改动尚未提交，都是已有工作。先读 git status/diff，禁止清理或覆盖。不要 git add -A 后直接提交。

## 最近完成的业务修改

已将 DeepTutor `deeptutor/learning/grading.py` 的确定性 choice 分支改编为：

- `services/quiz/app/services/choice_grading.py`：列表答案、无序多选、拒绝重复选择与空答案。
- `services/quiz/app/services/scoring_service.py::grade_answer_records`：完整题号校验、重复/未知/缺题拒绝、合法选项及单选数量校验，重新计算正确性。
- `services/quiz/app/services/report_service.py`：有用户身份的报告按 SQLite 保存的题目/标题判分，忽略客户端题目篡改和 is_correct；模型报告 accuracy 被服务端正确率覆盖。已有报告重试仍直接返回，不重复加 XP。
- `services/quiz/tests/test_server_grading.py`：8 个新测试，真实隔离 SQLite + fake LLM，包含伪造结果、非法提交、多选顺序、归属与重试。
- `services/quiz/third_party/DeepTutor/`：Apache-2.0 完整许可证及 PROVENANCE；`scripts/build-web.mjs` 会复制到独立/桌面资源。
- `services/quiz/PROVENANCE.md` 已区分原 MIT 来源与这次 Apache-2.0 改编。

边界：旧匿名报告接口仍从请求题目计算，但不持久化成绩/XP；已存在历史报告未重算。浏览器即时反馈仍本地计算。成绩仍依赖报告成功，未拆分交卷流程。

## 验证事实

最近业务修改之后：

- `cd services/quiz && .venv/bin/python -m pytest tests -q`：234 passed，53 个既有依赖/测试密钥警告。
- `corepack pnpm build`：成功，dist/standalone 已更新，确认许可证与源码副本一致。
- `git diff --check`：通过。
- 修复前新增回归确实复现了伪造正确率与非法提交被接受。负时长已由 Pydantic 校验，未作为新测试保留。

更早阶段的结果（不能当作这次全部重新验证）：Web 51 文件 / 513 测试；Core learning 12 项；桌面与插件验证曾通过，已有记录见 docs/desktop-verification.md、docs/plugins.md。
本次没有重打 DMG，也没有启动或迁移用户日常数据。

## 已核实的剩余问题

1. `report_service.py` 先调用 LLM，再通过 `quiz_repository.save_report_atomic` 一次保存答案、成绩、报告、XP。模型失败就无服务端成绩。需要独立作答/交卷持久化，报告独立重试。
2. answer_records / reports 按 quiz_id 唯一；不能简单删唯一约束。需要区分题卷 ID、作答轮次 ID、提交幂等与 XP 发放。
3. 当前答题中间状态有浏览器缓存，但并非服务端逐题存储；不能说退出一定立即丢失，也不能说已可靠落库。
4. `quiz_repository.get_user_quiz_list` 用 COALESCE 把未计分显示成 0，时间是题卷创建时间。曲线应区分未完成/零分，用交卷时间，并明确按次平均还是按题加权。
5. Quiz `knowledge_point` 是自由文本标签，不是 Core knowledgePointId。知识点级评估必须显式来源 ID/版本，不能字符串匹配。
6. `python/nobei_core/learning.py::submit_attempt`：main 仅 new 可交，retest 仅 remediation_required/learning 可交；答错有补救/复测，未消失。掌握后即使 due_at 到期也不能再提交，是复习闭环缺口。只把 NULL 改成明天无效。
7. Core 当前固定主测+证据复测两题，strength 100/70/20；今日复习仅当前课程到期数，无跨课程可执行队列。
8. BetterLearn 尚无独立可复用题池、完整错题本、模拟考试、学习目标体系。题量限制 3–10 在 Python / MCP / UI；大卷不能简单放开单次 LLM 上限，还需分批/持久进度/失败处理。考试接口交卷前不能直接返回答案。

## DeepTutor：最新核实，上一版复用文档未完全覆盖

来源 `/Users/guyue/Documents/code/DeepTutor`，检查时 HEAD 为
`31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f`；当时 learning 目录无工作树修改。
只读检查了源代码和部分测试文件，未运行 DeepTutor 全套测试。

### 可重点复用的真实模块

- `deeptutor/learning/service.py`：grade_and_record / _apply_grade，判分 → 追加历史 → 掌握度 → 复习队列 → 保存，不依赖 AI 复盘；record_quiz_attempt 有错误记录 active/retrying/graduated。
- `deeptutor/learning/mastery.py`：最近五次加权，单次正确上限 0.5，两次 0.8。可移植纯函数，但不能把同题重复练习当成独立证据；属于启发式，不是已校准能力测量。
- `deeptutor/learning/scheduler.py`：知识类型间隔表、答错回退、错误知识点优先、到期队列。需替换时间/类型/存储边界，补 BetterLearn 复习轮次和跨课程聚合。
- `deeptutor/learning/models.py`：知识点 ID 关联作答、错误、复习状态。
- `deeptutor/learning/policy.py`：目标状态、到期复习优先、不同知识类型掌握标准。
- `deeptutor/api/routers/mastery_path.py`：掌握路径 API。
- `web/components/space/learning/{PathMap,ObjectiveDetail,ActivityTimeline}.tsx` 与 `web/app/(utility)/space/learning/page.tsx`：真实掌握地图、目标详情、作答历史、活动时间线。前端暂停，先作为行为参考。

### 最新补查发现：题库与错题本也已经有

之前只看 learning，漏掉这些；不能再说 DeepTutor 仅有基础模块：

- `deeptutor/api/routers/question_notebook.py`：题目、参考答案、讲解、难度、用户答案，分类/收藏/筛选，stats 包含 total/wrong/bookmarked/uncategorized；存储通过 get_sqlite_session_store。
- `web/components/space/question-bank/`：QuestionBankSection、useQuestionBank、分类管理等；scope 包含 wrong，按 is_correct=false 查询。
- `deeptutor/tools/question_bank.py`：题库工具入口。
- `deeptutor/learning/tests/test_mastery_tools.py::test_grade_syncs_mastery_attempt_to_question_bank`：掌握学习错误答案同步题库的测试。
- `tests/api/test_question_bank_api.py`、`tests/tools/test_question_bank_tool.py`：继续核对的测试入口。
- 需要继续追实际 SQLite session store 的题库表、upsert 键和历史语义，再决定移植；不能把“题库更新一行”误当完整多次作答历史。
- 其 UpsertEntryRequest 接收客户端 is_correct / correct_answer，不能原样复用判分信任边界，要接 BetterLearn 服务端 canonical 题目。

### 不可混淆

- `deeptutor/tools/question/exam_mimic.py` 是参考试卷仿题生成，委托 QuestionPipeline/Coordinator。没有核实到完整计时考试/统一交卷流程。
- 找到掌握图、时间线，未找到现成逐次考试分数折线。
- 有知识点目标与评估，不等于具备期限+目标分数的目标管理实体。
- `book/progress.py` 从每题最新作答派生分数/薄弱章节，但 book API 仍信任客户端结果；适合摘要，不替代每次成绩历史。
- `quiz_judge.py` 是模型反馈接口，不是可信成绩入口。
- 不引入其简答相似度/开放题关键词判分、整个 agent 运行时或模型配置。

## 建议下一个 session 的执行范围

用户希望复用源码，已明确优先策略；无需重复从零讨论是否采用 DeepTutor。

1. 先追完 DeepTutor 题库存储和 grade_and_record 数据流，更新 docs/deeptutor-reuse.md（补题库、错题和真实 UI/API 对照）。
2. 优先实现成绩与报告分离：独立 attempt/answers，交卷服务端判分并原子保存，重复提交不重复 XP，报告关联该轮作答、可失败后单独重试。避免把新的大功能一口气全部接入。
3. 之后题库/错题本与复习队列尽量移植模块。补显式 Core ID 关联，再做知识点统计和目标评估。图表/外观暂停。
4. 设计数据库升级前先只读确认 schema 和现有数据，准备可恢复备份方案；本阶段测试使用临时数据库，不能自动迁移用户生产 home。
5. 补有价值的测试：报告失败成绩仍存在、重复交卷并发不重复 XP、跨用户隔离、旧记录兼容、同一题卷多次作答、部分作答恢复、复习到期重交及幂等。

## 文档与运行环境

- docs/quiz-integration.md 已重写为当前 SQLite/home/备份语义；AGENTS.md 的 MySQL/config.json/data/旧备份描述同步修正。
- 备份实际 entries：core、quiz-data、settings.json、identity.json、library.json、library-delete.json、mcp-requests。包含上传/Chroma/本地图片，不包含 Python 环境或外部 COS。恢复只允许新目录。init 不自动备份。
- docs/deeptutor-reuse.md 是上一轮初步复用说明，新增题库发现以本交接为补充。
- 用 `corepack pnpm`（11），避免直接 pnpm 10 安装造成 store 不匹配。
- Core 测试：`PYTHONPATH=python .venv-phase1b/bin/python -m pytest ...`。
- Quiz 测试：在 services/quiz 下执行 `.venv/bin/python -m pytest ...`。
- Python 环境为 3.12；系统 python3 可能是 Xcode 3.9，不要拿它代替项目测试环境。
- fake provider 回归不应调用收费 API。不要为了验证连接自动使用真实用户密钥。
