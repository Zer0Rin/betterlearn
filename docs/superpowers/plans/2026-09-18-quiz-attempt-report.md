# Quiz Attempt / Report Implementation Plan

> **For agentic workers:** Execute in this session using executing-plans, with test-first checkpoints.

**Goal:** 交卷立即可靠保存成绩，AI 报告独立生成和重试。

**Architecture:** 新增作答、答案、报告表；SQLite 事务裁决修订、交卷与 XP。报告在事务外调用模型，使用持久 claim 避免并发生成。旧报告入口映射到唯一兼容轮次。

**Tech Stack:** 现有 Python 3.12、SQLite、FastAPI/Pydantic、pytest、TypeScript/Vitest。

## Global Constraints

- 前端暂停；保留现有改动，不迁移日常 home，不调用真实模型。
- 同卷多轮成绩保留，首次交卷发 XP；旧成绩不重复发 XP。
- 用户已确认设计，本 session 直接实施，不重复确认执行方式。

## Task 1: 失败回归与数据库升级

Files: `services/quiz/tests/test_quiz_attempts.py`、`tests/test_attempt_migration.py`、`app/core/db.py`、`app/core/attempt_schema.py`。

- [x] 写 API 回归：创建轮次→交卷→模型失败→读取成绩仍为 80、XP 为 18→重试成功。
- [x] 写 v1 临时库迁移回归：旧成绩/报告/XP 保留，备份仍为 v1，二次启动不重复。
- [x] 运行 `.venv/bin/python -m pytest tests/test_quiz_attempts.py tests/test_attempt_migration.py -q`，记录失败原因。
- [x] 添加 v2 表与数据迁移、升级前 SQLite 完整备份、重启恢复 running 报告。

## Task 2: 作答事务与路由

Files: `app/models/attempt.py`、`app/repositories/attempt_repository.py`、`app/api/v1/routes/attempt.py`、`app/core/exceptions.py`、`app/main.py`。

- [x] 添加创建/草稿/交卷请求模型；客户端不提供可信判分。
- [x] `create_attempt(quiz_id, user_id, request_id)`：快照、归属与请求幂等。
- [x] `get_attempt`、`list_attempts`：所有查询按所有者限制。
- [x] `save_answers`、`submit_attempt`：同事务校验 revision、完整题号与合法选项，提交 hash 与一次 XP。
- [x] 回归多轮、跨用户、修订冲突、重启恢复、并发提交、非法输入。

## Task 3: 报告与兼容历史

Files: `app/services/report_service.py`、`app/repositories/quiz_repository.py`、`app/repositories/task_repository.py`、`app/models/user.py`。

- [x] `claim_report` / `finish_report`：持久状态与 token 裁决；生成时无数据库事务。
- [x] `handle_attempt_report`：只用已保存快照/成绩，失败或取消不回滚成绩。
- [x] 旧 `handle_report_generate` 先通过 `submit_legacy` 提交，再生成；旧报告直接返回。
- [x] 移除原先耦合的写入口，用户统计切到轮次，历史保留兼容返回。
- [x] 测试报告并发、取消、active-tasks、旧入口失败重试与旧报告兼容。

## Task 4: Host 与验收

Files: `src/product/quiz-routes.ts`、`test/quiz-routes.test.ts`、`docs/quiz-integration.md`、`docs/deeptutor-reuse.md`。

- [x] 先添加 Host 路由测试并确认失败，再增加精确白名单。
- [x] 运行 quiz 全套、Host 测试和 `corepack pnpm build`。
- [x] 自查 diff、修复回归、记录迁移备份恢复方式和前端尚未接入的边界。
- [x] 更新设计与计划状态；保留未提交工作树交付。


## Verification — 2026-09-18

- 初次新增 7 项测试全部失败：5 项因新接口 404、1 项复现报告失败无答案、1 项缺少 v2 升级。
- Host 新路由测试先以 404 失败，白名单接入后通过。
- 独立审查发现旧重复题号阻断迁移、未知题号读取时被过滤；新增回归复现 UNIQUE 错误，改为原文历史后通过，审查复核确认修复。
- Quiz 全套：245 passed，53 个既有测试密钥/依赖警告。
- Host quiz-routes / quiz-service：2 文件、9 项通过。
- `corepack pnpm build`：通过。
- `git diff --check`：通过。
- 多线程重复交卷、提交事务失败回滚、模型失败/取消/重启、WAL 完整备份恢复、备份失败与迁移回滚均在临时数据库验证。
- 未修改前端，未启动日常 home，未调用真实模型，未创建提交或清理既有改动。
