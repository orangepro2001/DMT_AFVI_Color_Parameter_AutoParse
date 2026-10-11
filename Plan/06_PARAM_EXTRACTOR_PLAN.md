# 独立参数提取工具（Param Extractor）— model XML → 标准化 Excel 开发文档

> **文档定位**：把主应用（AFVI_Parse）中"读取 model XML → 整理成标准化 Excel"这条链路
> **抽离为独立项目**，形态为 **CLI + GUI 混合的单 Rust 程序**。本文件是唯一权威设计文档，
> 包含技术栈、架构、模块设计、UI 原则、踩坑清单与里程碑。
> 抽离动机：主应用功能过度臃肿，参数提取只用到其中很小一部分能力，却要背负整个应用。
> 与主应用的关系：**只读借鉴 + 资产移植，不共享进程、不共享存储**；`machines.json` 与
> `Parameter_Template.xlsx` 格式保持互通（D5/D7）。
> 日常使用定位：**平常黑盒**——配置好机器后选个模型、填个 GV 就出成品文件；
> 但每一步产出对用户可见可确认，不做全黑盒（用户明确否决全黑盒方案）。

| 文件 / 资产 | 角色 | 状态 |
|---|---|---|
| `Plan/06_PARAM_EXTRACTOR_PLAN.md`（本文件） | 开发文档：技术栈 / 架构 / UI / 踩坑 / 里程碑 | 待评审 |
| 主应用 `tauri-app/src-tauri/src/export_excel.rs` | 模板填空导出的实现母本 | 已上线（移植对象） |
| 主应用 `tauri-app/src/lib/service.ts` 解析段 | XML→参数结构化的实现母本（Rust 重写参照） | 已上线（重写对象） |
| `reference/Parameter_Template.xlsx` | 成品模板（141KB，布局见 `PARAMETER_TEMPLATE_NOTES.md`） | 已上线（分发物） |
| `reference/<FM1|FM2|BM>/PxInventory/` | 三站点完整样本仓，测试 fixture | 已就位 |
| `dmt-copy-core` | 模型名规范化 / 目录定位 / 多主机扫描 | 已上线（复用） |
| `tauri-app/src-tauri/tests/validate_export.py` | 导出结果校验脚本 | 已上线（移植） |

---

## 目录

1. [目标（一句话）](#1-目标一句话)
2. [现状盘点与资产处置](#2-现状盘点与资产处置)
3. [范围](#3-范围)
4. [关键决策](#4-关键决策)
5. [技术栈说明](#5-技术栈说明)
6. [总体架构](#6-总体架构)
7. [核心用户流程](#7-核心用户流程)
8. [模块详细设计](#8-模块详细设计)
9. [UI 设计原则](#9-ui-设计原则重点)
10. [CLI 契约](#10-cli-契约)
11. [踩坑清单](#11-踩坑清单经验向文档核心价值)
12. [测试策略](#12-测试策略)
13. [里程碑](#13-里程碑)
14. [待确认问题](#14-待确认问题)

---

## 1. 目标（一句话）

一个**独立、轻量、单二进制**的工具：配置一次机器 → 选一个模型 → 自动读齐 FM1/FM2/BM
三台主机的 Top/Bottom 全部光照参数 → 用户只补 Light2/Light3 的 GV 并扫一眼确认 →
按内置模板**一键产出成品 Excel**；同一套内核暴露 CLI 子命令供脚本化批量出文件。

**成功标准**：现场工程师从"双击打开"到"拿到成品 xlsx"全程 ≤ 3 次点击 + 一次 GV 录入；
不理解的中间状态一个都不暴露，但每个想看的人都能展开看到。

## 2. 现状盘点与资产处置

主应用里这条链路的现状：**Rust 收集原始 XML → 前端 TS（fast-xml-parser）解析成
`StoredModelRecord` → 存 JSON → Rust `export_excel.rs` 按模板填空导出**。
功能是全的，但分散在 DataCollection / ParameterConfig / CalibrationLight / ParamTable
四个组件和 3000+ 行 service.ts 里，与复制队列、对位、数据库等强耦合。

| 资产 | 位置 | 处置 | 说明 |
|---|---|---|---|
| 模型名规范化 `canonical_model_name` / 目录定位 `find_model_dir` | `dmt-copy-core/src/lib.rs` | **复用** | 零依赖 crate，直接依赖即可 |
| 多主机并行扫描 `scan_hosts` / UNC 凭据 | `dmt-copy-core/src/scan.rs` | **复用** | 含 net use 凭据处理 |
| 原始 XML 收集 `collect_host_sources` / 精确名读文件 `read_named_file` | `tauri-app/src-tauri/src/lib.rs:58-120` | **移植（Rust→Rust）** | 逻辑照搬，去掉 Tauri command 壳 |
| 模板填空 xlsx 层（`Workbook::read_workbook` / `parse_sheet` / `patch_cell` / `append_blocks` / `write_workbook`，手写 zip 解包打包） | `export_excel.rs:419-970` | **移植** | 60KB 模块整体搬运后裁剪，零第三方 xlsx 依赖 |
| 导出领域规则（`light_area_parents` / `light_axis_texts` / `LabelIndex`+`LABEL_ALIASES` / sheet 名匹配 `match_template_sheet` / 输出名 `export_file_name`） | `export_excel.rs:205-810` | **移植** | 设备知识规则，一字不改 |
| XML→参数结构解析（stringpack 多语言字典、三级节点字典、GPNODE→PNODE→CNODE→参数树、LightSpec 通道） | `service.ts:949-1047` + fast-xml-parser 配置 `service.ts:466-479` | **Rust 重写** | 本项目最大的开发量；用 serde 强类型解析替代 JS 动态对象，golden test 对齐现网输出（D2） |
| GV 手输（`GvValueSet {Red,Green,Blue}`、`host→page→行标签→GV` 键结构） | `CalibrationLight.svelte` / `export_excel.rs:141-152` | **重写 UI + 复用格式** | 键格式保持一致，主应用录过的 GV 可直接迁移 |
| `machines.json` 机器配置格式 | `service.ts:477-496` / `MachineManagement.svelte` | **复用格式** | 可直接导入主应用已配置的机器（D5） |
| MongoDB / Firestore 存储后端 | `storage.rs` | **不带** | 本地 JSON 文件足够 |
| 模型复制 / agent 编排 / FTS / Align / TEACH / MEDIAN 预览 | 各处 | **不带** | 与本工具无关，是主应用臃肿的来源 |
| agent 协议（TCP 3777 / NDJSON） | `dmt-copy-core/src/protocol.rs` | **暂不带** | 独立工具直连 SMB；跨站点需求出现后再挂 agent（Q4） |

## 3. 范围

**In scope**

- 机器配置管理（沿用主应用格式，含自动派生）。
- 三主机并行采集：`LightSpec.xml` + `LIGHT0/1/2/InspectionSpec.xml` ×(TOP/BOTTOM) +
  `SpecParameter.xml` + `SpecTreeNode.xml`。
- Rust 解析层：上述 XML → 强类型 `ModelRecord`（与现网 TS 输出语义对齐）。
- GV 采集：仅 Light2 / Light3（Light1 = LIGHT0 无 INSPECTION 参数，本来就没有 GV 可填）。
- 模板填空导出 + 输出报告（每个 sheet 填了哪些格、哪些标签没解析上）。
- GUI 三步向导 + CLI 子命令。
- 模板覆盖接口：模板路径可配置，加载时结构校验。

**Out of scope（另行决策）**

- 写回任何生产数据（只读采集 + 本地出文件，零副作用）。
- 跨站点 agent 编排、FTS 数据面。
- 修改模板布局的工具（模板本身仍手工维护，`PARAMETER_TEMPLATE_NOTES.md` 是它的规格）。
- 主应用重构 / 删除主应用里的旧功能（旧链路继续存在，等本工具验收后再决定退役）。

## 4. 关键决策

### 已定

| # | 决策 | 说明 |
|---|---|---|
| D1 | **独立新项目，单 Rust binary**（workspace：`core` crate + 同一二进制的 GUI/CLI 双入口）。不复用主应用进程，不共享 app_data 目录 | 抽离的全部意义；单二进制 = 拷贝即部署，产线/办公 PC 零安装 |
| D2 | **XML 解析全部下沉 Rust 重写**（用户拍板）。语义基准 = 主应用现网 TS 管线的输出 JSON；用 **golden test** 锁死对齐：拿 `reference/` 样本仓分别跑 TS 管线与 Rust 解析，diff 结构化输出 | serde 强类型替代 JS 动态对象，`isArray` 塌陷之类的坑在编译期消失；解析结果不再跨 IPC 传原始 XML |
| D3 | **xlsx 模板填空层从 `export_excel.rs` 整体移植**，不引入 calamine / rust_xlsxwriter | 该手写层已验证可增量改单元格、追加 area block、保住模板其余部分字节不动（上传服务端按布局解析）；模板填空场景下第三方库反而要先"读懂再重写"整个工作簿，风险更高 |
| D4 | **GUI 用 eframe/egui（默认方案，Q1 拍板）**：与 core 同进程同语言，单二进制，无 WebView2 运行时依赖；Tauri 2 作为备选（团队熟悉、UI 更精致，代价是双进程 + WebView 分发 + 前端解析诱惑） | 本工具 UI 是"表单 + 表格 + 进度"，没有富媒体，egui 的原生控件完全够；部署简单性在产线环境权重最高 |
| D5 | **机器配置沿用 `machines.json` 字段格式**（`id/name/main_ip/fm1_path/.../username/password/agent?`），提供"从主应用导入"按钮 | 配置一次、两端通用；主 IP +1/+2/+3 派生规则原样保留（扁平网络约定） |
| D6 | **GV 只采 Light2/Light3**，存储键格式与主应用 `ui/gv/<machineId>/<MODEL>.json` 一致（`host → pageIndex(0-based) → 行标签 → {Red,Green,Blue}`） | Light1(LIGHT0) 是 AI 光源，无 INSPECTION 参数；同模型第二次导出时 GV 自动预填上次值 |
| D7 | **模板覆盖接口 = 模板路径可配置 + 加载时结构校验 fail-fast**：校验必需 sheet 名（`Top1-Light2/3`、`Top2-Light2/3`、`Bottom-Light2/3`、`DMG 조명 1번`，韩文旧名兼容）、必需列头、GV 格锚点；校验不过直接拒绝导出并列出缺失项。内置模板随程序分发于 exe 旁 `templates/Parameter_Template.xlsx`，路径可在设置里指向任意替换版 | "模板基本上不会变，留个覆盖接口以防万一"——平时零感知，换模板时立刻知道新模板缺什么，而不是导出一个半成品 |
| D8 | **成品文件不静默覆盖**：目标名 `<machine>_<model>.xlsx`（沿用 `export_file_name` 约定），已存在时默认追加时间戳后缀，GUI 里可勾选"覆盖" | 出错覆盖一份现场成品是不可逆的 |
| D9 | **采集永远并行三主机**（`std::thread::scope` 模式，照抄 `collect_machine_sources`），单主机失败不拖死整体：报告按主机标注 OK/失败原因，用户可选择带缺失继续或中止 | 某台 Vision PC 关机是常态，不能让 BM 掉线导致 Top1/Top2 白读 |

### 待确认（不阻塞 M0/M1）

| # | 问题 | 默认取值 | 拍板时点 |
|---|---|---|---|
| Q1 | GUI 框架最终拍板：eframe/egui vs Tauri 2 | eframe（D4 理由） | M0 结束前（M0 用 egui 起 GUI 骨架即为试金石） |
| Q2 | 内置模板的更新方式：随安装包分发 vs 从主应用安装目录读取 vs 网络盘统一存放 | exe 旁 `templates/`，设置页可改路径 | M2 前 |
| Q3 | GV 录入是否需要"从相似模型复制"功能 | M3 先做"上次值预填"，复制功能看反馈 | M3 |
| Q4 | 跨站点（agent）采集是否进入本工具范围 | 暂不进；CLI/GUI 的采集层留 `trait Collector` 接缝，将来挂 agent 实现即可 | 出现真实跨站需求时 |

## 5. 技术栈说明

**原则：每个依赖都要回答"手写/移植为什么不行"。** 本项目是工具不是平台，依赖面越小，
产线机部署、离线构建、长期维护越省心。

| 层 | 选择 | 理由 / 排除项 |
|---|---|---|
| 语言 / 构建 | Rust（stable），cargo workspace，`rust-lld` + sccache 加速（沿用主应用验证过的配置） | 与移植来源同语言，资产搬运零翻译成本 |
| XML 解析 | **`quick-xml` + serde**（`serde` derive 强类型映射） | 排除 roxmltree 手写遍历（样板代码量大）；排除 `serde-xml-rs`（对属性前缀/数组塌陷控制不如 quick-xml 的 `@` 修饰显式）。关键：用 `#[serde(default)]` + `Option` 容忍字段缺失，**数组一律显式声明**，从根上消灭 fast-xml-parser 单元素塌陷坑（踩坑 #5） |
| xlsx | 无第三方库——移植 `export_excel.rs` 手写 zip 层（`zip` crate 2.x deflate 已在移植范围内） | 见 D3。排除 calamine（只读）、rust_xlsxwriter（只写，都要就得两个库且仍需手工保字节） |
| CLI | `clap` 4（derive） | 子命令 + `--help` 自动生成，事实标准 |
| GUI（默认） | `eframe` / `egui`（立即模式） | 表单/表格/进度条原生够用；单二进制；无 WebView2 依赖；状态即变量，三步向导写成三个函数即可。排除 iced（表格/列表生态弱于 egui）、slint（授权模式需确认） |
| GUI（备选） | Tauri 2 + Svelte 5 | 团队最熟、UI 精致；代价：双进程、WebView2 分发、以及"前端方便了就会把逻辑写回 TS"的历史惯性（正是本次要摆脱的）。若 Q1 拍 Tauri，**铁律：解析与导出逻辑一行不进 TS** |
| 凭据 / 网络 | 标准 `std::net` + Windows `net use`（照抄 `dmt-copy-core/src/scan.rs` 的 UNC 处理） | 不引 reqwest——本工具不访问任何 HTTP |
| 存储 | 本地 JSON 文件（`machines.json`、`gv/<machine>/<MODEL>.json`、`last-session.json`），serde_json | 排除 SQLite（三个 JSON 文件的事不值得一个数据库）；排除 MongoDB/Firestore（主应用的教训：为三个配置文件接三个数据库后端） |
| 日志 | `tracing` + `tracing-subscriber`，滚转文件落在 app_data | CLI 走 stderr，GUI 写文件 + 界面日志面板 |
| 测试 | `cargo test` + golden JSON diff + 移植 `validate_export.py` | 见 §12 |

## 6. 总体架构

```
param-extractor/
├── Cargo.toml                # workspace
├── crates/
│   └── px-core/              # 全部领域逻辑（无 GUI/CLI 依赖，纯库）
│       ├── config.rs         # MachineConfig、machines.json、IP 派生、导入/导出
│       ├── collect.rs        # 三主机并行采集 → RawSources（移植 collect_host_sources）
│       ├── parse/
│       │   ├── mod.rs        # ModelRecord 定义（输出契约）
│       │   ├── light_spec.rs # LightSpec.xml → Vec<LightPage{channels}>
│       │   ├── inspection.rs # InspectionSpec.xml → groups/parents/children/params
│       │   └── dict.rs       # SpecParameter stringpack + SpecTreeNode 三级字典
│       ├── gv.rs             # GvStore、gv.json 读写、上次值预填
│       ├── export/
│       │   ├── mod.rs        # run_export(ExportArgs) -> ExportReport（run_export 母本）
│       │   ├── workbook.rs   # 手写 xlsx 读写层（移植）
│       │   ├── template.rs   # 模板加载 + 结构校验（D7 fail-fast）
│       │   └── rules.rs      # light_area_parents / axis_text / LabelIndex / sheet 匹配
│       └── store.rs          # app_data 布局与 JSON 持久化
├── src/
│   ├── main.rs               # 入口：无参数→GUI；有子命令→CLI（clap）
│   ├── cli.rs                # machines/scan/export 子命令
│   └── gui/
│       ├── app.rs            # eframe App、三步向导状态机
│       ├── step_machine.rs   # 步骤1 机器
│       ├── step_model.rs     # 步骤2 模型
│       ├── step_confirm.rs   # 步骤3 确认 + GV + 导出
│       └── widgets.rs        # 日志面板、加载态、错误条
└── templates/
    └── Parameter_Template.xlsx   # 随构建打包，安装时释放到 exe 旁
```

**核心铁律：`px-core` 不依赖任何 UI crate。** CLI 与 GUI 只是 `px-core` 的两个薄壳；
所有业务状态（机器、模型、GV、导出报告）都是可序列化的 core 类型，GUI 崩了 CLI 也能
跑完整流程，反之亦然。

数据流（一条直线，没有分支）：

```
MachineConfig ──collect.rs──> RawSources(3 hosts × 5 XML) ──parse/──> ModelRecord
                                                                      │
last-session.json + gv.json ──────────────┐                           │
                                          ▼                           ▼
                              ExportArgs{record, gv, template_path, output}
                                          │ export/
                                          ▼
                            <machine>_<model>.xlsx + ExportReport
```

## 7. 核心用户流程

每步标注 **[自动]**（黑盒完成，不问）与 **[人工]**（必须用户做/确认的）。

### 步骤 1：机器（一次性，之后全 [自动]）

- [人工] 首次使用：输入 Main PC IP（一个框）。FM1=IP+1、FM2=IP+2、BM=IP+3 自动派生，
  六个共享路径全部预填 `(auto)`；需要凭据时补一次用户名/密码（net use）。
- [人工] 或点"从主应用导入"直接读现成 `machines.json`（D5）。
- [自动] 配置持久化，第二次打开直接落在步骤 2。
- UI 呈现：主界面只是一个机器下拉框 + "配置…"小按钮；配置界面才是表单。
  **机器选择永远单选**（本工具一次处理一台机器的三个主机，与主应用的多机列表区分开）。

### 步骤 2：模型 [自动扫描 + 人工拍板]

- [自动] 进入步骤 2 即并行扫描三主机的模型目录（`find_model_dir` 规则），
  取交集去重展示（`ModelCandidate { name, hosts }` 现成结构）；下拉可搜索。
- [人工] 选中模型，或扫描为空/不全时**手输模型名**（大小写随意，`canonical_model_name`
  规范化；输入 `2an0859f01-00` 与 `2AN0859F01` 等价）。
- [自动] 选中即触发采集（§8.2），进度条按主机分列（FM1 / FM2 / BM 各自 OK/失败）。

### 步骤 3：确认 + GV + 导出（唯一需要认真看的一屏）

- [自动] 解析完成 → 界面展示**将写入 Excel 的东西**（不是原始 XML 树）：
  - 按主机×光照的摘要行：`FM1 · Light2 · AU+OSP · 14 参数块 · 42 参数`（数量一目了然，
    为 0 的组合标黄——通常意味着该主机的对应 PNODE 缺失，是采集不完整的信号）；
  - 光照轴比率预览（`White 0 : 30 = 3 : 1` 文本，来自 `light_axis_texts`）；
  - 每主机参数字典名解析率（`名称未解析的参数 n 个`）。
- [人工] **只填 Light2 / Light3 的 GV**：表格按 sheet（`Top1-Light2`、`Top2-Light2`、
  `Bottom-Light2`、`Bottom-Light3`…）分组，行 = area 标签（AU/OSP/NonMetal…），
  列 = R/G/B；上次导出过的值自动预填（D6），用户只需改变化了的。
  Light1 相关行不出现（没有参数，无 GV 可填——把这个规则写进表头提示而不是让用户猜）。
- [人工] 点"导出"→ [自动] 模板校验 → 填空 → 落盘 `<machine>_<model>.xlsx`
  → 报告面板（sheet×filled/gv/blanked/unresolved 计数）+ "打开所在文件夹"按钮
  （`revealItemInDir` / CLI 打印绝对路径）。

### 全局

- 顶栏常驻：机器名、模型名、模板文件版本指纹（D7 校验时算的 hash 前几位）。
- 底部常驻：可折叠日志条（采集/解析/导出的每一步时间戳），默认收起。
- 任何时候"上一步"不丢失已采集数据；采集结果按 `machine+model` 缓存内存中，
  同会话重复导出不再重新采集（除非点"重新采集"）。

## 8. 模块详细设计

### 8.1 配置层（`config.rs`）

```rust
pub struct MachineConfig {
    pub id: String,              // 兼容主应用 machines.json 的 id 字段
    pub name: String,
    pub main_ip: String,
    pub fm1_path: String, pub fm2_path: String, pub bm_path: String,             // \\IP\PxInventory
    pub fm1_repository_path: String, pub fm2_repository_path: String, pub bm_repository_path: String,
    pub username: Option<String>, pub password: Option<String>,
    pub agent: Option<AgentAddr>,   // 保留字段，本期不启用（Q4）
}
```

- `derive_from_main_ip(ip) -> Self`：主 IP 最后一字节 +1/+2/+3（进位到第三字节），
  路径字段生成 `\\<ip>\PxInventory`；`manually_edited: HashSet<String>` 语义照抄
  主应用 MachineManagement（用户改过的字段不再被派生覆盖）。
- 站点→面映射：`FM1/FM2 → TOP`，`BM → BOTTOM`（硬编码设备约定，不做成配置项——
  这是设备知识，不是用户偏好）。

### 8.2 采集层（`collect.rs`）

- 入口 `collect(machine, model) -> CollectedHosts`，`std::thread::scope` 三主机并行，
  每主机顺序读取（共享是 SMB，主机内并行只会加剧 Tailscale 慢链路抖动）：
  1. `LightSpec.xml`（`LIGHT_SPEC\<MODEL>\`，**注意此层目录名不带 -00**）；
  2. `INSPECT_SPEC\<MODEL>-00\{TOP|BOTTOM}\LIGHT{0,1,2}\InspectionSpec.xml`（**此层带 -00**）；
  3. 根目录 `SpecParameter.xml`、`SpecTreeNode.xml`。
- 文件读取一律**大小写不敏感 + 精确名匹配**（移植 `read_named_file`）：枚举目录项后
  按规范化名比较，绝不 glob 前缀——否则会捞进 `InspectionSpec_BackUp.xml`、
  `InspectionSpec.xml.bak`、`LIGHT2_bk (2)`、韩文损坏名 `"???"`（踩坑 #1）。
- 单文件缺失记为 `MissingSource { path }`，不中断；LightSpec 缺失只丢光照轴文本，
  InspectionSpec 缺失丢整个 sheet 的参数——报告里按严重度分级（warn/error）。
- 每主机一个超时（建议 60s，Tailscale 链路实测给出余量），超时 = 该主机失败，
  其余照常（D9）。

### 8.3 解析层（`parse/`）— 本项目最大开发量，Rust 重写

输出契约（`parse/mod.rs`，语义对齐主应用 `ModelRecord`，字段名保持 camelCase serde
以便 golden diff 与 gv.json 互通）：

```rust
pub struct ModelRecord {
    pub model_name: String,                       // canonical（大写、去 -00）
    pub hosts: HashMap<String, HostRecord>,       // "FM1" | "FM2" | "BM"
    pub parameter_dictionary: HashMap<String, String>,  // ParamKey -> 英文名
}
pub struct HostRecord {
    pub root_path: String,
    pub side: Side,                               // TOP | BOTTOM
    pub light_spec: Option<LightSpec>,            // 强类型，不再是 serde_json::Value
    pub parameter_dictionary: HashMap<String, String>,
    pub tree_dictionary: TreeDictionary,          // gp/p/c: id -> {name, color}
    pub inspection_specs: HashMap<String, InspectionSpecFile>,  // "LIGHT0".."LIGHT2"
}
pub struct LightSpec { pub pages: Vec<LightPage> }            // LightSet[..].Page[..]
pub struct LightPage { pub channels: Vec<LightChannel> }       // 20 通道 = 4色×5角度(0/30/30/60)
pub struct LightChannel { pub color: ChannelColor, pub angle: f64, pub value: f64, pub enable: bool }
pub struct InspectionSpecFile { pub groups: Vec<NodeGroup> }   // GPNODE→PNODE→CNODE
pub struct NodeGroup { pub id: String, pub name: String, pub parents: Vec<NodeParent> }
pub struct NodeParent { pub id: String, pub name: String, pub children: Vec<ChildNode> }
pub struct ChildNode { pub id: String, pub name: String, pub parameters: Vec<NodeParam> }
pub struct NodeParam {
    pub kind: ParamKind,     // MASTER | SUBMASTER | INSPECTION
    pub key: String,         // ParamKey，数字串
    pub name: String,        // 字典解析后的英文名（解析失败保留空串并计入 unresolved）
    pub values: HashMap<String, String>,  // Val/MinVal/MaxVal（+R/G/B 后缀，原样字符串）
}
```

重写要点：

- **stringpack 多语言合并**：`SpecParameter.xml` 的 `stringpack(LangCode, LangName)` 下
  若干 `string(ParamKey, Text)`；英文优先（LangCode 合并策略照抄
  `parseStringDictionary`，后写覆盖先写、英文最后落位）。`SpecTreeNode.xml` 同理取
  gp/p/c 三级 `node(id, name, color)`。
- **INSPECTION 三通道**：`ValR/ValG/ValB` + `MinValR/...` + `MaxValR/...` 各自成对出现；
  MASTER/SUBMASTER 只有单 `Val/MinVal/MaxVal`。`values` 保持"所有 `Val*`/`MinVal*`/
  `MaxVal*` 属性原样字符串"的语义（数值转换推迟到导出层 `parse_num`，容忍空串/非数）。
- **数组显式化**：`Page`/`Channel`/`MASTER`/`SUBMASTER`/`INSPECTION`/`string`/`node`
  在 quick-xml serde 映射里全部声明为 `Vec<T>` + `#[serde(default)]`——这是 TS 版
  `isArray` 回调承担的职责，Rust 版把它变成类型事实。
- **别名表**：`LABEL_ALIASES`（模板拼写 ↔ ParamKey，如 `darkdefectoffest2(th)→1014`）
  与 `nrm()` 归一化（去空白去下划线小写）随 `rules.rs` 一起移植，不改一个字。

### 8.4 GV 层（`gv.rs`）

```rust
pub type GvStore = HashMap<String /*host*/, HashMap<String /*pageIndex 0-based*/, HashMap<String /*行标签*/, GvSet>>>;
pub struct GvSet { pub red: String, pub green: String, pub blue: String }  // 键名 Red/Green/Blue，兼容现网
```

- 存储路径 `gv/<machineId>/<MODEL>.json`，**键格式与主应用逐字节一致**：主应用录过的
  GV 文件可直接拷来用，反向亦然。
- **页索引 = light_num − 1**：UI 上"Light2"对应目录 `LIGHT1`、页索引 1。这条 off-by-one
  链（UI 序号 / 目录号 / 页索引）是历史约定，全链路只允许在 UI 层出现"Light2"这种
  人类序号，core 层一律 pageIndex。
- 预填：打开确认屏时若 gv 文件存在则全量预填；`last-session.json` 另存
  "上次导出 machine+model+时间"，用于首页提示"上次导出到了哪里"。

### 8.5 导出层（`export/`）

- `run_export(ExportArgs) -> ExportReport`：移植 `run_export` 主干——打开模板 →
  `match_template_sheet` 逐 sheet 定位（`Top1-Light2` → (TOP, 2, FM1)，韩文旧名
  `Top 조명 2번` 兼容，host FM1 优先）→ `build_data_blocks`（按 `light_area_parents`
  规则取数）→ 匹配模板行标签填 `patch_cell`，缺的 area block 走 `append_blocks`
  追加 → GV 格填 `GvStore` → 光照轴文本 → `write_workbook`。
- **模板结构校验（D7，新增能力，原版没有）**：`template.rs` 加载模板时校验
  - 必需 sheet 齐全（6 个光照 sheet + DMG GV sheet）；
  - 每个 sheet 的表头行/列锚点存在（GV 列、조명 축 行等，锚点清单写在
    `PARAMETER_TEMPLATE_NOTES.md` 对应章节）；
  - 校验结果带模板 SHA-256 前缀展示在顶栏，模板一换立刻可见。
  校验失败 = 拒绝导出，列出缺失项。宁可拒绝，不可出半成品。
- 输出报告 `ExportReport`（沿用现有字段：每 sheet `filled/gv/blanked/appended/
  unresolved_labels`）——GUI 报告面板与 CLI `--json` 输出共用这个结构。
- 覆盖规则按 D8。导出成功后 `last-session.json` 更新。

### 8.6 模板覆盖接口（汇总）

模板"基本上不会变"，接口只需三件事：
1. **路径可配**：设置页（GUI）/ `--template`（CLI），默认 exe 旁 `templates/`；
2. **结构校验**：换模板立得缺失清单，不产出半成品；
3. **布局无关的实现边界**：填空逻辑只依赖"sheet 名 + 行标签 + 列锚点"，模板增删
   无关 sheet/行列不影响导出（`append_blocks` 已保证缺失 block 可追加）。
   若未来模板布局大改，`match_template_sheet` 的映射表是唯一需要动的文件。

## 9. UI 设计原则（重点）

主应用的病根：一个右面板页签塞了采集、参数树、GV、导出、复制……每个功能都常驻可见。
本工具的 UI 只服务一条流水线，原则按优先级：

1. **一条直线，不建仓库**。整个 GUI = 三步向导，没有侧边栏、没有页签、没有菜单树
   （除设置对话框）。用户永远知道自己站在流水线第几步——顶部三段式进度条
   （机器 → 模型 → 确认导出）常驻。
2. **黑盒默认，白盒可选**。自动派生、自动扫描、自动预填全部静默完成，但每一处
   自动值旁边都有一个可展开的"详情"（egui `CollapsingHeader`）：派生出的三个 IP
   能点开看、采集到的参数块计数能点开看、导出报告永远完整可查。
   **判断标准：展开任何东西都不改变流程，只是多看见一些**——这就是"不完全黑盒"的实现式定义。
3. **确认屏只显示会写进 Excel 的东西**。不展示原始 XML、不展示参数树全景、
   不展示 Min/Max（模板里本来就不导出这些）。用户扫一眼数量级对不对就能点导出。
4. **错误必须可见**（主应用 silent return 教训：表单静默不保存让按钮"看起来坏了"）。
   任何失败：红色错误条 + 具体原因 + 建议动作（"BM 连接失败：检查该 PC 是否开机，
   或点'继续（缺 BM）'"）。禁止 toast 消失式提示，禁止 console.log 式的"其实报错了但界面没事"。
5. **长操作必须有进度与去处**（Tailscale SMB 慢链路教训）。采集可能要几十秒：
   按主机分列进度 + 可折叠日志条；导出在后台线程（egui 下用 channel 回传进度），
   界面绝不冻结。所有网络操作的按钮在飞行中变为禁用态，防重复提交。
6. **GV 录入是唯一的"表格编辑"，把它做到无摩擦**：上次值预填、Tab 键行内导航、
   非数字即时标红但不阻塞、填完的行打勾、"从上次导出恢复"按钮。用户对 GV 的
   心理模型是"我量了一组亮度值"，不是"我在编辑数据库"。
7. **窗口小**。默认 900×640，无最大化强迫症。工具就要有工具的样子——
   这也天然防止功能再往里塞（想塞也放不下，是好事）。
8. **设置项分两档**：日常零设置（全自动默认）；设置对话框里只有三样——模板路径
   （D7）、输出目录、凭据。没有别的。想加设置项默认先回答"为什么这不该是自动的"。

## 10. CLI 契约

同一二进制，带子命令即 CLI（无 TUI，纯命令行，退出码稳定）：

```text
param-extractor                     # 无参数 → 启动 GUI

param-extractor machines list                       # 列出已配置机器
param-extractor machines import <path-to-machines.json>
param-extractor machines add --name <n> --main-ip <ip> [--username u --password p]

param-extractor scan --machine <name|id>            # 列出该机器所有模型（交集）
param-extractor collect --machine <n> --model <m> [--out record.json]
                                                    # 采集+解析，落 ModelRecord JSON（调试/管道用）

param-extractor export --machine <n> --model <m>
                     [--gv gv.json]                 # 缺省自动读 gv/<machine>/<model>.json
                     [--template <path>] [--out <path>] [--overwrite]
                     [--json]                       # ExportReport 走 stdout（供脚本解析）
```

退出码：`0` 成功；`2` 参数/配置错误；`3` 采集失败（含部分主机失败，stderr 列明细）；
`4` 模板校验失败；`5` 导出失败；`6` 输出文件冲突（未加 `--overwrite`）。

设计要点：`collect` 单独成子命令是为了排障（现场出问题时，一条命令把解析结果落盘
JSON 拿回来分析）；`--json` 让导出报告可被上层脚本消费；所有人类可读输出走 stderr，
stdout 只放机器可读数据（Unix 惯例，方便管道）。

## 11. 踩坑清单（经验向，文档核心价值）

以下全部来自主应用开发/现场运行中真实踩过的坑，按"必踩概率 × 踩了多痛"排序。
**每一条都是需求，不是建议。**

1. **脏文件/脏目录是常态，不是异常**。生产机上 `INSPECT_SPEC` 下有 `LIGHT2_bk`、
   `LIGHT2_bk (2)`、`InspectionSpec_BackUp.xml`、`InspectionSpec.xml.bak`、韩文损坏名
   `"???"` 目录。文件/目录定位必须**枚举后按规范化名精确匹配**（`read_named_file` /
   `find_model_dir` 的做法），禁止 glob、禁止"取第一个匹配前缀"。测试 fixture
   （`reference/`）里已包含这些脏样本，解析测试必须覆盖。
2. **`-00` 后缀只在 INSPECT_SPEC 层出现**。`LIGHT_SPEC\<MODEL>\` 不带 `-00`，
   `INSPECT_SPEC\<MODEL>-00>\` 带。两套规则并存是设备现实，路径拼装各用各的，
   不要抽一个"模型目录名"函数糊弄过去。模型名本身一律走 `canonical_model_name`
   （去 `-00` + 大写）做匹配与存储 key。
3. **GV 页索引 off-by-one 链**：UI "Light2" = 目录 `LIGHT1` = LightSpec 页索引 1 =
   InspectionSpec key `"LIGHT1"`。四层序号三种基准（1-based 人话 / 0-based 目录 /
   字符串 key），core 层统一 pageIndex（0-based），转换只发生在 UI 文案与 sheet 名
   映射两处。写错的表现是"GV 填进了错的 sheet"，静默且致命——单测锁死。
4. **fast-xml-parser 单元素塌陷坑**（Rust 重写的动机）：XML 里 `<Page>` 只有一个时
   TS 拿到对象，多个时拿到数组，`isArray` 回调就是为此打的补丁。Rust 版数组全部
   静态声明（§8.3），此坑在类型层消失——但 golden test 仍要包含单通道/单页样本。
5. **INSPECTION 参数的属性名是 `ValR/ValG/ValB`**（同理 Min/Max 带 R/G/B 后缀），
   MASTER/SUBMASTER 是单 `Val`。样本里存在空值、缺属性、非数值三种"半残"形态，
   `parse_num` 语义（空/非法 → None，不 panic、不报错）必须保留。
6. **模板行标签与字典名拼写不一致**：模板手写拼写错（`offest`）与后缀差异
   （`1(%)` vs `(%)`）靠 `LABEL_ALIASES` 别名表 + `nrm()` 归一化兜底。别名表是
   生产线知识沉淀，移植时一个条目都不能丢；unresolved 计数上升 = 新标签没见过，
   要在报告里显眼而不是悄悄空着。
7. **gp_label 特例**：group id `1` 的名字在模板里必须全大写 `UNIT`，其余 group 保持
   原拼写（`DataBlock::from_node` 里的 `to_ascii_uppercase` 特判）。删掉它 sheet
   行匹配会静默 miss。
8. **UNC 凭据**：Windows 共享首访需要 `net use` 建立会话（凭据来自配置）；
   失败表现为 `os error 5`/`1326`，报错文案要把"凭据或共享不可达"翻译成人话。
   凭据错误重试一次再报（Windows 偶发缓存陈旧会话）。注意：不要学主应用 agent
   用 SYSTEM 跑——SYSTEM 没有用户凭据上下文（os error 5 教训），本工具以登录用户
   运行，`net use` 由当前用户发起即可。
9. **Tailscale 链路 = 慢 + 偶发长阻塞**。凡触网的步骤（扫描、采集）一律后台线程 +
   超时 + 进度反馈（§9 原则 5），单主机超时不拖死其余主机（D9）。GUI 主线程
   （egui repaint 循环）绝不做 IO。
10. **模板其余部分必须字节不动**。上传服务端按布局解析工作簿，所以填空层只改
    目标单元格、追加 block 只在模板留白区——移植时写一个"填空前拆包 diff =
    只多了值变化"的字节级测试守住这条线（现有单测
    `fills_and_completes_the_real_template` 思路）。
11. **输出文件冲突**：`<machine>_<model>.xlsx` 极易重复导出，静默覆盖会让现场
    分不清哪份是哪份。按 D8：默认时间戳后缀，GUI 显式勾选才覆盖。
12. **模型名大小写是假象**。目录里 `2an0859f01-00` 与用户输入 `2AN0859F01` 必须视为
    同一模型；所有比较（目录、文件、模型名）走统一规范化函数，禁止裸 `==`。
13. **不要把"采集成功"和"数据完整"混为一谈**。某主机 LIGHT2 缺失时流程照走
    （D9），但确认屏该组合标黄、报告计 missing——让"缺"可见，是黑盒与可靠并存的关键。

## 12. 测试策略

- **Fixture**：`reference/` 三站点完整样本仓（含脏文件、含 `-00` 层级、含韩文 sheet
  旧名模板样本），只读挂载为测试数据，永不修改。
- **Golden test（D2 的落实手段）**：
  1. 用主应用现网流程对 `reference/` 三个模型各产出一份 `models/<machineId>/<MODEL>.json`
     （一次性，人工触发，结果入库 `tests/golden/`）；
  2. Rust 解析同源 XML，输出同结构 JSON，diff（字段级，忽略键序）；
  3. 不一致 = 要么 Rust 实现有 bug，要么发现了 TS 版的历史 bug——逐条裁决并注释
     在 golden 文件头。
- **导出回归**：移植 `validate_export.py` 为 CI 可跑脚本；保留
  `fills_and_completes_the_real_template` 式 Rust 单测（模拟 record 驱动真实模板，
  断言关键格值 + 模板其余字节不变，踩坑 #10）。
- **规则单测**：`light_area_parents` 三光照规则、GV 页索引映射（踩坑 #3）、
  `nrm`/别名表（踩坑 #6）、sheet 名匹配（含韩文旧名）、`export_file_name`。
- **容错单测**：脏文件环境（踩坑 #1）、单通道/单页 XML（踩坑 #4）、空值参数（踩坑 #5）、
  单主机超时（D9）。
- 固定节奏（沿主应用 05 计划惯例）：`cargo test` 全绿是每个里程碑收尾的固定验收项。

## 13. 里程碑

> 阶段制，不排日历日期；预估为净开发日。总计约 **11–16 净开发日**。
> 每个里程碑以可演示增量收尾；M1 起测试全绿为固定验收项。

| 里程碑 | 主题 | 预估 |
|---|---|---|
| M0 | ★ 脚手架 + 机器配置（含 GUI 框架试金石） | 1–2 天 |
| M1 | ★ 采集 + Rust 解析（全项目核心，golden test 建线） | 3–4 天 |
| M2 | 导出闭环（CLI 先行） | 2–3 天 |
| M3 | GUI 三步向导 + GV 录入 | 3–4 天 |
| M4 | 打包 + 文档收尾 | 1–2 天 |

### M0 — 脚手架 + 机器配置（1–2 天）

- workspace 骨架（§6）；`px-core::config` 完整实现（派生、导入、`manually_edited`）；
  GUI 空壳（三步向导导航 + 一个能用的机器表单）。
- **Q1 试金石**：egui 下把机器表单做出来（文本框/下拉/错误条/加载态各一件），
  感受是否够用——不够则此时切 Tauri 2，沉没成本仅此一个表单。
- 完成判据：
  - [ ] 无参数启动出 GUI，能新建并持久化一台机器，`machines list` 能读回；
  - [ ] 主应用 `machines.json` 导入成功（拿真实配置文件验证）；
  - [ ] Q1 拍板。

### M1 — 采集 + 解析（3–4 天）★

- `collect.rs`（并行采集 + 超时 + MissingSource）+ `parse/` 全量 + golden test 建线。
- 完成判据：
  - [ ] `reference/` 三模型 golden diff 全绿（含字典解析、三通道、LightSpec 通道）；
  - [ ] 脏文件 fixture 全部通过（不误读 `_bk`/`.bak`/损坏名）；
  - [ ] `collect` 子命令可落盘 record.json，人工抽查一份对照主应用输出。

### M2 — 导出闭环（2–3 天）

- `export/` 移植 + 模板校验（D7）+ 覆盖规则（D8）+ GV 读写（D6 格式）。
- 完成判据：
  - [ ] CLI 全流程跑通：`machines add → export → 成品 xlsx`，`validate_export.py` 通过；
  - [ ] 模板校验拒绝一个故意破坏的模板并列出缺失项；
  - [ ] 重复导出产生时间戳后缀，`--overwrite` 生效；
  - [ ] 主应用导出的同模型同 GV 成品与本工具成品**关键格值一致**（人工/脚本比对）。

### M3 — GUI 三步向导 + GV（3–4 天）

- 步骤 2/3 全量：模型扫描下拉、采集进度、确认摘要、GV 表格（预填/校验/打勾）、
  导出报告面板、日志条、设置对话框。
- 完成判据：
  - [ ] §9 原则逐条自查（错误可见、进度可见、黑盒默认白盒可选）；
  - [ ] 现场流程演练：真机配置 → 选模型 → 填 GV → 出文件 ≤ 3 次点击 + GV 录入；
  - [ ] 断网/单主机下线/凭据错三种故障场景的提示可用且可操作。

### M4 — 打包 + 文档（1–2 天）

- 单 exe 构建（egui 路线无安装器，zip 即发布）；模板释放；README（含 CLI 手册、
  故障对照表）；golden 与 fixture 的维护说明。
- 完成判据：
  - [ ] 干净 Windows 机（无 Rust、无 WebView2 假设）拷贝即用；
  - [ ] README 的故障对照表覆盖踩坑清单 #8/#9 的用户可见表现。

## 14. 待确认问题

见 §4 的 Q1–Q4 表（GUI 框架拍板 / 模板分发方式 / GV 复制功能 / agent 范围）。
另记两条不设期的备忘：

- 主应用旧链路的退役：等本工具现场验收跑稳一个模型周期后，再决定主应用里
  DataCollection/CalibrationLight 的去留（不在本计划内动主应用）。
- 若未来多站点/多机器批量出文件成为常态，CLI `--machine` 接受列表 +
  agent 采集（Q4）是预留好的扩展点，届时单独立计划。
