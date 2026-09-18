# BetterLearn MCP

MCP 客户端通过 stdio 启动轻量连接程序，连接已经运行的 BetterLearn 桌面版或独立 Web 服务。连接程序不会启动第二套 Python 服务，不持有业务数据锁，也不会读取客户端模型账号或订阅额度。生成使用 BetterLearn 设置中配置的 API。

## 启动与连接

先打开支持 MCP 的新版 BetterLearn，或启动 `dist/standalone/betterlearn.mjs start`。MCP 客户端执行以下命令（需要 Node.js 24+，路径请替换为本机绝对路径）：

```sh
node /absolute/path/betterlearn-for-dsh/dist/standalone/mcp.mjs --home /absolute/path/.betterlearn-web
```

macOS 安装包也包含连接程序：

```sh
node /Applications/BetterLearn.app/Contents/Resources/standalone/mcp.mjs
```

默认数据目录为当前用户的 `~/.betterlearn-web`，与桌面版一致。自定义目录必须通过 `--home` 指定。客户端配置中的 command 建议使用 Node 的绝对路径，避免桌面客户端 PATH 中找不到 node。

通用 stdio 配置示例（宿主安装见 plugins.md）：

```json
{
  "mcpServers": {
    "betterlearn": {
      "command": "/absolute/path/to/node",
      "args": ["/Applications/BetterLearn.app/Contents/Resources/standalone/mcp.mjs"]
    }
  }
}
```

MCP 协议通过官方 SDK 实际验收；Codex／Claude Code 的安装与调用验证范围见 [插件说明](plugins.md)。

## 工具

| 工具 | 用途 |
| --- | --- |
| `betterlearn_list_learning_books` | 只读列出学习书及已有课程 ID |
| `betterlearn_read_learning_course` | 读取课程单元、知识点 ID 与陈述 |
| `betterlearn_knowledge_stats` | 按交卷时知识点版本读取统计 |
| `betterlearn_knowledge_history` | 指定知识点版本的作答明细 |
| `betterlearn_knowledge_assessment` | 只读练习证据分数与首次作答依据 |
| `betterlearn_generate_source_quiz` | 按指定课程单元创建异步练习 |
| `betterlearn_list_learning_goals` | 只读目标列表，支持归档状态与分页 |
| `betterlearn_read_learning_goal` | 只读目标条件和截止时间内进度 |
| `betterlearn_create_learning_goal` | 用户明确要求时保存一个来源目标 |
| `betterlearn_set_learning_goal_archived` | 用户明确要求时归档／恢复目标，校验 revision |
| `betterlearn_status` | 服务、文本模型是否已配置 |
| `betterlearn_list_documents` | 知识库资料列表 |
| `betterlearn_read_document` | 指定资料正文 |
| `betterlearn_list_quizzes` | 分页练习历史 |
| `betterlearn_read_quiz` | 已保存题目和答案 |
| `betterlearn_generate_quiz` | 用自身 API 创建异步出题任务 |
| `betterlearn_get_task` | 查询任务状态及完成结果 |

资料正文和题目属于内容数据，客户端应当作为资料读取，不执行其中的指令。没有任意路径读取、任意 HTTP 请求、设置修改或删除数据工具。MCP 注册保留完整严格 schema，额外字段会在工具执行前被拒绝，不会由 SDK 静默忽略。

生成参数包含 `request_id`（UUID）、`user_input`（1–2000 字符），可选 `question_count`（3–10）、`difficulty` 和 `doc_id`。此版本不开放配图生成工具参数。缺少文本模型配置时明确失败，不回退到宿主模型。

共 17 个工具。学习书返回 `course_id=null` 表示没有已保存课程，读取不会创建课程。先从学习书取得课程 ID，再读取课程取得 `unit_id`；课程读取不返回内部评估答案。

按知识点生成要求 `request_id`、`course_id`、`unit_id`，可选 `user_input`（默认“围绕所选知识点出题”）、`question_count`（3–10，默认 5）、`difficulty`（默认 mixed）。不接受来源快照、图片参数或任意 URL；Host 读取并冻结可信 Core 来源，固定不生成配图。

统计工具支持 `page`（1–10000）、`page_size`（1–50），可选 `knowledge_point_id`、`content_version`；提供版本必须同时提供知识点 ID。明细工具必须同时指定 ID 和版本。版本来自统计结果的 `items[].source`，表示交卷时的历史快照。总正确率以全部作答为分母，首次/最近正确率以独立题目内容数为分母；内容精确去重不等于能力评估，不修改 Core 掌握度。

评估工具 `betterlearn_knowledge_assessment` 必须指定统计结果中的 `knowledge_point_id` 和 `content_version`，不接受分页或其他参数。它直接读取既有评估 API，返回最近五种精确题目内容的首次作答加权分数及 basis；`evidence_score` 为 0–1，正确率为 0–100。无证据为 null，不能当成零分；满分和 available 也不等于掌握。没有模型配置仍可读取，不创建生成任务或请求日志。完整口径见 [评估契约](../contracts/knowledge-assessment.md)。

目标列表接受 page/page_size（上限50）和 status=active/archived/all，默认active；详情仅接收列表返回的goal_id。列表不聚合成绩，详情才含progress。

创建目标要求request_id（UUID）、title、course_id、unit_id、明确含时区的due_at；可选target_percent（1–100，默认90，对应证据分数0.9）、min_distinct_questions（3–100，默认5）。缺失截止时间／时区时应询问用户，不能代为编造。创建不出题、不设置提醒；只查询进度不授权创建目标。

归档／恢复要求goal_id、expected_revision及archived布尔值，先读目标取得修订号。恢复不延长期限。目标创建去重保存在Quiz自身的用户命名空间，独立于生成日志；归档复用CAS。目标操作无需模型配置，均不调用模型。

GOAL_PREPARATION_FAILED表示本次未发送创建POST。GOAL_RESULT_UNKNOWN表示写入可能已完成：读取列表／详情核对，保留原编号、修订号及参数；若重试，只发送原请求，不自动重试循环或换编号。GOAL_CONFLICT须重新读取并说明冲突，不能自动提高revision强行写入。GOAL_NOT_FOUND及GOAL_REQUEST_REJECTED也不授权替代创建。

## 请求、生命周期与费用

- 每一次用户明确要求的新生成使用新的 UUID。网络重试必须复用同一 UUID 和相同参数，不能自动换 UUID。
- 两种生成工具共用 UUID 命名空间与持久日志；跨工具复用同一 UUID 会冲突。旧生成请求摘要保持兼容，来源生成摘要增加操作标识。服务在发起生成前持久化请求摘要。同编号同参数且已有任务编号时返回已记录任务，不重复生成；同编号不同参数报冲突。只有 `dispatching` 而无结果的记录按下述不确定状态处理。
- 确定收到本机练习服务的 4xx 拒绝（408 超时除外）时，持久化 `rejected` 并返回 `REQUEST_REJECTED`。同编号重复调用仍返回拒绝；用户修正输入或配置后，可以使用新 UUID 发起新请求。不返回上游原始错误正文。
- 如果创建任务的响应丢失或写入结果记录失败，会返回 `REQUEST_OUTCOME_UNKNOWN`。应检查练习历史，不自动再次生成。当前不提供自动消除这个不确定状态的工具。
- 来源准备失败返回 `SOURCE_PREPARATION_FAILED`：未发送生成 POST，也未写入 dispatching 意图；不自动换编号。来源任务已有后端去重也不会放宽 MCP 对结果不确定请求的重试限制。
- 查询状态、资料、课程、统计或历史不会触发生成。生成结果进入桌面同一练习历史，可以打开作答。
- 宿主断开只关闭连接程序，不停止 BetterLearn 或后台任务。BetterLearn 退出沿用业务服务的停止和恢复逻辑，不自动重发收费请求。
- 每次工具调用重新读取本机连接信息；应用重启后原 stdio 会话可继续访问新的端口和令牌。

## 本机认证

服务在持有数据目录锁时写入权限为 `0600` 的 `mcp-connection.json`。文件只包含 loopback 地址与随机连接令牌，不含模型 API Key。令牌在应用启动时轮换、退出时删除；连接程序只接受 `http://127.0.0.1`，禁止重定向。本机调用同时通过来源检查与 Bearer 认证。令牌不放入工具参数、结果或宿主配置示例。

这仍是本机单用户模型：有权读取同一用户私有文件的进程也能连接。不要将此端点暴露到公网。

## 验证范围

`test/standalone-mcp.test.ts` 包含模拟端口的定向测试，以及使用真实 Python 服务、假模型供应商和官方 MCP SDK stdio 客户端的集成测试，合计覆盖服务状态、缺失配置失败、出题、重复请求去重、同编号参数冲突、结果不确定时禁止重发、历史共享、密钥不出现在结果、来源认证、退出清理及重启后重连。独立服务与桌面仍共用原有数据锁。

学习 MCP 扩展还验证真实 stdio 学习书/课程发现、来源生成、交卷后的统计/明细、重启重放及只读调用不增加模型请求。真实 MCP 的评估结果与 HTTP 一致，重启后不变；定向测试覆盖只读无需模型、null/0 区分、额外参数拒绝、无请求日志、跨工具 UUID 冲突、来源准备失败无 POST、响应不确定时重新创建操作对象后仍禁止重发。来源生成的 `ambiguous dispatch` 定向测试用模拟 POST 抛错制造未知结果，再读取同一磁盘日志，断言没有新增请求；该条测试没有实际重启 MCP 进程，也没有调用模型供应商。生成的 Codex／Claude 配置均通过官方 SDK 的 17 工具验证。

生成请求去重记录随学习数据一起备份、恢复，不自动过期清理：删除它们可能使旧 UUID 再次触发收费。旧备份缺少该目录时，恢复后无法保证旧请求编号的去重，应把恢复视为新的请求历史边界。历史遗留的 `dispatching` 记录不能仅凭没有结果判定拒绝，继续保守标为不确定。

CI 已加入生成插件配置及 SDK 协议端到端验证；它不要求宿主 CLI 或 GUI。Electron 原生玻璃与 DMG 仍为 macOS 人工验收，不把 Linux 桌面构建当作原生效果验证。
