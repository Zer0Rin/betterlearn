# BetterLearn

[![CI](https://github.com/Zer0Rin/betterlearn-for-dsh/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Zer0Rin/betterlearn-for-dsh/actions/workflows/ci.yml)

本机运行、单人使用的学习工作台。独立 Web 与 Electron 桌面入口共用界面、应用接口与数据；生成与搜索使用自己配置的 API。

**现在无需安装 DSH 或 MySQL。** 浏览器页面、模型设置和启动入口均独立；知识提取与课程使用 Core SQLite，知识库与练习使用 Quiz SQLite，向量检索使用 Chroma。

## 学习流程

- 文件、粘贴正文或知识库 → 候选提取 → 逐字证据校验 → 人工审核 → 知识点 → 学习书与课程进度。
- 知识库、主题或课程知识点 → AI 出题 → 保存草稿 → 交卷成绩 → 按需生成 AI 报告。
- 题库支持错题、收藏、分类与来源绑定；学习目标按知识点版本统计证据，到期复习使用课程队列。
- 从已有题库多来源组卷 → 预览缺口 → 逐题覆盖审核 → 计时考试 → 独立成绩；考试不自动更新课程掌握度。
- 支持知识库 PDF、DOCX、Markdown、TXT；PDF 仅文字层，无 OCR。
- 模型设置统一在页面中管理；文本模型使用支持工具调用的 OpenAI 兼容接口。Embedding、图片与联网检索分别配置。
- 配图可保存本机，不需要 COS。未配置外部模型时可以浏览已有学习数据。
- 本地书库具有版本冲突检测，多标签页不会静默覆盖彼此的修改。

页面操作与恢复规则见 [学习功能使用指南](docs/learning-workflows.md)。

## 启动

当前后端支持 macOS/Linux，源码启动需要 Node.js 24+、Python 3.12。运行模型需要自行配置可用服务；不是离线模型安装器。Windows 尚未适配。

桌面入口：安装依赖后运行 `corepack pnpm start:desktop`，首次启动按页面指引准备 Python 环境。打包、依赖前提与数据目录说明见 [Electron 桌面版](docs/desktop.md)。桌面包自带 Node 运行时，仍需 Python 3.12；MCP 业务接口与 stdio 连接程序已实现，见 [MCP 使用说明](docs/mcp.md)；[Codex／Claude Code 插件包装](docs/plugins.md)已完成本机安装与协议验证。

浏览器入口：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build

# 将 python 路径替换为本机 Python 3.12 的路径。
node dist/standalone/betterlearn.mjs init \
  --home "$HOME/.betterlearn-web" \
  --python /opt/homebrew/bin/python3.12

node dist/standalone/betterlearn.mjs start --home "$HOME/.betterlearn-web"
```

打开终端输出的本机地址（默认 `http://127.0.0.1:3210`），进入“设置”填写文本模型。首次初始化会安装两个隔离的 Python 环境；正常启动无需再次安装。

`dist/standalone/` 是可独立复制的交付目录，不依赖仓库原位置或 Node `node_modules`。生成压缩包：`corepack pnpm pack:web`。解压后在目录内使用 `node betterlearn.mjs init/start`。

配置方式、备份恢复、运行边界见 [独立版使用说明](docs/standalone-web.md)，实际验证结果见 [独立版验收记录](docs/standalone-web-verification.md)。

## 数据与维护

新版本默认使用独立目录 `~/.betterlearn-web`，不自动读取或迁移 DSH/原教程数据。退出应用后可以备份全部本地学习数据：

```bash
node dist/standalone/betterlearn.mjs backup \
  --home "$HOME/.betterlearn-web" --to /absolute/path/to/new-backup
node dist/standalone/betterlearn.mjs restore \
  --home /absolute/path/to/new-home --from /absolute/path/to/new-backup
```

恢复目标必须是新目录；恢复后在该目录运行 `init` 准备 Python 环境。备份包含私有模型配置，请妥善保管。

## 开发与验证

```bash
python3.12 -m venv .venv-phase1b
.venv-phase1b/bin/python -m pip install -r python/requirements-phase1-dev.lock
python3.12 -m venv services/quiz/.venv
services/quiz/.venv/bin/python -m pip install -r services/quiz/requirements.txt
corepack pnpm test
corepack pnpm test:core
corepack pnpm test:quiz
```

默认测试覆盖独立 Web 与通用业务，不要求 DSH。端到端测试使用临时 SQLite、真实 Python 服务与 Chroma、假模型 HTTP 服务，不调用真实收费模型。

代码入口：`src/standalone/`（页面、配置、HTTP 服务、CLI），`src/product/`（共享业务装配），`python/nobei_core/`（提取与课程），`services/quiz/`（知识库与练习）。

旧 DSH 插件基线为 `d099d11`。当前源码仍保留部分宿主适配代码用于后续参考，默认构建、安装和运行不加载它们；旧插件说明移至 [历史文档](docs/dsh-plugin-legacy.md)，依赖清单存放于 `legacy/dsh/`。其他旧阶段文档中的 DSH/MySQL 操作不适用于独立版。

## 许可证

项目采用 [MIT License](LICENSE)。迁入的鱼皮项目来源与许可证保存在 `services/quiz/PROVENANCE.md` 和 `services/quiz/LICENSE`。
