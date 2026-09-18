# BetterLearn 桌面版

Electron 桌面版复用独立 Web 的学习界面、API 配置、数据库和 Python 服务。无需安装 DSH、Codex 或 Claude Code；输入材料后点击生成，内容由 BetterLearn 设置中配置的 API 生成。MCP 接口与 Codex／Claude Code 包装已完成本机安装和协议验证，见 [MCP](mcp.md) 与 [插件说明](plugins.md)。

实际测试范围与结果见 [桌面验收记录](desktop-verification.md)。

## 运行

目前支持 macOS/Linux 的后端路径，Windows 尚未适配。首次使用需要先安装 Python 3.12。桌面启动页会查找 PATH、Homebrew 与 python.org 常见安装位置，在下拉列表中显示检测到的版本并自动选中一个；可直接点击“准备学习环境”。自定义安装未被发现时，可展开“高级选项”手动指定可执行文件。

在源码目录运行：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm start:desktop
```

开发构建需要 Node.js 24+。首次运行 Electron 工具时可能下载 Electron 二进制。打包后的应用自带 Electron/Node 运行时，不要求单独安装 Node；Python 3.12 仍为外部前置依赖，本版不是包含 Python 的离线安装包。

启动页点击“准备学习环境”后，会联网创建两个独立 Python 环境并安装依赖。页面显示当前阶段。只有验证成功才发布运行环境配置；失败可重新选择 Python 并准备，学习数据库不会被删除。安装过程中退出会取消子进程，完成清理后退出。

已有可用的独立 Web 运行环境会直接复用。进入“设置”填写文本模型 API；Embedding、图片和搜索配置按需填写。搜索沿用当前 Tavily 接口，不调用宿主的搜索能力。

## 数据与退出

默认数据目录为 `~/.betterlearn-web`，与独立 Web 相同。桌面版和 Web 不能同时使用同一数据目录，已有数据锁会阻止第二个服务启动，此时仅提示关闭其他实例或等待维护任务完成后重新检查，不显示首次准备和 Python 选择控件。不会自动导入旧 DSH 数据。

关闭最后一个窗口即退出应用，包括 macOS。前端有待保存内容或保存错误时会提示；选择返回工作台可等待保存或处理错误。正常退出等待后端关闭和数据锁释放，不自动重发生成任务。

默认本机端口为 3210。稳定 origin 用于保留当前界面的浏览器存储；端口被其他进程占用时会显示错误，不自动切换端口。Electron 的浏览器存储独立于外部浏览器，所以 Web 的未保存草稿及界面偏好不会自动迁入桌面；已持久化的学习数据仍共用。

模型密钥保存在本机后端配置中，公开配置只包含“已配置”标记。桌面页面禁用 Node 集成，启用 context isolation 和 sandbox；初始化桥接只允许本地启动页调用。

## 打包

```bash
corepack pnpm pack:desktop
# 只生成本机应用目录，不制作安装镜像：
corepack pnpm build:desktop
corepack pnpm exec electron-builder --config electron-builder.yml --dir
```

输出位于 `dist/installers/`。macOS 默认制作 DMG，Linux 配置为 AppImage；应在目标平台验证。Python 模块、数据库 schema、练习服务及页面放在应用的 `resources/standalone` 实际文件树中，不能放在 Python 无法读取的 ASAR 内。

每次打包的安装镜像输出到 `dist/installers/`。2026-09-18 的手动向量化修复已对实际打包应用完成验证，记录见 [手动向量化验收](handoffs/2026-09-18-manual-vectorization.md)；较早镜像及 SHA-256 记录见 [桌面验收记录](desktop-verification.md)。

没有配置发布签名、公证或自动更新；本地构建产物不能视为已签名的公众发行版。不要把开发机的虚拟环境或用户数据复制进安装包。

## 独立验证

在已准备仓库测试 Python 环境的机器上运行：

```bash
corepack pnpm test:desktop
```

此命令打开真实 Electron，使用临时数据目录和假模型 HTTP 服务，验证启动页、隔离配置、密钥隐藏、知识点出题、学习目标、组卷审核、考试草稿保存及退出重启后的恢复与交卷，同时检查知识点统计和独立报告边界。不会调用用户配置的收费模型。截图输出到 `dist/desktop-verification/`。

可设置 `BETTERLEARN_DESKTOP_EXECUTABLE` 为打包后的可执行文件路径来运行同样的验证。

维护与测试可显式指定 `BETTERLEARN_HOME`（同时隔离 Chromium 配置目录）和 `BETTERLEARN_PORT`。`BETTERLEARN_PYTHON` 与 `BETTERLEARN_QUIZ_PYTHON` 必须成对提供，用于显式复用已有环境；默认读取数据目录中的 `runtime.json`。不要给普通用户设置这些覆盖项来代替首次准备流程。

## macOS 原生玻璃

桌面版继续使用 Electron 和共享 WebUI。macOS 26 及以上通过主进程 Node-API 模块，把 SwiftUI `NSHostingView` 放在 Electron 内容层下方，使用 `.glassEffect(.clear)` 绘制 Liquid Glass；外观滑块叠加系统材质与背景遮罩，不降低文字透明度。系统“减少透明效果”会切换为实色背景。旧 macOS 回退到系统 vibrancy，其他平台保留 CSS 材质。

桌面模式使用系统窗口控制，移除网页模拟窗口、外围装饰背景和二次缩放控件；浏览器模式保留原有布局。外观偏好继续保存在本地。原生桥接仅允许工作台主 frame 调用，页面不能传入原生窗口指针。

macOS 构建需要包含 macOS 26+ SDK 的 Xcode，以及 Node-API 头文件（可通过 `NODE_INCLUDE_DIR` 指定包含 `node_api.h` 的目录）。Swift 模块在 macOS 构建时编译，非 macOS 构建跳过；当前脚本为本机架构构建，不支持直接交叉打包 universal。Swift/Node-API 源码位于 `src/desktop/native/`，打包将模块解压到 ASAR 外加载。

外观提供两层独立设置：“窗口背景”控制下层原生玻璃与遮罩浓度，“组件底色”控制导航、设置卡片、表单和输入框的背景 alpha。主内容容器保持透明，组件间隙可看到下层；文字、图标和主操作按钮不跟随透明度变化。两层分别保存，原有玻璃偏好作为窗口背景值保留，组件默认 85%。系统减少透明效果会覆盖两层为实色。
