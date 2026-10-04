# DMT AFVI Color Parameter AutoParse

[English](README.md) | [简体中文](README_CN.md) | [한국어](README_KR.md)

面向 AFVI 检查机的离线工具链：从设备的三台主机（**FM1 / FM2 / BM**）采集检验规格
XML，在与实机软件布局一致的界面中浏览与编辑，导出检查技术参数表
（`검사기술파라미터`）Excel，并在 Vision PC 之间复制模型——同一站点内或跨站点均可。

全部在 Windows 本地运行。除非显式启用云数据库后端，规格文件不会离开设备网络。

## 仓库地图

| 路径 | 内容 |
|---|---|
| `tauri-app/` | **AFVI_Parse** — 桌面应用（Tauri 2 + Svelte 5 + Rust），当前的主产品。 |
| `dmt-agent/` | 每站点一个的局域网代理守护进程，加速模型扫描/复制（单 exe，以开机计划任务运行）。 |
| `dmt-copy-core/` | 共享 Rust crate：模型复制领域逻辑（计划 / 扫描 / 凭证 / 协议 / 中继），桌面端与 agent 共用同一实现。 |
| `index.html`、`src/`、`SpecParamTool.html` | 旧版单文件网页工具——项目起点，仍然可用。 |
| `reference/` | 样本 `PxInventory` 目录树（FM1 / FM2 / BM）与 `Parameter_Template.xlsx`。 |
| `Plan/`、`tools/` | 设计笔记；独立的 Python 光源分析辅助脚本。 |

---

# 桌面应用：AFVI_Parse

`tauri-app/` — 与真实设备共享直连的 Tauri 2 桌面应用。读取各 Vision PC
`PxInventory` 目录下的规格文件（`LightSpec.xml`、`InspectionSpec.xml`、
`SpecParameter.xml`、`SpecTreeNode.xml`），解析为本地模型快照，并按 **AFVI Inspect
实机软件**的布局复刻界面，作业者可在两套软件之间无缝切换。

技术底座：前端 **Svelte 5 runes**（无路由库，tab 面板常驻挂载）+ **TypeScript** +
**Vite**；后端 **Rust**（tokio、mongodb、reqwest、image）；Webview 内用
`fast-xml-parser` 解析 XML，复制逻辑以 Rust 共享。工具链锁定（Node 24、Rust 1.91，
由 `build_app.bat` 校验）。

## 主窗口

顶部导航：`HOME` / `TEACH` / `REVIEW` / `CALIBRATE` / `COPIER` / `SETTINGS`。
`HOME` 与 `REVIEW` 为占位；其余四个可用。窗口中央是**中心舞台**：模型信息、实时
MEDIAN 条带图、状态栏与日志面板；右侧面板承载当前 tab。切换 tab 时页面**常驻挂载**
（运行中的复制队列与 TEACH 选中状态不会丢失）。

### 中心舞台 — MEDIAN 条带图

* 选中设备 + 型号即从共享直接加载实时 MEDIAN 条带图——无需先采集：**TOP = FM1**
  （版本文件夹 `2.0`）、**BTM = BM**（版本 `3.5`），FM2 跳过。
* 版本文件夹回退：计划版本缺失时，任何包含相同相对路径的兄弟版本均可用；模型/文件
  缺失显示为 *missing*（回显搜索过的路径），共享根不可达才是错误。
* Gigapixel 级 TIFF 在 worker pool 解码（加互斥串行，避免两侧同时各持一份巨图），
  最长边缩到 4096 px 后以 JPEG 回传。
* 缩放 1×–10×：滚轮缩放（锚点感知）、Ctrl+点击放大/缩小、放大后拖拽平移、双击
  复位；TOP/BTM 切换；每侧 LRU 缓存 6 条。

### TEACH — 参数树（按实机复刻）

* 主机选择（FM1/TOP-1、FM2/TOP-2、BM/BOTTOM）+ 设备/型号显示；工具栏
  **Load XML / Save Local / Reload**。
* `Unit` / `Dummy` 组标签 + `Light-1 / 2 / 3` 标签，Global Align / SR Align 信息块，
  Overlay 复选框（MK / A_C / I_C / SK）。
* **彩色节点树**：节点名称与颜色来自 `SpecTreeNode.xml`，勾选状态来自 `NodeCheck`；
  Align / ROI 子树无复选框（与实机一致）；选中节点呈橙红色。
* 三张参数表：**Master**（`ControlType=1` 渲染为无文字蓝色开关）、**Submaster**
  （仅当门控的 Master 键——Chain Align / Chain Inspection——开启时显示）、**检查表**
  （Red/Green/Blue 标签切换 `ValR/ValG/ValB`，带 Min 列）。参数名经
  `SpecParameter.xml` 字典解析（多语言包合并、英文优先）；数字输入带校验（非法值
  标红、失焦恢复）。
* `Load XML` 可将单个 `InspectionSpec.xml` 载入当前 Host/Light 页，或载入
  `LightSpec.xml` 刷新整台主机。**编辑只作用于本地快照**（Save Local 持久化，
  Reload 带脏状态确认后重读）——设备上的生产 XML 永远不被写入。
* 旧版扁平格式快照（schemaVersion 1）会被检测并提示重新采集。

### CALIBRATE — 光源校准

* 20 通道灯光表（Value / Angle / Color / ON-OFF），来自所选 `LightSpec.xml` 页，
  Page 1/2/3 切换 + 全局 ON/OFF。
* **GV 밝기 输入区**：GV 亮度目标由人工测量、不存在于任何 XML。Page 1/2 显示
  `AU`、`OSP` 两行，Page 3 显示 `SR`、`Space`；每行 RED / GREEN / BLUE 三个输入格。
  值为自由文本（`180`、`60 : 50~70`、`X`…），按 主机 + Page 分键，输入后 500 ms
  防抖自动保存（失败显示红字）。

### COPIER — Vision PC 之间的模型复制

* 单对复制（源/目标各选 设备 + Vision PC）与**一键整机复制**（FM1→FM1、FM2→FM2、
  BM→BM 一个作业完成；要求两台不同设备）。
* **FM↔BM 隔离**：FM1/FM2 与 BM 永不互换模型；冲突时另一侧自动翻转并提示。
* 模型扫描选定源 PC → 可搜索选择器；可选 **Rename to**（克隆/重命名——文件夹名是
  模型唯一标识；需 agent 协议 ≥ v2）；跨站 **Force full transfer** 开关。
* **Preview Copy** 生成计划表（LIGHT_SPEC / INSPECT_SPEC / PxRepository 三类条目、
  源→目标路径、已存在的目标标"将被替换"），随后危险确认对话框要求**手动输入型号名**
  才会删除/复制任何文件。
* 顺序作业队列（一次一个作业，可排队/移除/清除），逐作业进度（文件数、字节数、
  当前文件、中继档位标签）；跨站作业失败自动增量重试一次，再失败回落直连 SMB
  （慢速路径）。

### SETTINGS — 设备、采集、数据库、导出

* **Machine Configuration**：按主 PC IP 注册设备，三台 Vision PC 的
  `PxInventory`/`PxRepository` UNC 路径自动派生（扁平网络规则：FM1 = IP+1、
  FM2 = +2、BM = +3；手改字段不再覆盖）。可选**网络凭证**（用户名/密码）——扫描/
  采集前 Rust 端对每台服务器执行 `net use …\IPC$` 登录（支持空密码账户；错误 1219
  先删旧连接再重试）。可选**站点局域网 Agent**（地址自动建议 `<main_ip>:3777` +
  token），每台设备带 **Test agent** 按钮。保存于 `machines.json`。
* **Data Collection**：选设备 + 型号（型号选择器扫描三台主机、支持过滤）后
  **Collect & Save**。每台主机采集：`LIGHT_SPEC/<model>/LightSpec.xml`、
  `INSPECT_SPEC/<model>/{TOP|BOTTOM}/LIGHT0..2/InspectionSpec.xml`，以及可选的
  `SpecParameter.xml` / `SpecTreeNode.xml`；三台主机并行采集且必须全部成功。已有
  快照时立即加载并应用到 TEACH/CALIBRATE，按钮降级为 *Re-collect (optional)* 并出现
  *Open TEACH* 直达。选中型号同时向中心舞台发布图像目标。
* **Database**：后端在 `local`（JSON 文件，默认）、`mongodb`（兼容 Atlas）、
  `firestore`（Firebase）之间切换——连接信息就地编辑、**Test Connection**、
  **Migrate Local Data → …**（幂等 upsert + 迁移报告）与 **Save & Apply**。配置存于
  app-data 的 `storage.json`。远端读取失败时自动回退本地 JSON 备份，网络抖动不会
  白屏。Firestore 超 1 MiB 的文档自动分片（700 KB 分块、读取透明拼装）。所有存储
  命令均为 async + `spawn_blocking`——UI 永不因数据库卡顿冻结。
* **Export Parameter Excel（검사기술파라미터）**：导出路径与模板工作簿路径配置一次
  （存于 `ui/export-config.json`；未配置时导出明确报错提示）。

## 数据模型与本地文件

采集完成的模型成为**快照**（`StoredModelRecord`，schemaVersion 2）：`machine /
modelName / collectedAt` 加 `hosts {FM1, FM2, BM}` 映射，每主机含根路径、side、解析
后的 `lightSpec`、对齐信息、`ParamKey → 名称` 参数字典、GP/P/C 节点树字典，以及完整
的 `GPNODE → PNODE → CNODE` 检查树（叶节点分 MASTER / SUBMASTER / INSPECTION，
含 `Val/ValR/ValG/ValB/Min`）。

本地数据库布局（Tauri app-data 目录；local 后端就是这个目录本身）：

```
storage.json                       存储后端配置
machines.json                      设备列表（含可选凭证 + agent 配置）
models/<machineId>/<model>.json    模型快照（schemaVersion 2）
ui/active-selection.json           当前选中的设备/型号
ui/teach-selection.json            TEACH 页选中路径
ui/gv/<machineId>/<model>.json     人工测量的 GV 值
ui/export-config.json              Excel 导出路径 / 模板路径
```

前后端各留**唯一的存储接缝**——`DocumentStoreClient`（TS，`src/lib/document-store.ts`）
与 `DocumentStore` trait（Rust，`storage.rs`）——新增后端不触碰任何功能代码与 UI。

## Excel 导出（검사기술파라미터）

`export_parameter_excel` 只改写模板 worksheet XML 中的**数值单元格**——样式、合并
单元格、打印设置与其余 sheet 逐字节保留，因为产出文件由上传服务器自动解析。输出：
`<设备名>_<型号>.xlsx`（如 `AFVI14_6ST2001Q01.xlsx`）。

填充规则（设备知识，与旧工具 `LIGHT_AREA_RULES` 一致）：

* 工作簿命名（2026-09 起 FM1/FM2 分开管理）：`Top1-Light2/3`（FM1）、
  `Top2-Light2/3`（FM2）、`Bottom-Light2/3`（BM）、`DMG 조명 1번`；旧韩文命名
  （`Top 조명 2번`…）仍兼容（FM1 优先）。
* **GV 页码对齐**：每张 조명 表读自己光源页的 GV（light N → Calibrate 第 N 页），
  修复了此前 Light2 错读第 1 页的缺陷。
* `DMG 조명 1번`（LIGHT0）：无 INSPECTION 参数——只填 GV（Top-RED / Bottom-RED）
  与由 LightSpec 通道算出的**白光轴比值**（启用通道按角度分组、同角度取峰值、按
  GCD 约分，如 `White 0 : 30 = 3 : 1`）。
* `Light2`（LIGHT1）：只填 AU（PNODE 2）与 OSP（PNODE 3）区域块，Laser Marking 块
  按规则清空；`Light3`（LIGHT2）：只填 NonMetal（PNODE 5）区域块。
* `조명 축` 行自动填轴比值；B/D/F 列填同色光（该色缺失时 B 列回退 White）；禁用
  通道不参与。
* **节点树补全**：数据中存在而模板缺失的 영역 块追加到表尾（克隆该 sheet 首块样式、
  值按 ParamKey 匹配）；超出族的参数追加为末尾行。
* 标签匹配经别名表 + 字典双向解析，容忍模板拼写变体（Offest/Offset、
  (Size)/(Pixel)…）。
* 导出返回报告：filled / blanked / GV / axis 单元格数、追加的区块与未解析标签；
  GV/路径保存失败会显式提示而不是静默吞掉（写 Firestore 失败时数据落地本地文件，
  下次迁移补推，绝不丢失录入）。

## 站点局域网 Agent（模型复制/扫描加速）

桌面端在站点局域网之外、仅经 Tailscale subnet 路由可达时，SMB 的高往返延迟会让
模型复制与扫描极慢。按站点部署一台 **`dmt-agent`**（站点主 PC）：桌面端把控制请求
经 Tailscale 发给 agent，agent 在站点真实局域网内以千兆速度执行扫描与机器间直拷——
**数据流不出站点**——并实时回传逐文件进度到 Model Copier 进度条。

* 领域逻辑（复制计划、删除防护、扫描、`net use` 凭证、线协议）都在共享 crate
  `dmt-copy-core` 中；agent 与桌面端直连 SMB 回退路径共用同一实现。
* 线协议：TCP + NDJSON，端口 **3777**，首帧必须用共享 token 认证（常数时间比较）。
  协议 **v3**——v2 增加改名复制，v3 增加跨站中继；桌面端拒绝向旧 agent 发送其不
  支持的新特性。
* 操作：`ping`（Test agent 按钮）、`scan_models`、`copy`（同站）、`copy_cross_site`
  （源站 agent 推给目标站 agent）、`tcp_relay_push`（UDP 被拦时的 TCP 数据面）。
* **通道自动选择**：两台设备配置**相同** agent 地址 → 同站 agent；地址**不同** →
  跨站 QUIC 中继（自动增量重试一次，再回落直连 SMB）；任一侧未配置 → 直连 SMB，
  行为与过去完全一致。
* 跨站传输：QUIC（quinn/rustls，UDP 3777，单连接 6 流、逐文件 zstd、按 size+mtime
  增量跳过、暂存目录 2 小时清扫）→ TCP 数据面 → 桌面端直连 SMB。same-address
  防护可发现两站点 LAN 规划撞车并提示改用 Tailscale IP。
* 安装：`build_app.bat agent <token>` 产出 `dmt-agent.exe`、`agent.json`、
  `install_service.bat` / `uninstall_service.bat`（`schtasks` 注册开机 SYSTEM 计划
  任务）。SYSTEM 会话没有用户凭证——设备配置**必须**填写网络用户名/密码，agent 才能
  `net use` 登录共享。日志写 exe 同目录 `agent.log`（5 MB 轮转）。详见
  `dmt-agent/README.md`。

## 构建与测试

```bash
cd tauri-app
npm install
npm run dev             # vite 开发服务器（端口 1420，与 tauri.conf.json devUrl 一致）
npm run check           # svelte-check 类型检查
npm run tauri dev       # 桌面应用开发模式
cargo test              # 在 src-tauri/ 内：存储 / 导出 / MEDIAN 单元测试
```

仓库根目录：

```bash
build_app.bat           # 一键打包（npm ci + tauri build → exe + MSI + NSIS）
build_app.bat agent <token>   # 构建 dmt-agent + agent.json + 安装脚本
build_app.bat check     # 前端构建 + 三个 crate 的 cargo check
```

* `cargo test` 完全可离线运行：MEDIAN 路径解析（8 个）、存储后端含 Firestore 分片
  （5 个）、Excel 导出规则（3 个），以及 copy-core / agent 全套（计划/改名/删除防护、
  协议、中继增量、凭证错误码、agent 端到端）。真实模板 / 真实 Atlas / Firestore
  集成测试由输入或环境变量门控（`export_real`、`MIGRATE_REAL=1`、`FIRESTORE_E2E=1`）。
* 前端无自动化 UI 测试——以 `npm run check` 为门；旧版网页工具的回归测试在根目录
  `tests/`。

## 已知限制（桌面版）

* `HOME` 与 `REVIEW` 为占位页。
* TEACH 编辑（`NodeCheck`、载入的 XML）与 GV 值只存在于本地快照——不回写设备上的
  生产 XML（设计如此）。
* Global Align / SR Align 的光源与通道来自固定规则（全光源 + 最后一光源、Red 通道）；
  是否应采集 `AlignSpec.xml` 待定。
* 网络凭证明文存于 `machines.json`（机器本地文件）；Atlas 连接串只存于本机
  `storage.json`——均不入仓库。Firestore 项目/API Key 是 `storage.rs` 中的编译期
  常量，访问控制依赖 Firestore 安全规则。
* 前端暂无自动化组件测试。

---

# 旧版网页工具：SpecParamTool.html

项目起点是一个零依赖的单文件浏览器工具：读取 `LightSpec.xml` + `INSPECT_SPEC`
文件夹中的 `InspectionSpec.xml`（可选 `SpecParameter.xml` / `SpecTreeNode.xml` 与
`Parameter_Template.xlsx`），生成**检查技术参数表**、分析列表与两份 Excel 工作簿——
打开 `SpecParamTool.html`、拖入文件、按 *Parse Specs* 即可。它仍然可用，由
`python build.py` 从 `src/01…08-*.js` 重新生成。

* 标签页：Summary、模板版式的参数表（`채널 / 조명 축 / GV 밝기 / 영역 / 검출 불량 /
  파라미터`）、逐光源通道列表（按 LED 颜色分组）、InspectionSpec 转录表、LightSpec
  原始 + 分组列表、多文件 Comparison（按 节点 × ParamKey × 通道 给 `Same`/`Diff`）
  与内置字典（82 个 ParamKey + 节点树，可拖入 XML 覆盖）。
* 导出：`<Model>_<SIDE>_LIGHT<n>_LightSpec.xlsx`（模板逐单元格填充）、
  `..._InspectSpec.xlsx`（列表 + 对比）、可选参考工作簿、任意标签页 CSV。
* **光源 → 参数区域规则**（设备知识，已沿用至桌面导出器）：Light 1 = `LIGHT0` =
  AI 模型检查 → 无参数；Light 2 = `LIGHT1` → 仅金属（`PNODE 2` AU + `PNODE 3`
  OSP）；Light 3 = `LIGHT2` → 仅 SR/非金属（`PNODE 5` NonMetal）。
* 通道编号：`LightSpec` 存 0 起始的 `@Index`，工具按设备 UI 的 1 起始编号显示
  （`CH1` = `@Index 0`）。
* 测试：`tests/run-model-tests.js`（解析 → 视图 → xlsx）、`validate_export.py`
  （openpyxl 复读）、`run-browser-tests.js`（headless Chrome）。

深入文档：[`TOOL_ARCHITECTURE.md`](TOOL_ARCHITECTURE.md) ·
[`SPEC_REFERENCE.md`](SPEC_REFERENCE.md) ·
[`PARAMETER_TEMPLATE_NOTES.md`](PARAMETER_TEMPLATE_NOTES.md) ·
[`tests/README.md`](tests/README.md)。

---

## 文档索引

| 文件 | 内容 |
|---|---|
| [`tauri-app/README.md`](tauri-app/README.md) | 桌面应用详解：界面、数据模型、存储后端、Excel 规则（中文） |
| [`dmt-agent/README.md`](dmt-agent/README.md) | Agent 部署、协议、跨站中继、日志（中文） |
| [`Plan/`](Plan/) | 设计笔记（DOE 采样、RSM 拟合、光源分析 UI、Svelte 5 迁移） |
| [`TOOL_ARCHITECTURE.md`](TOOL_ARCHITECTURE.md) | 网页工具模块地图与流水线 |
| [`SPEC_REFERENCE.md`](SPEC_REFERENCE.md) | 规格文件用途、完整键值字典、XML schema |
| [`PARAMETER_TEMPLATE_NOTES.md`](PARAMETER_TEMPLATE_NOTES.md) | `Parameter_Template.xlsx` 版式与待定点 |
| [`tests/README.md`](tests/README.md) | 网页工具回归测试说明 |
