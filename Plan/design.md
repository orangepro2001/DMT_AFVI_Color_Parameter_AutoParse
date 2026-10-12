# Plan 07: UI 亮色模式 + 交互优化

## 2026-10-12：实机 TEACH 界面重构

### 需求与边界
- 以用户实机截图为视觉目标，`ui-prototype/index.html` 为控件参考，重做 Tauri/Svelte 应用的 UI 与交互。
- 保留亮色主题及现有真实图像、模型选择、参数读取等功能；不能确认含义的实机按钮暂不实现业务操作。
- 教学、配准实验和测量调节从主画面移到功能导航的 Settings 中，后续再调整功能接线。
- 现有未提交改动属于用户工作；基于刷新后的 `repomix-output.md` 修改，不回滚或直接重读源码验证。

### 布局推演
- 参考图宽度比例：功能栏约 3.5%，缩略图约 8.2%，主工作区合计约 71.4%，右侧约 28.6%。右侧两栏约 44% / 56%。
- 顶部品牌/时间栏约 6% 高度，主导航约 6.3%，信息栏与右侧标题约 5%；图像区优先占据剩余空间，日志约 17%。
- 使用 CSS Grid 与受限尺寸缩放，避免原型的右栏 `min-width:500px` 在常见窗口挤占画布。桌面最小窗口保持可用；小窗口允许局部滚动。
- 黑灰背景、蓝色 TEACH、黄绿色 Ready、粉色 Specification、浅粉 Image Analysis、黄/绿 ROI 树、三组参数表均采用参考图色彩。
- 深浅主题共用结构及语义色，保留现有主题持久化机制。截图上的浮层 FPS/码率不是应用 UI，不复刻。

### 实施拆分
- App：品牌、时间、五段导航、真实状态、功能导航、信息工具栏、日志、界面分区。
- CenterImage：保留真实图片和测量管线，将缩略图、地图、画布外观按参考图排列；将教学调节集中到设置入口。
- ParameterConfig / Settings：TEACH 使用并列 Specification 与 Image Analysis；参数配置、配准实验、数据采集、设备和数据库整理到 Settings。
- 不引入新框架、通用配置系统或未来抽象。原型已有线框 SVG 可沿用，不混入其他图标风格。

### 假设与风险
- 默认无模型时不伪造设备图像、检测结果或 KeepAlive；保留空画布和表格结构并提供选择模型入口。
- 各业务页保持挂载，切换导航不能丢失选择或进行中的操作。
- 截图在 2417×1258，下调至 1920×1080 / 1440×900 时必须兼顾文字可读性，无法每个分辨率均逐像素一致。
- 修改 CenterImage/ParameterConfig 时保留原有输入校验、错误处理、测量及配准接口；只搬动 UI。

### 验收
- `npm run check`、`npm run build`；以实际渲染检查暗色/亮色、导航切换、树选择、Light/RGB、模型入口、画布缩放及 Settings。
- 对新增交互做最小且有效的浏览器检查；不为纯 CSS 写镜像测试。
- 完成后运行 `repomix --style markdown` 刷新项目地图。

### 本次错误记录
| 错误 | 处置 |
|------|------|
| 初始地图未包含 ui-prototype 且部分前端已有未提交改动 | 实施前运行 repomix --style markdown，全部分析以新地图为准 |
| apply_patch 同一补丁 Delete+Add 同一路径返回 invalid patch: multiple operations target | 改用单次完整文件写入，不影响现有业务内容 |
| 首轮画布 --bg-stage 缺失导致回退为近黑背景 | 添加 --bg-stage: var(--machine-panel) 保持实机灰底及亮色模式 |
| 切换设置销毁案例组件/未完成参数草稿 | 改为保持挂载并隐藏，实验结果、输入草稿和校验状态保留 |
| 全幅设置遮挡后底层 ROI 仍响应 Delete | 添加 enabled/interactive 条件，仅 TEACH 可见时响应主画布快捷键 |
| 无图时工具外观可用但无动作 | 发布 hasImage/canMeasure 工具状态，禁用测量、ROI与缩放 |
| 浏览器测试 Teaching Parameters 同时匹配功能栏与分类页签，strict mode violation | 使用 Settings categories 导航范围限定 locator |
| 亮色下 root 颜色别名继承已解析暗色值 | 在亮色 body 上单独覆盖 --bg-stage |
| 覆盖页底下控件仍可被键盘/辅助技术访问，Align / ROI locator匹配两控件 | 隐藏底层工作区使用 inert，教学 sheet 作为独立可交互区域；测评 locator限定当前页 |
| 浏览器预览 get_storage_config 缺少 Tauri invoke（已有 DatabaseSettings 初始化路径） | 原生构建无此环境差异；缓存模型测试将文档写入隔离在内存，浏览器只验收 UI，不宣称验证设备/数据库连接 |

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
