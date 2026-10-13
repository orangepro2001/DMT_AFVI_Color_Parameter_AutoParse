# TODO

## 2026-10-14 Connector 单机台 / 单 Vision 切换

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图、设计与风险 | done | 确认左栏入口、全局选择、图像服务和 TOP/BTM 切换链路；更新 `plan/design.md` 与本表 |
| 2. Connector 入口与共享单选状态 | done | 左栏入口打开 Connector；单选机台 + FM1/FM2/BM 并持久化；模型选择限定到当前 Connector |
| 3. 页面与数据源统一 | done | 中心图像/测量/Align/光源依 Connector 路由；移除页面 TOP/BTM 与重复 Host 选择；异步请求作废并区分缓存 |
| 4. 验证与地图 | done | `npm run check` 0 errors / 20 existing warnings；前端 build、`cargo check`、`cargo test --lib`（89 passed / 1 ignored）及 release 构建通过；FM2 路由专测通过；repomix 地图已刷新 |

## 2026-10-14 Choose Model Names 弹窗实机对齐

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图、截图与设计 | done | 确认弹窗当前误把 Product/Model 当作 Tab；记录 595×395px 结构、列宽、按钮和颜色目标 |
| 2. 组件结构与样式 | done | 固定 `Product - Model` 文本，列表仅显示 PxRepository 名称并留空 Resolution，重排标题/说明/表头/列表/底部区域 |
| 3. 验证与地图 | done | `npm run check` 0 errors / 20 existing warnings，`npm run build` 通过，repomix 地图已刷新 |

## 2026-10-13 底部扳手设置面板精细还原

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图、截图与规划 | done | 确认扳手专用组件与七组/29字段；记录原始参考尺寸、间距、默认值及现有改动边界 |
| 2. 面板实现 | done | 七组默认全展开、工具/搜索栏、左对齐紧凑属性表、小三角、灰色 Off 开关、正确默认值、焦点返回/循环及关闭时 inert |
| 3. 验证与交付 | done | 类型检查 0 errors / 22 既有 warnings；前端与原生构建、浏览器入口/搜索/折叠/编辑/持久化/键盘/深浅主题及多尺寸核验通过；项目地图刷新，临时页面和服务已清理 |

下一步：用户打开新版 `tauri-app/src-tauri/target/release/AFVI_Parse.exe`，点击左侧底部扳手查看还原后的设置面板。


## 2026-10-13 亮块 GV 偏低排查

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 核对与复现 | done | 已复现缓存命中把 230-GV 亮块测成 40-GV 背景；本地 TIFF 5860×4020 / 预览4096×2810确认尺寸错配 |
| 2. 修正与回归 | done | MEDIAN 从本地 TIFF 头发布真实尺寸；19 项 MEDIAN 回归及 6 项通道/增益回归通过 |
| 3. 验收与地图 | done | 类型检查 0 errors / 22 既有 warnings；前端与原生构建通过（release 4m22s），项目地图刷新 |

下一步：用户重新打开构建产物并重画 GV 框；该实图 WH 应为5860×4020，蓝框显示 GV 推算约239～240。

TDD 进度：Red done（第二次加载 40≠230）；Green done（三种加载路径均为230）；Refactor done（仅 MEDIAN 元数据加载及回归）；Verify done（19+6项回归、类型检查、原生构建与地图）。

## 2026-10-13 可复用 ROI 工具条组件 + GV 测量集成

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 组件设计 | done | `RoiToolPalette.svelte`：竖排 rail（指针 / 添加矩形·椭圆·多边形 / 删除矩形·椭圆·多边形 / 删除 ROI），全部按钮按 `enabled` 启用，默认全禁用 |
| 2. 工具模型 | done | `lib/roi-tools.ts`：RoiPaletteTool / RoiDrawTool / 分组 / 映射；`service.ts` RoiRect 增加 `shape`/`points`（向后兼容） |
| 3. Overlay 能力 | done | `RoiOverlay` 用 `tool` 取代 drawMode：rect/ellipse 拖绘，polygon 点击+右键闭合，erase 点删 |
| 4. GV 集成 | done | `CenterImage` GV 模式显示 rail 并全启用；paletteTool↔overlay 映射；stage-api 暴露 tool/setTool |
| 5. 验收 | done | `npm run check` 0 error（22 既有 warning）；`npm run build` 通过；一次性 Vite 预览页目检两态后清理 |
| 6. 一键清空 + 不残留 | done | 垃圾桶右键一键清空（含抑制 WebView2 菜单）；GV 选框改为临时：模式结束/切 Tab 即清空，避免与教学/配准框混用同一 key；画布绘制态抑制浏览器右键菜单 |

- 已知限制：椭圆/多边形 GV 目前取包围盒（后端仅支持矩形）；三个删除按钮暂映射同一 erase 行为。
- 后续：按用户说明在其它位置挂载本组件，并给出各自启用/禁用清单。

## 2026-10-13 右栏按 Tab 切换（Review / Calibrate / Settings 实机布局）

中间区（图标栏、画布、缩略图、状态栏、日志）在所有 Tab 下保持不变，只切换右栏内容。

| 交付 | 说明 |
|------|------|
| REVIEW 页签启用 | AppTab 增加 `review`；新增 `ReviewDefect.svelte`：`● Inspection - Defect` + Image/Merge ID/CH/Code/Size/Avr 表头 + 空列表 + 底部预览区（实机 1:1，暂无数据源故列表为空） |
| CALIBRATE 1:1 | `CalibrationLight.svelte` 重构为右栏形态：顶部标定图框 + `ON` 药丸 + Host/Page Index 头 + `Calibration - Light` 20 通道表（Brightness 滑条/Value/Angle/Color/ON-OFF）+ 底部 Auto/Reload/Save；原 GV 亮度表收进底部折叠区保留功能 |
| SETTINGS 风琴 | 新增 `SettingsPanel.svelte`：`Model/Data Collection`、`Machine Configuration`、`Database`、`Image/Alignment`、`Teaching Parameters` 五个折叠分区，内容仍是我们原有组件 |
| Image/Alignment 桥接 | 新增 `lib/stage-api.svelte.ts` + `ImageAlignSettings.svelte`：把 CenterImage 的图像/配准教学控制（显示、色调、ROI/GV、Metal 配准、案例实验）以访问器对象暴露给右栏，不再整屏覆盖中间 |
| ParameterConfig | 新增 `fullscreen` 属性：`showSettings+fullscreen=false` 时为右栏内联编辑模式（原整屏 settings-mode 保留） |

- 验收：`npm run check` 0 error（24 warnings 均为既有 a11y 提示）；`npm run build` 通过；本地 1420 逐页目检 REVIEW/CALIBRATE/SETTINGS(五分区展开) 正常，stage-api 桥接滑条/按钮生效。

## 2026-10-12 实机 UI 重构

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图与设计 | done | 刷新地图、确认 Tauri/Svelte 与原型、记录比例/假设/风险 |
| 2. 壳层与画布 | done | 品牌栏、导航、工具栏、缩略图、画布、状态和日志 |
| 3. Specification / Analysis 与 Settings | done | 双栏参数面板、教学调节归档、现有功能入口 |
| 4. 构建与交互/视觉验收 | done | 类型检查0错误；生产构建通过；1440×900、1920×1080、1180×720无页面溢出；深浅主题与交互通过 |
| 5. 收尾 | done | 最终Rust可执行文件构建通过；缓存测试页已清理，深浅截图已保存，项目地图已刷新 |

下一步：按用户后续说明逐项调整机器控件与现有功能的对接。

### 本次验收记录
- `npm run check`：0 errors，22 warnings（既有 ParamTable、DataCollection、DatabaseSettings、MachineManagement、SearchSelect 无障碍提示）。
- `npm run build`：通过。最终 `npm run tauri build -- --no-bundle`：通过（2026-10-13，release耗时4m06s，既有Rust unused_assignments警告1条）。
- 浏览器使用本地 schemaVersion 2 模型快照及缓存 MEDIAN/Overlay 图片；写入全部隔离在内存，不修改本地模型文件。
- 1440×900：主画布607px高，右栏411.8px宽；1920×1080：主画布690.1px高，右栏549.1px宽；1180×720：无页面溢出。
- 参数输入 `-` → TEACH → Teaching Parameters：草稿仍为 `-`，aria-invalid=true，Save Local禁用；Escape恢复0.000。
- 主画布ROI拖绘 → Settings中Delete：框保留；返回TEACH按Delete：框删除。
- Light-2 / Green单选切换通过；功能导航打开后Escape关闭；缩放125%显示正确。
- Align / ROI实验seed改77 → TEACH → Image / Alignment：seed仍为77，组件状态保留。
- 暗/亮主题已保存两张1920×1080截图，原始图片内容不随主题更改。

## 阶段 1: 主题基础设施 — done
- [x] styles.css: 变量扩展（--bg-elev/--tint-*/--row-*），dark 默认 + light 调色板
- [x] lib/theme.ts: 双调色板 + 生成 <style> 注入 + localStorage 持久化
- [x] main.ts: 挂载前 applyTheme（防闪暗）

## 阶段 2: 组件配色变量化 — done
- [x] 两轮 PowerShell 脚本 (plan/themize.ps1, themize2.ps1) 批量映射 style 块
- [x] 手工修正: Settings color:white、ParameterConfig .host/.status-line/.legacy-warning/.reload-confirm、DataCollection/DatabaseSettings tint-info、ModelCopier .warning、行名 JS 色

## 阶段 3: 启动目检 + 交互优化 — done
- [x] 亮色逐页目检: TEACH/CALIBRATE/COPIER/SETTINGS 全部正常（浏览器 + 真实窗口）
- [x] WebView2 原地换肤不重呈现 → 切换 = 持久化 + reload；activeTab 跨重载持久化
- [x] "黑框"排查: 与 AFVI 应用无关（后端零外部进程调用），系机器后台工具控制台窗口

## 阶段 4: 收尾 — done
- [x] tauri build release（AFVI_Parse_0.1.0_x64-setup.exe / msi）
- [x] svelte-check 0 错误（30 警告均为既有 a11y 提示）
- [x] CDP 回归: dark→light→dark 三态计算样式全对，持久化正确

## 阶段 5: 黑框根因修复 + 删除 Model-Copy — done
- [x] credentials.rs: net.exe 加 CREATE_NO_WINDOW（黑框根因：GUI 进程 spawn net use 每次闪一个控制台，启动恢复选区加载 median 时连发十几个）
- [x] 后端: 删 preview_model_copy/copy_model_between_hosts/agent_ping/agent_scan_models/agent_copy_model/agent_copy_cross_site + 相关 import/注册
- [x] 前端: 删 COPIER 导航/页签/ModelCopier.svelte、service.ts 复制 API（CopyEndpoint/CopyPlan/CopyReport/AgentProgress/MachineAgent/endpointFor/testAgentConnection/copyModel*）、stores AppTab、MachineManagement agent 配置块
- [x] dmt-copy-core 保留（credentials/scan_hosts/find_model_dir 被 median/XML/align 加载复用）
- [x] cargo test 67 通过 / svelte-check 0 错误 / release 重建 / 冒烟: 启动+median 加载期间 conhost 零增长，导航无 COPIER

## 2026-10-13 教学光源独立叠加与 GV 联动

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 设计与地图 | done | 更新 design/TODO；刷新 repomix 地图；确认现有未提交 UI 不回滚 |
| 2. 共享光源状态 | done | stores 增加全局 ON、Host、Page、通道选择和三页独立通道值 |
| 3. Calibration 与工具栏 | done | 0..1024 输入校验；Page 灯泡独立开关；Red/Green/Blue/White 高亮；取消 Tab 限制 |
| 4. 中心图像与 GV | done | SVG RGB 混光；悬停/拖框 GV 使用合成增益；保留 ROI 交互边界 |
| 5. 验证与收尾 | done | npm check/build、cargo check/test、跨 Tab 手工验收、刷新 repomix |

### 验收场景
- OFF 显示原图且控件禁用，ON 显示叠加且控件可编辑。
- 0、1024、负数、超过 1024、非数字输入均不会污染共享状态。
- Page 1/2/3、Red/Green/Blue/White 和 GV 读数按设计独立联动。
- TEACH、REVIEW、CALIBRATE、SETTINGS 中可见的顶部工具栏均可点击。

### 本次验证
- `npm run check`：0 errors，22 existing warnings。
- `npm run build`：通过。
- `cargo check`：通过，保留既有 `template_point` unused assignment warning。
- `light-simulation` Node self-check：通过，覆盖 OFF、三色、White、范围和 GV 换算。

## 2026-10-13 RGB 通道灰度与彩色显示修正

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 需求与设计 | done | 参考实机截图和远程彩色视图；记录视图/White 区别及 GV 裁剪风险 |
| 2. 通道投影与工具栏 | done | Red/Green/Blue 灰度，第四按钮 RGB；显示状态独立于 White 光源 |
| 3. GV 联动 | done | 所选通道与 RGB 统计一致，直方图处理饱和，切换后立即重算 |
| 4. 回归与地图 | done | 6 个前端回归、3 个 Rust 测量测试、原生构建与界面验收；刷新地图 |

### 本次修正验收
- `npm run test:light`：6/6 通过，覆盖 R/G/B 灰度、RGB、White、Page 独立、OFF、SVG/读数一致以及饱和统计。
- `cargo test --lib gv_stats`：3/3 通过，验证 ROI 全图、越界裁剪与直方图分布。
- `npm run check`：0 errors、22 条既有 warnings；`npm run tauri build -- --no-bundle` 通过，生成 `tauri-app/src-tauri/target/release/AFVI_Parse.exe`。
- 隔离浏览器 fixture 的同一像素：Red `(200,200,200)` / Green `(150,150,150)` / Blue `(100,100,100)` / RGB `(200,150,100)`；悬停均值/标准差与显示一致。
- 同一拖框缓存切换 Red / Green / Blue / RGB：GV 均值分别为 227.50 / 202.50 / 150.00 / 203.99；对应标准差为 27.50 / 52.50 / 50.00 / 44.74。
- REVIEW / CALIBRATE / SETTINGS / TEACH 均可切换显示通道，OFF 禁用光源输入，Reload 恢复初值；临时 fixture 与测试服务器已清理。
- 新版原生程序加载 `25FBO015-15` 并验证 Red 灰度及 RGB 合成颜色，截图 `Plan/light-channel-rgb-verified.jpg`。本次额外打开的旧版窗口因自动审批拒绝关闭而保留；新版运行窗口不受影响。
