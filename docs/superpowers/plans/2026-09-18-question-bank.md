# Question Bank Implementation Plan

> **For agentic workers:** Inline execution with test-first checkpoints; independently review the completed backend.

**Goal:** 复用 DeepTutor 源码实现可信题库、错题状态与分类收藏后端。
**Architecture:** 题目版本条目 + 原始 attempt 历史关联，提交事务同步投影；Python API 与 Host 白名单。
**Tech Stack:** 现有 Python 3.12/SQLite/FastAPI、pytest、TypeScript/Vitest。

## Global Constraints

前端暂停；所有现有改动保留；不迁移日常 home；不调用真实模型。题库状态不代表 Core 掌握度。

- [x] tests/test_question_bank.py：API 集成测试先失败，再覆盖当前错题/曾错、历史、收藏分类、所有权、分页和字面搜索。
- [x] app/core/question_bank_schema.py：v3 表、题目规范化/版本键、可信作答回填；app/core/db.py：通用升级前备份。
- [x] app/repositories/question_bank_repository.py：移植共用筛选、批量分类读取与分页查询；新增服务端交卷投影。
- [x] app/models/question_bank.py、app/api/v1/routes/question_bank.py：严格输入与拥有者边界；接入 main.py。
- [x] save_quiz_session 与 submit_attempt 在原事务内写条目/关联；不修改 AI 生成流程。
- [x] test/quiz-routes.test.ts 先失败，扩展 src/product/quiz-routes.ts 精确路径和查询参数白名单。
- [x] 测试升级/回填/回滚、提交投影失败整体回滚；独立审查修复。
- [x] 更新出处、API、交接；quiz 全套、Host 测试、build、diff check。


## 验证记录（2026-09-18）

- 新增 API 回归先以 404 失败；实现后通过。Host 路由也先复现 404，再接入白名单。
- 同毫秒、逆创建顺序交卷的历史排序回归先失败；改用关联记录的显式递增序号后通过。
- 独立审查已完成；明确保留 DeepTutor 的显式分类优先规则，并补组合筛选回归。
- Quiz：254 passed，53 个既有测试密钥/依赖警告。
- Host quiz-routes / quiz-service：10 passed。
- `corepack pnpm build`、`git diff --check` 通过。
- 临时库验证 v1/v2 升级、可信回填、不重复计数、备份和失败回滚；提交投影失败也整体回滚。
- 未修改前端，未操作日常 home，未调用真实模型，未创建提交或清理工作树。
