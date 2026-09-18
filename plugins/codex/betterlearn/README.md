# BetterLearn 插件

需要正在运行的 MCP 版 BetterLearn 和 Node.js 24+。默认 `.mcp.json` 使用 macOS 标准应用路径；其他位置请将 command 改为 Node 的绝对路径、args 首项改为 BetterLearn mcp.mjs 的绝对路径。自定义数据目录可在 args 中追加 --home 和目录绝对路径。

生成调用 BetterLearn 自己配置的 API，可能产生其正常费用。插件不接管宿主账号或订阅额度。资料与练习历史是本机用户数据。

安装与验证详见项目 docs/plugins.md。Codex 使用个人 marketplace 安装；Claude Code 可通过 --plugin-dir 加载本目录。安装后新开会话。
