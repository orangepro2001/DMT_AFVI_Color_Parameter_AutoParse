# SETTINGS 面板 · 暂时隐藏入口清单

> 用途：记录从「扳手滑出面板」中移除、暂时隐藏的设置入口，**按名字取用**。
> 当前阶段目标是 **1:1 精细还原实机设置设计图**，面板里只放实机配置项；
> 以后你说「把 X 调出来放到 Y 下面」，我照此表按名还原即可。

## 一、约定（两个 SETTINGS 是两回事）

| 入口 | 实体 | 现状 |
|------|------|------|
| 左侧导轨**底部扳手图标** | `components/MachineSettingsOverlay.svelte` | 右侧滑出、覆盖工作区；**实机设置复刻专用** |
| 顶部导航 **SETTINGS 标签** | `components/SettingsPanel.svelte` | 另有他用（用户预留），本轮未动 |

- 滑出面板**不再**包含任何自有配置入口（原先右下角的 `More…` 跳转已删除）。
- 自有配置的组件都还在、都还能编译，只是不再挂在这个面板里。

## 二、当前保留在滑出面板内的实机分区（勿动）

| # | 分区名 | 字段 |
|---|--------|------|
| 1 | Language | Code（下拉：English/Korean/Chinese/Japanese） |
| 2 | Export | IP Adress、Directory |
| 3 | Backup | IP Adress、Directory |
| 4 | 3DResult | 3D Enable（开关）、IP Adress、Directory |
| 5 | Strip saving | Enable（开关）、Scale、Light（Light1–3）、Color Channel |
| 6 | Data Format | Tavis Format、Json Format、TW Format（三个开关） |
| 7 | Miscellaneous | Max Log Count (Auto Save)、Max Defect Count、Defect Image Size、Align Search Offset、Align Minimum Score、SubPixelSize、SubPixelInterval、Align Method、Align Model Scale、Unit Align、Autofocus Light、Defect Image Format、Keep Folder Count、Camera Userset |

值可编辑，持久化在 `localStorage['afvi-machine-settings']`，**无后端效果**。

## 三、暂时隐藏的入口（随时可调回）

| # | 名称（EN） | 中文 | 来源组件 | 内容细目 | 现在还能从哪进 |
|---|-----------|------|----------|----------|----------------|
| H1 | Calibration - Light | 光源标定 | `CalibrationLight.svelte` | Power ON/OFF；预览缩略图；通道 1–20 亮度滑条（0–1024）。*组件完整版另有：* Host FM1/FM2/BM、Page Index 1/2/3、Channel/Brightness/Value/Angle/Color/ON-OFF 表、Auto / Reload / Save、GV 亮度值表（AU·OSP·SR·Space × Red·Green·Blue） | 顶部导航 **CALIBRATE** 标签 |
| H2 | Model / Data Collection | 选择采集型号 | `DataCollection.svelte` | AFVI Device 下拉、Model Name 输入 + Choose Model、Re-collect / Open TEACH / Clear、状态条；Export Parameter Excel：Export Path、Template Workbook、Export Parameter Excel 按钮 | 顶部导航 **SETTINGS** 页 + 左栏「分享/立方体/放大镜」按钮 + 功能导航 |
| H3 | Machine Configuration | 机台与共享路径 | `MachineManagement.svelte` | 机台列表（名称 / 主 IP / FM1·FM2·BM 的 PxInventory·PxRepository / 网络用户）；注册表单：Name、Main PC IP、三组 PxInventory+PxRepository、Network Username、Network Password、Register Machine / Save Changes / Cancel | 顶部导航 **SETTINGS** 页 + 左栏「人像」按钮 + 标题栏「人像」图标 |
| H4 | Database | 存储后端 | `DatabaseSettings.svelte` | In use 徽标；Backend 下拉（Local JSON / MongoDB / Firestore）；MongoDB：Connection String、Database Name；Firestore：Project / API Key / Collection（只读）；Test Connection、Migrate Local Data、Save & Apply | 顶部导航 **SETTINGS** 页 |
| H5 | Image / Alignment | 图像显示与配准教学 | `ImageAlignSettings.svelte` | 图像显示：扫描面 TOP/FM1·BTM/BM、图像来源 MEDIAN·Align/ROI、刷新图像、图像路径信息；教学显示调整：光源 GV、对比度、重置显示；ROI 与灰度测量：ROI 画框 / 测量 GV / 删除选中 / 清空 ROI；Metal 配准教学：错位叠加、生成新偏移、用 ROI 对齐、显示正确答案；合成案例与配准步骤 | 顶部导航 **SETTINGS** 页 + 功能导航「SETTINGS 教学与图像参数」 |
| H6 | Teaching Parameters | 检测参数编辑 | `ParameterConfig.svelte` | 两栏参数编辑：Unit / Dummy / Light-1·2·3、Global Align、SR Align、Overlay（MK·A_C·I_C·SK）、Master / Submaster 参数表、Red/Green/Blue 值编辑 | 顶部导航 **SETTINGS** 页 + 左栏「堆叠/软盘」按钮 |

### 按需调回（例子）

- 「把 **Machine Configuration** 放回滑出面板，排在 3DResult 后面」
- 「**Database** 这节先不要，换成 **Image / Alignment**」
- 「**Calibration - Light** 的 20 通道滑条要放回 Miscellaneous 下面」

→ 照说即可，我从本节按编号 H1–H6 取组件接回去，不需要重写。

## 四、已删除的入口

| 名称 | 位置 | 删除日期 | 说明 |
|------|------|----------|------|
| `More…` | 滑出面板右下角 | 2026-10-13 | 原为跳转到顶部导航 SETTINGS 页的按钮；按「入口都可以删」移除 |

## 五、相关文件

- `tauri-app/src/app/components/MachineSettingsOverlay.svelte` —— 滑出面板本体
- `tauri-app/src/app/components/SettingsPanel.svelte` —— 顶部导航 SETTINGS 页（预留）
- `tauri-app/src/app/App.svelte` —— 扳手按钮接线：`machineSettingsOpen` → `MachineSettingsOverlay`
