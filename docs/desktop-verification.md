# Electron 桌面版验收记录

日期：2026-09-17。平台：macOS arm64。Electron 44.4.1，electron-builder 26.15.3。

## 2026-09-18 最新安装镜像收尾

- 从上一节最终验收通过的 macOS arm64 `.app` 使用 `--prepackaged` 生成新镜像，路径为 `dist/installers/verified-2026-09-18/BetterLearn-0.1.0-arm64.dmg`。此前根目录 DMG 保留为历史产物。
- `hdiutil verify` 校验通过。只读挂载后逐项比对应用，共 **498** 个文件/符号链接的内容、链接目标与可执行标记一致；已卸载临时挂载。
- SHA-256：`9be91682f04846abd97fa7ec0eea0989e7141d8c74f880455135fa146c78d8b7`。同目录提供 `SHA256SUMS`、`verification.json` 和本机验收包说明。
- 本轮未改业务代码，仅制作镜像并更新文档；不额外重复全套业务测试。仍为未签名、未公证的本机验收包，依赖 Python 3.12 和首次环境准备的网络。

## 2026-09-18 新学习流程桌面验收

此节为最新结果，后文保留早期验收历史。

- 扩展 scripts/verify-desktop.mjs，新增 scripts/verify-desktop-learning.mjs。通过公共 API 准备已审核课程，在真实 Electron 页面验证知识点出题、自动来源、题库详情、到期复习入口、学习目标、组卷预览、逐题审核、开考与服务端草稿。
- 正常退出后重启：原来源任务可恢复，考试答案保留、截止不变；交卷结果为 1/3 正确、XP=0。可进入准确成绩和知识点作答历史，未自动调用 AI 报告；整段重启后操作不增加模型调用。两个业务窗口的未处理渲染异常均须为空。
- 原生截图发现透明背景上的练习标题对比不足，桌面 .zl-heading 现沿用独立组件底色，不调整全局背景或文字透明度；验收断言 90% 组件底色及文字 opacity=1。
- Core **414 passed**；Quiz **369 passed**（53 既有警告）；外观与客户端相关 **25 passed**；桌面构建、插件 **17 工具** 验证与 diff check 通过。Web 全套上轮为 624，本轮只重跑直接相关 25 项。
- 最新 `dist/installers/mac-arm64/BetterLearn.app` 已重新打包，并以该可执行文件完整跑通扩展验收。未签名/未公证，本轮没有重新生成 DMG；旧 DMG 不包含本次全部变化。
- 原生截图：`dist/desktop-verification/exam-draft-native.png`、`knowledge-history-native.png`。网页截图无法包含原生玻璃，外观判断使用系统窗口截图。
- 全程使用临时 home / fake provider，未读写日常数据或使用收费 API；脚本正常退出并清理临时目录。未增加 Linux/Windows 实机验证。

## 已验证

- `corepack pnpm build:desktop`：Web 与桌面 TypeScript 检查、前后端构建成功。
- `corepack pnpm exec vitest run --config vitest.web.config.ts`：最初 Electron 阶段为 50 个文件、508 项测试通过（历史记录，非当前总数）。包含真实 Python 服务、假模型接口的独立版业务闭环。
- 新增的 10 项运行环境测试覆盖配置损坏、版本错误、安装失败重试、私有配置发布、依赖缺失，以及发现、验证和安装阶段的取消。安装测试用可控子进程替代 pip 联网安装。
- 直接验证本机现有 Python 3.12 Core/Quiz 环境的版本与必要导入成功。
- `electron-builder --config electron-builder.yml --dir`：生成 macOS arm64 应用。Python 与页面资源位于 ASAR 外的 `Contents/Resources/standalone`。
- `electron-builder --config electron-builder.yml --mac dmg`：生成 `dist/installers/BetterLearn-0.1.0-arm64.dmg`（约 126 MiB），未签名。
- `hdiutil verify dist/installers/BetterLearn-0.1.0-arm64.dmg`：镜像校验通过。
- `BETTERLEARN_DESKTOP_EXECUTABLE=.../BetterLearn.app/Contents/MacOS/BetterLearn node scripts/verify-desktop.mjs`：以真实打包应用执行成功。

真实桌面验证使用临时数据目录和假模型 HTTP 服务，没有使用用户原有学习数据、密钥或收费 API。验证步骤包括：

1. 新目录打开首次准备页面，发现 Python 3.12，退出后没有伪造成功的 runtime.json。
2. 使用已准备的测试 Python 环境启动打包应用，真实服务读取安装包内的 Python 模块和契约文件。
3. 确认 renderer 不暴露 Node require，contextIsolation 与 sandbox 开启；业务页面调用初始化 IPC 被拒绝。
4. 在设置界面填写模型地址、名称与密钥并点击保存；公开配置仅返回密钥存在标记。
5. 输入“光合作用”，选择三道题，点击生成练习，显示来自假模型 API 的选择题；选择答案后显示正确反馈。
6. 读取历史不新增模型请求。正常退出后 HTTP 服务不可访问；立即重启成功，数据锁已释放，配置及 localStorage 标记保留。

截图保存在 `dist/desktop-verification/setup.png`、`quiz.png`、`settings.png`，为本地构建产物，不作为源文件提交。

## 验证中修复的问题

- 启动阶段的 Python 发现和依赖检查原先不响应关闭信号，已贯穿 AbortSignal 并补挂起子进程取消测试。
- 原设置页面在函数式状态更新中读取输入事件 currentTarget，真实输入密钥时会因事件已结束而崩溃。新增回归测试先复现异常，改为在事件处理时捕获输入值；组件测试与真实桌面填写流程均通过。

## 验证边界

- 已验证 macOS arm64。Linux 提供打包配置，尚未在 Linux 桌面运行；Windows 未适配。
- 首次准备页面和安装流程的失败／取消逻辑已有验证；本轮没有在完全干净的机器上重新联网安装全部 Python 依赖。桌面仍要求预先安装 Python 3.12。
- 假供应商证明调用链与业务流程，不代表真实模型质量、搜索供应商可用性或账户额度。
- 应用未配置 Developer ID 签名、公证和自动更新，不能按已签名公众发行包宣传。
- MCP 接口、Codex／Claude Code 插件包装现已完成本机安装与协议验证，见 `docs/plugins.md`；没有宿主模型或账号集成。

## 2026-09-17 原生玻璃更新

- Electron 主进程加载 Node-API / SwiftUI 模块；macOS 26+ 使用真实 `glassEffect`，不将 CSS 模糊称为原生 Liquid Glass。
- 桌面模式取消嵌套窗口、重复控制按钮和装饰背景，保留浏览器模式。
- 20 项客户端与玻璃偏好测试通过；真实 Electron 验证包含原生桥接成功、拒绝非法外观参数、API 出题、退出与重启。
- 打包后的 macOS arm64 应用验证原生模块从 ASAR 外成功加载。
- `native-window.png`、`native-glass-0.png`、`native-glass-100.png` 为系统窗口截图；网页截图不包含 SwiftUI 原生图层。
- 两层更新后由独立组件底色保护可读性；文字不随背景透明度变化。旧版 macOS、Linux 与 Windows 分支未在本轮实机验证，Windows 后端支持仍未完成。

## 两层外观更新

21 项客户端与偏好测试通过。保留旧背景偏好并新增独立组件底色值；两者互不覆盖。主内容容器透明，设置区域拆成组件卡片。桌面验收脚本检查固定背景时组件底色变化、文字 opacity 保持 1，并检查重启后两值独立恢复。

## 评审核查修复

当前 Web/独立版全量为 51 文件、513 项通过。508 是最初 Electron 阶段的历史计数，512 是上次 MCP 阶段计数。CI 已增加插件 SDK 集成验收，原生 SwiftUI 和 DMG 仍需 Mac 本机验证。桌面验收失败后的清理采用 best-effort，并保留原始失败；正常验证过程的退出检查仍严格断言。

本次评审核查后，本机重新运行 `node scripts/verify-desktop.mjs` 成功（由本轮 `build:desktop` 生成的应用），`node scripts/verify-plugins.mjs` 成功；已重新生成 DMG 和两份插件归档。没有关闭 Chromium sandbox，也没有修改前端界面。
