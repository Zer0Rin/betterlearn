# BetterLearn 项目上下文

> 面向后续 AI/Agent 的仓库导航。更新时间：2026-09-18。以当前工作树代码为准；如果本文件与代码冲突，先核对代码和测试，再修正文档。

## 1. 项目定位

BetterLearn 是本机运行、单用户使用的学习工作台，当前主目标是独立 Web 和 Electron 桌面应用。它把资料或 DSH 对话转成可审核的知识点、学习书和课程进度，同时内置知识库与 AI 练习功能。

当前运行不需要安装 DSH 或 MySQL：

- 知识提取、证据审核、学习书使用 Python Core + SQLite。
- 知识库检索和练习使用 `services/quiz`（FastAPI/Python），数据使用 SQLite、上传文件和 Chroma。
- 文本模型、Embedding、图片和联网检索均由用户在本机配置；未配置模型时仍可浏览已有数据。
- Web 与桌面共用页面、产品路由和本地数据目录。

## 2. 当前入口与运行方式

### 独立 Web（默认开发/验证入口）

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
python3.12 -m venv .venv-phase1b
.venv-phase1b/bin/python -m pip install -r python/requirements-phase1-dev.lock
python3.12 -m venv services/quiz/.venv
services/quiz/.venv/bin/python -m pip install -r services/quiz/requirements.txt
node dist/standalone/betterlearn.mjs init --home "$HOME/.betterlearn-web" --python /absolute/path/to/python3.12
node dist/standalone/betterlearn.mjs start --home "$HOME/.betterlearn-web"
```

要求：Node.js 24+、Python 3.12、macOS/Linux。默认地址 `http://127.0.0.1:3210`。`init` 创建 Core 和 quiz 两个隔离 Python 环境；`start` 启动 HTTP Host、Core 子进程和 quiz 子进程。

### Electron 桌面

```bash
corepack pnpm start:desktop
corepack pnpm pack:desktop
corepack pnpm test:desktop
```

桌面壳在 `src/desktop`，共享 `dist/standalone` 中的 Web 资源。macOS 原生玻璃代码在 `src/desktop/native`；它需要 macOS 26+ SDK/Xcode，不能据此宣称其他平台有同样效果。

### MCP

先启动 BetterLearn，再运行：

```bash
node dist/standalone/mcp.mjs --home /absolute/path/to/.betterlearn-web
```

MCP 通过 stdio 连接已运行的本机服务，不启动第二套业务后端。工具定义在 `src/mcp/tools.ts`，仅提供状态、资料读取、练习历史、异步出题和任务查询；生成可能产生用户 API 费用，必须复用同一 `request_id` 重试。

## 3. 仓库结构

```text
src/standalone/       独立 Web CLI、HTTP Host、配置、数据维护、quiz 管理、页面入口
src/desktop/          Electron 主进程、preload、首次启动页、原生玻璃桥接
src/client/           共享 React 工作台；quiz UI 位于 src/client/quiz
src/product/          与运行宿主无关的产品业务、路由、Core/quiz 装配、生成协调
src/mcp/              MCP stdio CLI 与工具契约
python/nobei_core/    Core 状态机、SQLite、候选提取、证据定位、审核和学习课程
services/quiz/app/    从 yu-ai-learn 迁入并改造的知识库/练习 FastAPI 服务
contracts/            跨语言候选和 RPC JSON 契约
test/                 TypeScript/Vitest 集成与产品测试
python/tests/         Core Python 测试
services/quiz/tests/  quiz Python 测试
acceptance/           fake provider、真实服务夹具和验收程序
scripts/              构建、打包、插件准备和验证脚本
docs/                 架构、安装、桌面、MCP、插件、迁移和验收记录
legacy/dsh/           旧 DSH 插件资料，仅供参考，不是当前默认运行依赖
```

关键入口：

- `src/standalone/cli.ts`：`init/start/backup/restore`。
- `src/standalone/server.ts`：本机 HTTP Host、同源/令牌认证、Core/quiz 生命周期和 API 装配。
- `src/product/routes.ts`、`src/product/quiz-routes.ts`：产品 API 路由。
- `src/product/generation-coordinator.ts`：模型生成流程、调用计划和任务协调。
- `src/product/core-supervisor.ts`、`src/standalone/subprocess.ts`：Core 子进程和 JSON-RPC 生命周期。
- `python/nobei_core/service.py`、`python/nobei_core/repository.py`：Core 业务服务和持久化。
- `src/standalone/client.tsx`、`src/standalone/App.tsx`：独立页面入口与应用壳。
- `src/client/NobeiClientView.tsx`、`src/client/components/`：共享提取/审核工作台。

## 4. 核心数据流

### 资料提取与学习书

1. 用户上传 PDF/DOCX/Markdown/TXT、粘贴文本，或选择普通 DSH 对话。
2. Host 生成只读预览和提取计划；预览不创建任务、不调用模型。
3. 用户确认后创建 run，Core 保存任务级模型快照。
4. Host 按 L1/L2/L3 计划调用结构化生成；Core 校验候选 Schema、精确定位证据并写入审核状态。
5. 用户接受/修改/拒绝候选；审核写入由 Core 事务和幂等键裁决。
6. 通过审核的知识点进入 SQLite 学习书和课程进度。

重要不变量：预览摘要与正式导入必须一致；已有任务重试沿用创建时模型快照；模型输出永远只是候选，不能绕过 Schema/证据审核；刷新或 Host 重启以 Core 持久状态为准。

### 知识库与练习

`src/client/quiz` 调用 `/nobei/quiz/v1`，Host 再代理到受管理的 quiz 子进程。练习服务保存文档元数据、题目和记录到 SQLite（`quiz-data/quiz.sqlite`），上传文件和向量分别保存到 `quiz-data/uploads` 与 `quiz-data/chroma`。练习成绩不会自动覆盖 Core 课程掌握度。

### DSH 对话导入

只允许用户显式选择的普通会话。Host 过滤为用户文字和模型可见文字，不读取 system prompt、reasoning、工具调用/结果、插件注入、图片或未知块；最多 50 个会话、正文最多 512 KiB。预览返回 SHA-256，提交时重新读取并校验，变化则要求重新预览。

## 5. 本地数据与安全边界

默认数据目录是 `~/.betterlearn-web`，包括：

- `venv/`、`quiz-venv/`：两个 Python 环境。
- `runtime.json`：运行时解释器路径。
- `settings.json`：本地模型配置；密钥只在后端保存。
- `core/`：Core SQLite。
- `quiz.env`、`quiz-data/`：派生的 quiz 配置、SQLite/文件/Chroma 相关数据。
- `mcp-connection.json`：仅在运行期间存在的 loopback 地址和随机令牌。
- 备份输出到用户指定的 home 外全新目录；包含 Core、quiz 数据、私有设置、书库和 MCP 请求去重记录。

不要把密钥、用户数据、虚拟环境或生成的 `dist/`、`lib/`、`evidence/`、`output/` 加入源码提交。不要把本机 API 暴露到公网。修改设置时要注意正在进行的生成、文档处理和练习任务；服务使用 home 锁防止同一数据目录被多个实例同时写入。

`betterlearn backup/restore` 覆盖 Core、整个 quiz-data、私有设置、身份、书库和 mcp-requests；不包含 Python 环境或外部 COS 对象。旧 MySQL/DSH 数据不能直接恢复为当前 SQLite home，详见 `docs/quiz-integration.md`。

## 6. 开发、测试与构建

常用检查：

```bash
corepack pnpm build          # TypeScript 检查 + standalone 构建
corepack pnpm test           # Web/产品/共享前端 Vitest
corepack pnpm test:core      # python/tests
corepack pnpm test:quiz      # services/quiz/tests
corepack pnpm test:desktop   # 真实 Electron + 临时目录 + fake provider
corepack pnpm test:plugins   # Codex/Claude 配置和 MCP SDK 验证
```

CI 的完整顺序见 `.github/workflows/ci.yml`：Node 24 + pnpm 11、Python 3.12，安装两个测试环境，运行 Web、桌面 shell 构建、插件验证、Core 测试和 quiz 测试。真实模型验收脚本存在，但默认测试使用 fake provider，不应为了普通回归调用收费 API。

TypeScript 配置按运行面拆分：`tsconfig.host.json`（旧/宿主相关 Host 源码）、`tsconfig.client.json`（共享客户端）、`tsconfig.web.json`（standalone + MCP）、`tsconfig.desktop.json`（Electron）。`pnpm test` 使用 `vitest.web.config.ts`，不是根目录默认配置。

## 7. 修改代码时的约定

- 先读相关 `docs/`、测试和类型契约；不要仅凭旧 DSH 文档推断当前运行方式。
- 跨进程/跨语言变更必须同步检查 `contracts/`、TypeScript 类型、Python 实现和对应测试。
- 不要在 client 保存业务事实、模型密钥或 JWT；持久化和幂等规则归 Core/quiz 服务。
- 不要让 standalone bundle 引入 `@deepseek-ai/*` 或 DSH 运行时；`scripts/build-web.mjs` 会检查这一点。
- 不要用任意路径读取、任意 HTTP 代理、自动重试或自动换 UUID 来“修复”MCP/后台任务问题。
- 对删除、恢复、迁移、升级先做只读确认，并保留可恢复备份；避免 `git reset --hard`、`git checkout --` 等破坏用户改动的命令。
- 完成实现后至少运行与改动面直接相关的测试；准备声称完成前，重新检查 `git diff` 和验证结果。

## 8. 当前工作树提示

当前分支为 `codex/electron-desktop`，相对 `main` 的工作树包含尚未提交的 Electron 桌面、MCP、插件、standalone 外观和相关文档/测试改动。处理任务时保留这些改动，不要将它们误判为可清理的临时文件；先用 `git status --short` 和 `git diff -- <file>` 确认范围。

进一步阅读：

- [README.md](README.md)：用户级快速开始。
- [docs/architecture.md](docs/architecture.md)：共享业务和提取协议的详细设计。
- [docs/standalone-web.md](docs/standalone-web.md)：独立 Web 配置、数据和维护。
- [docs/desktop.md](docs/desktop.md)：Electron 生命周期、打包和玻璃效果。
- [docs/mcp.md](docs/mcp.md)：MCP 工具、去重和认证。
- [docs/plugins.md](docs/plugins.md)：Codex/Claude 包装与验证。
- [docs/quiz-integration.md](docs/quiz-integration.md)：题库服务来源、配置和迁移。
