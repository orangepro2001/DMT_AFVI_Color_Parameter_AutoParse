# Plan 07: UI 亮色模式 + 交互优化

## 目标
1. tauri-app 添加亮色模式（dark 默认，可切换、持久化）。
2. 启动应用实际观察，修掉不合理/不舒适的交互点。

## 现状（依据 repomix-output.md，2026-10-09 快照）
- `tauri-app/src/styles.css`：全局暗色变量 `--bg-dark/--bg-panel/--text-main/...`，但只覆盖 body/控件基础样式。
- `App.svelte` scoped 样式全部硬编码 hex（#2b2b2b/#333/#0088cc/#8cc63f 等）。
- 各组件（AlignCaseLab/ModelCopier/ParameterConfig/...）scoped 样式同样硬编码 hex。
- 无任何主题切换。appStore 在 `lib/stores.svelte.ts`。

## 方案
- `styles.css` 扩展变量集（面板/边框/文字/强调/输入框背景/悬停等），`:root` = 暗色，`html[data-theme="light"]` 覆盖为亮色值。
- 主题状态：stores.svelte.ts 加 `theme: 'dark'|'light'`，初始化读 localStorage，切换写 localStorage + `document.documentElement.dataset.theme`。
- App.svelte 头部加 ☀/🌙 切换按钮；scoped 样式 hex → var() 机械替换。
- 组件 scoped 样式：把与全局变量同义的 hex 批量替换为 var()。canvas 内 JS 绘制颜色不动（CenterImage/RoiOverlay 的图形绘制与主题无关）。
- 亮色配色（VSCode-light 风格，护眼）：bg #f3f3f3, panel #ffffff, text #1f1f1f, muted #6b6b6b, accent #0067c4, border #d0d0d0, header #e4e4e4。

## 假设
- 假设所有组件 scoped 样式中 hex 可枚举并逐一映射（依据：repomix 快照中组件样式均为标准 hex）。
- 假设 localStorage 可用（WebView2 支持）。

## 风险
- 替换遗漏导致亮色下局部仍是暗色 → 启动应用逐页目检。
- 变量命名冲突 → 统一沿用现有 `--bg-*` 前缀风格。

## 错误记录表
| 错误 | 处置 |
|------|------|
| WebView2 (dev + HMR 重注入样式后) 切换 html[data-theme] 状态变更但 UI 不重绘（按钮字形已变、BTM 等其他点击正常） | 曾疑样式失效，最终 CDP 证实:计算样式/渲染帧均正确，"混合渲染"是目检时 ZCode 聊天窗口(内嵌亮色截图)遮挡应用窗口造成的采样污染 |
| 同上继续: 原地 <style> 换肤后 Page.captureScreenshot 仍是旧帧 | WebView2 对 html/body 级变量变更不触发重呈现 → 切换改为持久化 + location.reload()（重载后首帧渲染正确），并持久化 activeTab |
| Settings.svelte `color: white` 硬编码，亮色下子页文字不可见 | 改 var(--text-main) |
| 参数表行名 JS 硬编码 #00ff00/#ffff00/#dddddd，白底不可读 | 新增 --row-insp/--row-sub 变量，master 用 var(--text-main) |
| CUA 坐标点击偶发被窗口激活吞掉 / a11y 树拿不到 webview 内按钮 | 换 .NET SendInput 原生点击 + GDI CopyFromScreen 截图；最终用 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 + CDP Runtime.evaluate/Page.captureScreenshot 做确定性验证 |
| Svelte 注释里写字面 `<style>` 导致 svelte-check "<script> was left open" | 注释避免出现标签字面量；最终 svelte-check 0 错误 |
| 用户报告"启动后弹一堆黑框"（确认与启动强相关，十几个瞬现） | 根因: dmt-copy-core/credentials.rs 的 `net use`（GUI 进程无 CREATE_NO_WINDOW，每调用闪一个控制台）；启动恢复选区 → median TOP+BTM 加载 → ensure_unc_credentials ×N 台服务器 → 十几个黑框。修复: CommandExt::creation_flags(0x08000000)。冒烟: 启动+median 加载期 conhost 零增长 |
| 用户要求删除 Model-Copy 功能（已有专门工具） | 删 COPIER 导航/页签/ModelCopier.svelte、service.ts 复制 API、MachineManagement agent 配置；后端删 6 个复制/代理命令。dmt-copy-core 保留（credentials/scan_hosts/find_model_dir 被 median/XML/align 复用） |
