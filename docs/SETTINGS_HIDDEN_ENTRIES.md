# SETTINGS 与扳手教学面板入口

顶部 SETTINGS 展示应用功能设置；左侧扳手打开独立的实机配置教学面板，两者保持独立。

## 应用入口

| 名称 | 组件 | 内容 | 入口 |
|---|---|---|---|
| 型号选择 | DataCollection.svelte | 选择机台、型号；实时加载 XML；Open TEACH；Clear | SETTINGS、左栏搜索、功能导航 |
| Machine Configuration | MachineManagement.svelte | 用户机台名称、主 IP、FM1/FM2/BM Inventory 与 Repository 路径、可选 UNC 凭据；reference 只读 | SETTINGS、用户图标 |
| Image / Alignment | ImageAlignSettings.svelte | MEDIAN / Pattern、显示调整、ROI、GV、Metal 对齐、合成案例与步骤 | SETTINGS |
| Teaching Parameters | ParameterConfig.svelte | 参数与 NodeCheck 会话编辑、Load XML、Reload；Reload 前确认丢弃会话修改 | SETTINGS、堆叠与软盘图标 |
| Calibration - Light | CalibrationLight.svelte | Light 页、RGB、20 通道、光源模拟与 GV 实测值 | CALIBRATE |

## 扳手面板

MachineSettingsOverlay.svelte 保留 Language、Backup、3DResult、Strip saving、Data Format、Miscellaneous，用于学习实机字段。可搜索、按字母排序或折叠分区。值保存在 localStorage 的 afvi-machine-settings，不产生设备控制或文件传输。

## 文件

- src/app/components/MachineSettingsOverlay.svelte：滑出面板。
- src/app/components/SettingsPanel.svelte：顶部 SETTINGS 常驻折叠分区。
- src/app/App.svelte：导航、左栏和面板接线。

调整入口应复用现有组件，保持当前 TEACH / 图像舞台与会话修改，不新增顶级标签。
