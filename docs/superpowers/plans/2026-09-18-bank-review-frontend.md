# 题库与复习前端 Implementation Plan

> **For agentic workers:** 当前任务内用 executing-plans 逐项实施。

**Goal:** 接通题库管理、逐题历史与 Core 跨课程复习。
**Architecture:** QuizApi 增加题库只读/组织接口；Core review 使用独立 API 和持久请求控制器；页面仅展示后端事实。复用既有 PracticePanel 查看指定轮次。
**Tech Stack:** 现有 React/TypeScript/Vitest，不增加依赖。

## Global Constraints

保留所有未提交改动。无 schema/后端规则修改。无真实模型调用。结果未知不自动重发写请求。

- [x] API：bank-types.ts、api/contracts 增加查询/收藏/分类方法；review-api.ts 读取 Core 队列与幂等提交。先写 API 契约失败测试，再接入方法。
- [x] 题库：QuestionBankPage、QuestionBankDetail、CategoryManager，分页/筛选/搜索/展开答案与历史。组件测试覆盖 null 对错、筛选切页、收藏分类、删除确认和迟到响应。
- [x] 复习：review-session.ts 保存冻结请求与结果，ReviewPage 读取跨课程队列、提交、处理补救和冲突。测试先验证同键重放、并发锁、存储失败、卸载与重开。
- [x] 接入：StandaloneApp/QuizWorkspace 新增入口，Core 复习独立于 quiz connect；AttemptHistory 支持从单题历史定位指定轮次。接入测试验证入口和原页面回归。
- [x] 验证：真实 Host 题库/复习集成、Web 全量/构建、浏览器操作与 diff 检查；更新交接与验证记录，保持未提交。


## 完成验证（2026-09-18）

- `corepack pnpm test`：TypeScript / standalone 构建通过，60 文件、582 项通过。
- 真实临时 Host：题库收藏、分类创建/改名/关联/删除、字面搜索、逐题历史；后续答对退出当前错题、保留曾经答错；删除分类保留题目和历史。Core 错答进入补救，提交正确证据后退出队列并返回下次时间，无新增模型调用。
- Playwright 操作实际页面：新增“重点知识”分类、收藏并关联题目，重新进入列表确认数量；补救答题后显示已保存和下次复习时间；控制台 0 errors / 0 warnings。截图 `output/playwright/question-bank.png`、`output/playwright/review-result.png`。临时浏览器与服务已关闭。
- 复查补齐损坏本地恢复记录的显式放弃流程；失败测试复现后修复，同时验证不清除另一窗口新增的有效请求。结果未知仍只能原键重试。
- `git diff --check` 通过；保留全部已有改动，未提交。本轮未重跑 Python 全套、Electron 打包或插件验证；不改后端业务/schema，不使用真实收费 API 或日常 home。
