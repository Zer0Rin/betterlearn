# Codex / Claude Code 插件

两份宿主包装共用 BetterLearn MCP，不修改学习界面、不访问宿主凭证、不使用宿主模型替代 BetterLearn 的生成 API。先打开支持 MCP 的 BetterLearn。插件本身不会另起业务后端，也不会删除数据锁。

## 当前机器

- Codex：`betterlearn@personal` 已安装并启用，源位于 `~/plugins/betterlearn`，个人目录文件为 `~/.agents/plugins/marketplace.json`。新开任务后载入。
- Claude Code：`~/.claude/skills/betterlearn` 为本地插件，标识 `betterlearn@skills-dir`。新会话自动载入；已有会话可 `/reload-plugins`。
- 本次安装配置使用准备脚本解析出的 Node 绝对路径，并指向仓库 `dist/standalone/mcp.mjs`。这两个路径需保持可用。迁移或删除仓库前，应改为已安装应用内的 MCP 路径并重新准备插件。

可以尝试：“用 BetterLearn 查看我的练习历史”，或“用 BetterLearn 根据光合作用生成 3 道题”。生成会使用 BetterLearn 设置中配置的 API。

## 发布包与运行前提

`dist/installers/betterlearn-codex-plugin-0.1.0.tgz` 和 `betterlearn-claude-plugin-0.1.0.tgz` 包含各自 manifest、MCP 配置与使用技能。默认配置适用于 macOS 标准 `/Applications/BetterLearn.app` 安装位置，且要求宿主能找到 Node.js 24+。

非标准安装位置、Linux 独立 Web 或桌面进程找不到 Node 时，在本机生成带绝对路径的包装：

```sh
node scripts/prepare-plugins.mjs --node /absolute/path/to/node --mcp /absolute/path/to/mcp.mjs
```

输出为 `dist/plugins/codex/betterlearn` 与 `dist/plugins/claude/betterlearn`。默认 `--mcp` 为仓库构建的 `dist/standalone/mcp.mjs`，默认 Node 为执行脚本的 Node。可选 `--home` 指定 BetterLearn 数据目录。这个输出是本机配置，不应作为可搬迁的发布包。

macOS 应用中的 MCP 程序路径：`/Applications/BetterLearn.app/Contents/Resources/standalone/mcp.mjs`。

## 安装入口

Codex 使用 `.codex-plugin/plugin.json` 与个人 marketplace。可让 Codex 的 `plugin-creator` 将准备好的 `betterlearn` 包登记到个人 marketplace，再执行 `codex plugin add betterlearn@personal`。默认个人 marketplace 的 `./plugins/betterlearn` 源路径在本机 CLI 中解析为 `~/plugins/betterlearn`。已有个人 marketplace 应保留其他插件条目，不整体覆盖。更新版本使用该技能的 cachebuster / reinstall 流程。

Claude Code 可以直接测试目录：

```sh
claude --plugin-dir /absolute/path/to/dist/plugins/claude/betterlearn
```

本机 Claude Code 2.1.273 还支持 `claude plugin init betterlearn --with skills mcp`，创建 `~/.claude/skills/betterlearn`；将准备包内容放入这个新目录后会作为 `betterlearn@skills-dir` 自动加载。不要覆盖已有同名插件；初始化产生的示例 skill 应移除。旧版本可使用 `--plugin-dir`，或按官方 marketplace 流程安装。

## 验证与准确范围

以下为早期实际安装验证记录（当时为 7 个工具）：

- Codex CLI `0.154.0-alpha.6.2`：安装成功，插件列表显示 installed / enabled。
- Claude Code `2.1.273`：manifest 校验通过，inventory 显示 1 个技能和 1 个 MCP 服务；`claude mcp get plugin:betterlearn:betterlearn` 显示 Connected。
- 官方 MCP SDK 读取这两份实际安装的配置，启动各自连接程序，验证 7 个工具、服务状态、调用自身 API、跨客户端相同请求去重、同一练习历史和密钥不泄露。
- 使用临时目录和假供应商，不改用户的学习数据，不消耗用户模型 API 额度。
- 本轮未启动宿主模型的自然语言会话；协议连接与工具业务调用已经实测，不把它表述为两种宿主模型的完整对话验收。其他系统未实机验证，Windows 后端仍未适配。

2026-09-18 学习 MCP 扩展后，生成的 Codex／Claude 包已用官方 SDK 验证 **12 个工具**、共享后端与跨客户端去重；真实 stdio 测试另覆盖课程发现、来源出题及统计。三份技能源文档已同步。本轮未重装用户现有插件，不能把生成包验证视为已安装插件升级。

后续评估接入后，两份生成包的验证范围扩展为 **13 个工具**，并验证未配置模型时可只读查询空评估、不会触发模型请求。安装记录仍以此前实测版本为准，本轮没有重装用户插件。

学习目标接入后，生成包提供 **17 个工具**；目标列表可在未配置模型时读取，目标创建与归档仅按用户明确指令执行。真实SDK测试覆盖并发创建去重、截止进度读取、归档CAS、Core删除与重启后重放。仍未重装用户已安装插件。

复验生成包：

```sh
node scripts/prepare-plugins.mjs
node scripts/verify-plugins.mjs
```

复验已安装包，可传 `--codex /absolute/path/.mcp.json --claude /absolute/path/.mcp.json`。验证脚本会把数据目录覆盖为临时目录，因此要求被测配置未显式包含 `--home`。

官方依据：[Claude Code 插件参考](https://code.claude.com/docs/en/plugins-reference)、[本地插件加载](https://code.claude.com/docs/en/plugins)、[Codex plugin-creator](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/plugin-creator/SKILL.md)。

## 2026-09-18 复核修复后的安装更新

已备份旧安装到 `output/handoffs/plugin-backup-20260918-144651/`（Codex 源目录、Claude 已安装目录，包含原 TODO 模板）。通过 plugin-creator cachebuster 和 `codex plugin add betterlearn@personal` 正式重装，当前版本 `0.1.0+codex.20260918064758`，CLI 确认为 installed / enabled。Claude skills-dir 插件同步更新且 manifest 校验通过，根目录同名 TODO 模板已从加载目录移除。

两份实际安装的 MCP 配置已通过 `verify-plugins.mjs --codex … --claude …`：17 工具、共享临时后端、跨客户端请求去重、无模型配置的只读评估及凭证不泄露。已安装技能与仓库共享技能 SHA-256 一致，包含空答案证据排除和目标延迟结算规则。所有验证使用临时 home / fake provider，不操作日常学习数据。Codex 新开任务载入新版本；Claude 可新开会话或 `/reload-plugins`。未验证宿主模型自然语言对话。
