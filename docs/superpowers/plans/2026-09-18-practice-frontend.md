# 练习前端 Implementation Plan

> **For agentic workers:** 使用 executing-plans 在当前任务内逐项实施，保持现有未提交改动。

**Goal:** 完成练习草稿、交卷、服务端成绩、独立报告及多轮历史前端。

**Architecture:** API 层定义 attempt 契约；独立持久控制器保存待处理请求和远端快照，并处理冲突和不确定结果；共享页面订阅控制器，历史选择特定轮次。

**Tech Stack:** 现有 React 18 / TypeScript / Vitest；不新增依赖。

## Global Constraints

不提交或清理已有改动。测试使用临时数据和 fake provider，不调用真实收费模型或启动日常 home。正式成绩及 XP 只读取服务端。生成报告必须用户点击。

## Task 1 — API

Files: src/client/quiz/{types.ts,services/contracts.ts,services/api.ts,services/api.test.ts}

- [x] 新增失败测试：创建、读取、列表、保存、提交、报告请求路径和载荷；HTTP 409 可辨识。
- [x] 执行 `corepack pnpm exec vitest run --config vitest.web.config.ts src/client/quiz/services/api.test.ts` 确认失败。
- [x] 添加 AttemptSummary/PracticeAttempt/AttemptAnswers 类型；createAttempt/getAttempt/listAttempts/saveAttempt/submitAttempt/generateAttemptReport 六个方法，写请求仅传选择和时长。
- [x] 复跑测试。

## Task 2 — 持久化状态机

Files: src/client/quiz/services/practice.ts and practice.test.ts

- [x] 测试先行：草稿重载、写锁、稳定创建编号、失败查询、CAS 冲突不覆盖、交卷响应丢失恢复、显式报告与查询。
- [x] 控制器按 storage+quiz/attempt 定位，独立键持久化待处理创建/保存/提交载荷；读请求不创建作答。
- [x] 写锁期间禁用交互。刷新保留原请求；保存失败先 GET，比对规范化答案和 revision。不同远端版本需明确舍弃本地后重新读取。
- [x] 交卷只允许全部确认，成功显示服务端事实；报告仅显式 POST，轮询仅 GET。
- [x] 执行 `corepack pnpm exec vitest run --config vitest.web.config.ts src/client/quiz/services/practice.test.ts`。

## Task 3 — 页面与历史

Files: src/client/quiz/{QuizWorkspace.tsx,components/PracticePanel.tsx,components/QuizPlayer.tsx,components/QuizReport.tsx,pages/AttemptHistory.tsx,pages/HistoryPage.tsx} 及对应测试

- [x] 新增页面测试：服务端 0 XP、未交卷无分数、报告失败仍有成绩、无报告历史可查看、创建轮次和旧缓存恢复入口。
- [x] PracticePanel 使用控制器；订阅卸载解除，异步结果只写原控制器；报告 polling 有界并可继续查询。
- [x] QuizPlayer 增加 busy 禁用；成绩页用明确 score 参数，旧报告只读兼容不虚构 XP。
- [x] 历史按卷显示，各轮次可选择；本地旧缓存不自动写入，显式恢复时检查已有轮次。历史成绩采用 submitted_at。
- [x] 执行 `corepack pnpm exec vitest run --config vitest.web.config.ts src/client/quiz`。

## Task 4 — 验证与交接

- [x] 全量 `corepack pnpm test`（含构建），按实际失败修复。
- [x] 使用现有 Host 集成夹具和 fake provider 验证 API adapter 真实创建→保存→交卷→报告链路。
- [x] 检查 git diff --check 与本轮变更，更新交接记录与设计状态，保留未提交。

## 完成记录

- Web 56 文件 / 563 项通过，包含真实 Host→Quiz→SQLite 的新前端 API/controller 集成测试；TypeScript/standalone 构建通过。
- 真实临时 home 验证草稿保存后重启恢复、无模型交卷、独立报告与同卷第二轮 XP=0。Playwright 在 fake provider 下走完答题、67% 成绩、14 XP 和显式报告；控制台无错误。
- 新用例覆盖：创建响应丢失、保存响应丢失、CAS 冲突、原交卷载荷重试、存储失败、报告轮询停止、切换轮次迟到结果、旧缓存显式恢复、未交卷占位值。
- 审查中修复：报告 POST 缺 JSON 请求体；存储失败后重复 load 可能发送未持久化创建编号；未发送答案未保留；重新读取失败后显式舍弃无法恢复编辑；旧列表的 0 道题占位展示。
- 本轮无 Python/schema/插件改动；未重跑 Core/Quiz 全套、未打包 Electron。未调用真实模型，未启动日常 home，未提交。
- 浏览器截图保存在 output/playwright/practice-{draft,result}.png（忽略目录，不提交）。
