# TODO

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
