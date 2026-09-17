# BetterLearn 界面优化与验证

> 后续用户已将视觉方向改为蓝白。当前配色以 [蓝白配色修订](2026-09-17-blue-palette.md) 为准；下列色值和截图保留为首轮历史记录。

应用 jakubkrehel/skills 的 better-interface、better-accessibility、better-layout、better-writing、better-typography、better-colors 和 better-ui。11 个上游技能已安装到 ~/.codex/skills；安装时上游 HEAD 为 267330e1adfc66a718fb65fa6918c1f06d0a689e。

## 范围

React 18 + 原生 CSS，保留现有窗口、业务组件和后端契约。参照项目既有 `docs/superpowers/specs/2026-09-17-glass-workbench-proposal.md`，以清晰、克制、统一的学习工具为目标。

本次优化独立版外壳、书架、练习模块、设置及提取入口。浏览器使用隔离 mock 数据检查七个导航入口；未修改真实学习数据或模型设置。共享的旧 `CLIENT_CSS` 仍保留，独立版通过语义变量和布局适配接入，并非整个旧插件样式已迁移完毕。

## 实施清单

| 影响 | 领域 | 位置 | 原状 | 本次结果 | 用户收益 |
| --- | --- | --- | --- | --- | --- |
| HIGH | 颜色 | src/standalone/tokens.css:1；src/client/quiz/styles.css:1 | 次级文字过浅，练习仍使用旧蓝紫色与透明面板 | 建立语义色；练习模块直接引用同一套角色 | 阅读与跨页体验一致 |
| HIGH | 可访问性 | src/client/quiz/styles.css:524；src/standalone/styles.css:858 | 部分输入样式强制清除 outline；没有跳转内容入口 | 清除 outline:none!important，统一可见焦点，增加跳到内容链接 | 键盘操作能定位当前控件 |
| MEDIUM | 布局 | src/standalone/styles.css:898 | 320px 上传区域文字被按钮挤成细列 | 小容器纵向排列上传说明与操作 | 文件要求与上传按钮可读、可达 |
| MEDIUM | 排版 | src/standalone/styles.css:200；src/standalone/bookshelf.css:1 | 10–11px 辅助文字、书封标题频繁断行 | 常规正文 14px、辅助 12px；扩大书封；卡片下方完整显示书名 | 更容易扫描标题与进度 |
| MEDIUM | 视觉层级 | src/standalone/bookshelf.css:291 | 管理与新建按钮同权重 | 新建使用实色主按钮，管理维持次级样式 | 主要操作清楚 |
| MEDIUM | 文案 | src/client/NobeiClientView.tsx:62；src/standalone/App.tsx:184 | 独立版报错仍要求 DSH；提取入口缺独立页标题 | 模型错误引导到设置，补齐知识提取标题和说明 | 用户知道在哪里、下一步做什么 |
| MEDIUM | 可维护性 | src/standalone/client.tsx:1 | 完整旧外壳再叠 glass.css 补丁 | 重建独立外壳样式，删除 glass.css；格式化模块 CSS | 降低外壳样式互相覆盖的成本 |

## 覆盖

| 领域 | 检查证据 | 结果 |
| --- | --- | --- |
| 可访问性 | 导航可访问名称、输入标签、练习下拉菜单打开/关闭、Tab 焦点实际 outline | 所测路径通过；未完成屏幕阅读器全流程审计 |
| 布局 | 320/800/1200/1600px，七个导航入口；检查主内容 scrollWidth 与 clientWidth | 28 个组合均无主内容横向溢出；320px 上传布局已复查 |
| 文案 | 模型未配置、知识提取标题、书架主操作 | 独立版恢复指引明确 |
| 排版 | 六本不同长度的书名、窄屏表单与知识库说明、系统中文字体 | 书架标题可完整读取；小屏输入使用 16px |
| 颜色 | 浏览器读取实际前景与承载元素背景，计算 WCAG 相对亮度比 | 下表所列文字均超过 4.5:1 |
| UI | 书架/练习/设置截图、状态色声明、减少动态效果与减少透明度规则 | 保留窗口层玻璃；内容模块取消蓝紫光晕与悬浮位移 |

实测色对（不包含禁用控件，也不是全站对比度认证）：

| 内容 | 前景 / 背景 | 对比度 |
| --- | --- | --- |
| 书架进度辅助文字 | #5d6962 / #ffffff | 5.73:1 |
| 主按钮 | #ffffff / #35634e | 6.89:1 |
| 模型配置提示 | #795a24 / #fcf8ee | 6.00:1 |
| 首本书封辅助文字 | #f5f3ec / #485653 | 6.92:1 |

## 验证

- `pnpm test`：47 个文件、484 项测试通过，包含真实本地服务 + 模拟供应商的端到端回归。
- 随后修改了知识提取标题和模型错误显示，重新 `pnpm build:web`，并运行 `test/client-view.test.tsx` 与 `test/standalone-client.test.tsx`，19 项通过。
- `git diff --check`：通过。
- 浏览器检查：有内容书架；知识库、练习历史空状态；练习设置与下拉菜单；模型未配置提示；设置表单；知识提取入口。
- 浏览器键盘抽查：练习示例按钮获得绿色 3px solid outline，offset 3px；下拉菜单可用 Escape 收起。
- 截图：`output/playwright/interface-refresh/bookshelf.png`、`practice.png`、`mobile-knowledge.png`（忽略的本地验收产物）。
- 未验证：Safari/Firefox、真实 200% 浏览器缩放、屏幕阅读器、全站 axe 审计、真实模型输出的长课程与完整答题复盘浏览器流程。课程与答题业务由既有回归测试覆盖，不等于完成这些状态的视觉验收。

## 结论

Approve：限上述已检查的入口与初始状态，本轮发现的问题已修复。此结论不代表旧插件样式已全部重构，也不代表全站无障碍认证。
