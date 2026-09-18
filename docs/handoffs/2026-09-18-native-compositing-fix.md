# macOS 透明窗口切页残影修复

## 故障与原因

书架 → 设置 → 知识库后，原生窗口保留已经卸载的旧页面像素。独立 Electron 复现中，DOM 中学习书架数量为 0，但 macOS 窗口截图仍有书架、设置卡片。单独使用 Chromium 的 capturePage 或浏览器预览不能代替原生窗口检查。

`src/desktop/main.ts` 设置了透明 backgroundColor，Swift 桥接又将 NSWindow.isOpaque 设为 false，但 BrowserWindow 未声明 transparent。修复为仅在 macOS 设置 `transparent: true`，使 Chromium 与 AppKit 的透明合成配置一致。Linux 保留原背景行为。未改变 React 挂载策略、学习数据或透明度滑杆范围。

Electron 文档明确要求 transparent 为 true 才支持 backgroundColor alpha：
https://github.com/electron/electron/blob/main/docs/api/structures/base-window-options.md

## 验证

- 同一真实前端、相同原生玻璃桥接、相同切页顺序的旧/新配置对照；原生窗口截图显示旧配置残影、新配置无残影。
- 本地对照截图位于 output/render-check/legacy-real.png 与 fixed-real.png（生成文件，不提交）。
- `node scripts/verify-desktop.mjs` 验证真实桌面应用、临时 home、假模型服务、透明度、练习、考试、统计和重启。
- 打包后用 BETTERLEARN_DESKTOP_EXECUTABLE 指向包内 BetterLearn 再运行同一桌面验收。
- DMG 用 hdiutil verify 检查完整性。发布仍为未签名的 Apple Silicon 0.1.0 本地安装包。

后续修改透明窗口或原生玻璃时，必须检查原生窗口在多次切页后的实际画面，不能仅检查 DOM、前端截图或打包成功。
