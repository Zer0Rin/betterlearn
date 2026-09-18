# Core Review Implementation Plan

**Goal:** 打通已掌握知识点的间隔复习与跨课程可执行队列。
**Architecture:** 原 Core 作答事务追加 review 元数据；纯调度函数适配 DeepTutor；RPC、Host路由和类型同步。
**Constraints:** 前端暂停；不操作日常 home；不调用模型；无需数据库升级。

- [x] 新增 python/tests/test_learning_reviews.py，先复现缺少复习入口/队列。
- [x] 适配 learning_schedule.py；在 learning_reviews.py 实现队列及复习状态校验与转换。
- [x] learning.submit_attempt 共用写事务，添加可选review上下文、回放digest及旧入口防误用。
- [x] service/constants、product types/core-rpc-client/operations/routes 与 contracts 同步。
- [x] 测试早交/到期/补救/幂等/过期/并发/回滚/持久化/归档/跨课程队列。
- [x] 来源许可证加入 Core 包并验证构建副本；独立审查与完整相关测试。
- [x] 更新交接和边界说明，保留工作树。

验证：Core 414 passed；HTTP/RPC 159 passed；corepack pnpm build 与 git diff --check 通过。独立审查完成，间隔回归已修复，许可证构建副本已确认。
