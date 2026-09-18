# BetterLearn 架构

本文描述当前独立 Web 与 Electron 桌面应用。BetterLearn 是本机运行、单用户使用的学习工作台，运行不需要 DSH 或 MySQL。安装入口见 [README](../README.md#快速开始)、[独立 Web](standalone-web.md) 与 [桌面版](desktop.md)；旧宿主资料见 [DSH 历史文档](dsh-plugin-legacy.md) 和 [历史安装说明](install.md)。

## 1. 运行形态与服务边界

```text
浏览器 / Electron BrowserWindow
  └─ 共享 React 工作台
       └─ 本机 HTTP Host（127.0.0.1）
            ├─ /nobei/v1/* → 产品操作与生成协调 → Python Core（stdio JSON-RPC）
            │                                      └─ Core SQLite
            ├─ /nobei/quiz/v1/* → 受管理的 FastAPI Quiz 服务
            │                       └─ Quiz SQLite / 上传文件 / Chroma / 图片
            └─ /api/* → 设置、书库、MCP 调用等本机入口

MCP 客户端 → stdio 连接程序 → 同一 HTTP Host → 同一业务服务与数据
```

独立 Web CLI 负责初始化和启动；Electron 主进程直接调用同一个 `startStandalone`，管理首次环境准备和窗口生命周期。二者共享页面资源、产品路由与本地数据格式，默认 home 为 `~/.betterlearn-web`。同一 home 通过数据目录锁限制为一个运行实例。

MCP 连接程序只连接已经运行的 BetterLearn，不启动第二套业务后端。桌面原生玻璃属于平台特定外观能力，不能据此推断其他平台具有相同效果。

## 2. 组件职责

| 组件 | 职责与实现入口 |
| --- | --- |
| Client | `src/standalone/App.tsx` 与 `src/client/` 提供资料预览、候选审核、学习书、课程、知识库和练习界面。浏览器状态用于界面恢复，不作为业务事实源，不保存模型密钥或 Quiz JWT。 |
| HTTP Host | `src/standalone/server.ts` 装配路由、设置与书库，管理 Core 和 Quiz 生命周期，执行本机来源检查与 MCP 令牌认证。 |
| 产品层 | `src/product/` 定义共享操作、HTTP 路由、Core 通信与生成协调；`generation-coordinator.ts` 按任务计划协调模型调用和候选提交。 |
| Python Core | `python/nobei_core/` 保存提取状态机、任务级模型快照、候选、证据、审核、课程与掌握度；通过 stdio JSON-RPC 暴露业务方法。 |
| Quiz | `services/quiz/app/` 负责文档处理、检索、出题、交卷、题库与练习统计；Host 通过私有鉴权访问受管理的回环服务。 |
| MCP | `src/mcp/` 定义工具和 stdio 入口；`src/standalone/mcp-service.ts` 执行生成工具与请求日志逻辑，复用 Host 管理的服务。 |

练习服务及 `src/client/quiz` 派生自 yu-ai-learn；部分判分、题库与证据评分改编自 DeepTutor。具体来源、许可证和改造范围见 [PROVENANCE](../services/quiz/PROVENANCE.md)。

## 3. 资料提取、审核与学习书

1. 用户导入资料、粘贴正文，或从知识库选择文档。Host/Core 生成只读正文预览和提取计划；此时不创建提取任务、不调用模型。
2. 用户确认后创建 run，Core 保存任务级模型快照。`StandaloneGenerationAdapter` 使用本机设置中的连接调用模型；已有任务重试仍解析原连接快照。
3. `GenerationCoordinator` 按 L1/L2/L3 计划执行结构化规划和提取。候选必须经过契约校验及逐字证据定位，才能进入审核。
4. 用户接受、修改或拒绝候选。Core 通过事务、修订号与幂等规则保存结果；模型输出本身不能直接成为已审核知识点。
5. 用户将选中的知识点整理为学习书。书库目录与版本由 Host 保存，具体课程及学习进度由 Core 保存。

预览正文与正式导入必须一致。知识库等来源在提交时核对预览摘要，来源变化则要求重新预览。证据坐标针对保存的规范化正文，使用 Unicode 字符位置，不等于原 PDF 的版面坐标；扫描 PDF 不提供 OCR。

L1 直接提取；L2/L3 包含规划和分批提取，预览显示最多调用数。候选批次、证据定位与限制详见 [P3 提取契约](p3-extraction-contract.md)。精确匹配引用只证明文字可定位，不保证知识点语义正确或覆盖完整，仍需人工审核。

结果页修改正式知识点不重新调用模型。页面刷新、状态读取和重新连接也不触发提取；用户显式重新提取会按原任务模型重新执行计划，可能再次产生费用。

### 状态通知与恢复

`GET /nobei/v1/runs/:runId/stream` 提供 SSE 通知。`run.changed` 提示客户端读取既有 run/events 接口，业务状态和事件游标仍以 Core 为准；SSE 断开时保留轮询兜底。

生成阶段与批次进度保存在 Host 的活动生成句柄中，经 `run.progress` 和进度查询接口提供给界面。这是瞬时显示，Host 重启不恢复该内存进度；任务恢复依赖 Core 持久状态，不以界面进度推断模型是否执行。

### DSH 兼容输入

共享产品层保留 DSH 对话适配能力，但独立 Host 当前装配的是文件、文本和知识库来源，不依赖 DSH 会话或模型目录。旧宿主接入只读取用户显式选择的普通会话，过滤为用户文字和模型可见文字；系统提示、推理、工具调用/结果、插件注入、图片与未知块不进入材料。该兼容能力不代表当前独立界面已接入 DSH 会话发现。

## 4. 知识库、来源出题与统计

浏览器通过 `/nobei/quiz/v1` 访问 Host 允许的业务路由，再由 Host 转发给 Quiz。Quiz 私有服务 token 和用户 JWT 留在后端；浏览器不能借此进行任意路径或任意 HTTP 代理。

知识库文档可用于检索、出题，也可经 `/nobei/v1/knowledge-base/*` 进入 Core 的预览、提取和证据审核流程。Core SQLite 保存提取与课程，Quiz SQLite 保存文档元数据、题目和练习记录；上传文件、向量及图片另存于 `quiz-data`。练习成绩与证据评分不会自动覆盖 Core 课程掌握度。

来源出题由 Host 解析所选课程知识点，冻结陈述、证据和来源编号。Quiz 在生成前保存请求及任务映射，模型不能自行决定来源编号；生成结果校验和保存逻辑见 `services/quiz/app/services/source_generation.py`。契约见 [来源出题](../contracts/source-generation.md) 与 [知识点评估](../contracts/knowledge-assessment.md)。

## 5. MCP 生成请求的两层去重

MCP 与 Quiz 来源出题的去重承担不同职责，不能把两者的返回行为混为一谈。

| 层次 | 持久化位置 | 重放行为 |
| --- | --- | --- |
| MCP 生成工具 | `home/mcp-requests/<request_id>.json`，实现于 `src/standalone/mcp-service.ts` | 已记录任务编号则返回原任务；摘要不同则冲突；只有 `dispatching` 而无已记录结果时，继续返回 `REQUEST_OUTCOME_UNKNOWN`，不再次提交。 |
| Quiz 来源出题 | Quiz SQLite 的 `quiz_source_tasks` 与 `quiz_tasks`，实现于 `services/quiz/app/repositories/source_generation_repository.py` | 按 `(user_id, request_id)` 查询；参数摘要相同返回原任务且不重新生成，不同则返回 409。 |

MCP 在提交生成 POST 前写入 `dispatching`，收到有效任务编号后写入 `accepted`。响应丢失或结果日志写入失败时，无法据此断定后端没有执行；即使来源出题另有后端去重，MCP 也不自动消除不确定状态或换编号重发。

这是一种保守的费用控制：宁可保留需要人工核对的未知结果，也不把通信失败当作安全重试的证明。确定拒绝、来源准备失败和连接生命周期的完整规则见 [MCP 文档](mcp.md#请求生命周期与费用)。

## 6. 配置、数据与维护

模型设置由本机 `SettingsStore` 管理，保存在私有 `settings.json`；返回页面的配置隐藏密钥。Core 提取使用任务冻结的连接快照，Quiz 配置由 Host 派生到 `quiz.env`。设置保存不调用模型，也不能证明服务连通；活动生成、练习或文档处理期间，服务会拒绝可能中断工作的设置变更。

| home 内路径 | 内容 |
| --- | --- |
| `core/` | Core SQLite 与相关本地状态 |
| `quiz-data/quiz.sqlite` | Quiz 数据库 |
| `quiz-data/uploads/`、`chroma/`、`images/` | 上传文件、向量与本地图片 |
| `library.json`、`library-delete.json` | 学习书目录、版本与删除恢复日志 |
| `settings.json`、`identity.json` | 私有模型设置与 Core 身份 |
| `mcp-requests/` | MCP 生成请求摘要与结果记录 |
| `mcp-connection.json` | 运行期回环地址和随机令牌，退出时移除 |
| `venv/`、`quiz-venv/`、`runtime.json`、`quiz.env` | Python 环境、解释器路径与派生配置 |

备份前需退出应用。`src/standalone/maintenance.ts` 获取数据目录锁，备份 Core、整个 `quiz-data`、私有设置、身份、书库、删除日志和 MCP 请求记录到 home 外的全新目录，并保存文件校验清单。备份不包含 Python 环境或外部 COS 对象。

恢复只写全新目录，先校验文件，再发布恢复目录；之后通过 init 准备运行环境。旧 DSH/MySQL 数据不能直接当作当前 SQLite home 恢复。操作步骤见 [独立 Web 维护说明](standalone-web.md#备份与恢复) 与 [题库迁移说明](quiz-integration.md)。

## 7. 验证范围与代码导航

普通回归使用假模型，验证契约、状态、鉴权、持久化和调用次数；不能据此证明真实模型质量、供应商计费行为或全部网络故障场景。

- `test/standalone-mcp.test.ts` 同时包含模拟端口的定向测试和真实服务/stdio 集成测试。其中来源生成的不确定结果测试通过 POST 抛错、重新创建操作对象并读取同一请求日志，验证重放不增加请求；该条测试不实际重启进程或调用模型。
- `services/quiz/tests/test_source_generation.py` 验证来源任务并发去重、参数冲突、数据库重新打开后的复用、失败与保存回滚等行为，生成服务使用替身。
- `test/`、`python/tests/`、`services/quiz/tests/` 分别覆盖 TypeScript 产品面、Core 和 Quiz。桌面与插件验证入口见 [README](../README.md#开发与验证)。

主要入口：`src/standalone/cli.ts`（初始化与维护）、`src/standalone/server.ts`（Host 装配）、`src/desktop/main.ts`（桌面生命周期）、`src/product/routes.ts` 与 `quiz-routes.ts`（业务路由）、`python/nobei_core/service.py` 与 `repository.py`（Core 业务及持久化）。历史 DSH 运行资料保留作参考，不是当前安装依赖。
