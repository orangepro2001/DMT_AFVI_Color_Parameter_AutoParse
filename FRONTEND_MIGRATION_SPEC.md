# FRONTEND_MIGRATION_SPEC — Svelte 前端 → Go/Wails 迁移与 IPC 解耦技术文档

> 只读逆向产物。生成自 `src/`（19×`.svelte` + 8×`.ts`，共 27 文件）与 `src-tauri/src/`（命令边界）。所有行号对应当前工作树。
> 目标平台：Color AFVI Master Teach（`afvi-parse` / `com.afvi.parse`）。前端栈：Svelte 5（runes + `$state/$derived/$effect`）、Vite 8、TypeScript 5.9、无 SvelteKit、单页挂载。

---

## 0. 迁移关键结论（TL;DR）

| 项 | 事实 | 迁移影响 |
|---|---|---|
| 唯一平台依赖 | `import { invoke } from '@tauri-apps/api/core'`（`src/lib/service.ts:1`） | 全仓库仅此一处导入 `@tauri-apps/*`；替换成本集中在一个文件 |
| Tauri 事件 API | **零使用**：无 `listen` / `emit` / `@tauri-apps/api/event` | 无需事件通道搬迁，全部同步 RPC；Wails `EventsOn` 只在未来需要进度流时引入 |
| `@tauri-apps/plugin-opener` | 声明于 `package.json:15` / `src-tauri/Cargo.toml:22`，**前端零调用** | 迁移时可整体删除该依赖 |
| 其它 Tauri 插件 | 无 dialog / fs / shell / notification / window / http 调用 | 迁移面收窄到 18 个自定义命令 |
| 全屏 | `document.documentElement.requestFullscreen()`（`App.svelte:67-68`），**非** Tauri window API | Wails 下无需改造（WebView2 原生支持） |
| 命令数 | 18（15 业务 + 3 文件/机台基础） | 见 §1 全量表 |
| 文件名大小写约定 | 前端传参 camelCase（`repositoryPath`/`modelName`/`caseId`/`sourcePath`/`baseSource`/`forceTruth`），Rust 侧 snake_case | **Tauri 2 默认 camelCase→snake_case 转换**；Wails 生成 binding 不做转换，适配层必须显式映射 |
| Struct 字段命名 | `Machine`/`MachinePaths` 等结构体字段为 snake_case（`fm1_path`），无 `rename_all` | Wails/Go struct 需保留同名 JSON tag |
| 大对象传输策略（D3） | 图像只回传 base64 JPEG 预览（≤4096px，`lib.rs:157`）；TIFF 从不经 IPC | Go 侧需保持同等契约（`encoding/base64` + jpeg），否则内存爆炸 |
| 状态持久化 | 文件：`read_app_file`/`write_app_file`（app-data 根，`app_files.rs`）；偏好：`localStorage` | Wails 需提供等价 app-data 目录 + 路径穿越防护（见 §3.4） |

---

## 1. Tauri API Call Graph & Inventory（调用全景表）

**唯一导入点**：`src/lib/service.ts:1` → `invoke`。全部 18 个命令经 `appService` 单例（`service.ts:1030`）封装。命令注册：`src-tauri/src/lib.rs:1759-1778`。

### 1.1 前端封装层方法 → 命令映射

| 前端源文件 (路径:行号) | Tauri Command | 传参 Payload (TS 类型) | 返回值预期 | 触发时机 / 业务功能 |
|---|---|---|---|---|
| `src/lib/service.ts:510` | `read_app_file` | `{ name: string }` | `string \| null`（缺失→null） | app-data 相对路径读取；所有 JSON 会话/持久化入口 |
| `src/lib/service.ts:514` | `write_app_file` | `{ name: string; content: string }` | `void` | 原子写入 app-data；machines/selection/roi/gv |
| `src/lib/service.ts:518` | `reference_machine` | `(无)` | `Machine \| null` | 启动机台列表；离线 reference 探测（`machine.rs:708`） |
| `src/lib/service.ts:543` | `scan_machine_models` | `{ machine: Machine; kind: 'inventory'\|'repository'; targets: ScanTarget[] \| null }` | `ModelCandidate[]` | 型号列表；ModelPicker 打开 / 启动自动选型（`App.svelte:118`, `ModelPickerDialog.svelte:60`） |
| `src/lib/service.ts:560` | `load_median_image` | `{ machine: Machine; repositoryPath: string; modelName: string; host: HostId }` | `MedianImageOutcome` | 中心舞台 MEDIAN 载入（`CenterImage.svelte:657`） |
| `src/lib/service.ts:580` | `measure_median_gv` | `{ machine; repositoryPath; modelName; host; roi: GvRoiIn\|null; sourcePath: string\|null }` | `MedianGvOutcome` | 全分辨率 GV 精确测量（`CenterImage.svelte:482`） |
| `src/lib/service.ts:591` | `align_probe_sources` | `{ machine; repositoryPath; modelName; host }` | `AlignSourceProbe` | **定义未接线**（无组件调用；M0 探针保留） |
| `src/lib/service.ts:605` | `align_load_overlay` | `{ machine; repositoryPath; modelName; host }` | `MedianImageOutcome` | Align/ROI 彩色合成预览（`CenterImage.svelte:720`） |
| `src/lib/service.ts:617` | `align_load_metal_median` | `{ machine; repositoryPath; modelName; host }` | `MedianImageOutcome` | **定义未接线**（Metal 身份叠合预览） |
| `src/lib/service.ts:639` | `align_metal_sim` | `{ machine; repositoryPath; modelName; host; seed: number; rois: RoiRect[]\|null; forceTruth: boolean }` | `MetalSimOutcome` | Metal 错位模拟/对齐/揭晓答案（`CenterImage.svelte:751,788,844`） |
| `src/lib/service.ts:658` | `align_generate_case` | `{ machine; repositoryPath; modelName; host; seed: number; baseSource: 'median'\|'pattern'; truth: AlignTruthTransform\|null; params: AlignCaseParams\|null }` | `AlignCaseOutcome` | 合成案例生成（`AlignCaseLab.svelte:65`） |
| `src/lib/service.ts:672` | `align_list_cases` | `(无)` | `AlignCase[]` | **定义未接线**（案例库列表） |
| `src/lib/service.ts:677` | `align_delete_case` | `{ caseId: string }` | `boolean` | 删除案例（`AlignCaseLab.svelte:196`） |
| `src/lib/service.ts:686` | `align_run` | `{ caseId: string; aligner: 'ecc'\|'phase' }` | `AlignRunOutcome` | M2/M3 求解器运行（`AlignCaseLab.svelte:93`） |
| `src/lib/service.ts:695` | `align_run_steps` | `{ caseId: string }` | `StepOut[]` | M4 分步教学（`AlignCaseLab.svelte:155`） |
| `src/lib/service.ts:706` | `align_verify` | `{ caseId: string; config: Partial<FiducialConfig>\|null }` | `FiducialReport` | M5 基准点置信判定（`AlignCaseLab.svelte:182`） |
| `src/lib/service.ts:733` | `align_run_rois` | `{ machine; repositoryPath; modelName; host; baseSource; seed; truth; config: null; rois: {name,x,y,w,h}[] }` | `RoiAlignOutcome` | 画定位框对齐（`AlignCaseLab.svelte:241`） |
| `src/lib/service.ts:747` | `read_model_sources` | `{ machine: Machine; modelName: string }` | `HostSources[]`（长度恒为 3） | 会话内 XML 源读取（`getModelData` 内部，被 5 个组件间接调用） |

### 1.2 Payload / 返回类型 Schema（前端 TS 定义，与 Rust serde 对齐）

**核心结构体（`service.ts` 定义 / Rust 对应）**

| TS 类型 | 定义处 | Rust 定义 | 字段要点 |
|---|---|---|---|
| `Machine` | `service.ts:16-31` | `MachinePaths` `machine.rs:671-685` | `id,name,fm1_path,fm2_path,bm_path,main_ip?,fm1/fm2/bm_repository_path?,username?,password?`（Rust 全字段非 Option、`#[serde(default)]`） |
| `ModelCandidate` | `service.ts:63-72` | `machine.rs:34-46` | `name,hosts:HostId[],created_ms?,resolution?` |
| `ScanTarget` | `service.ts:79-82` | `lib.rs:63-67` | `host,path` |
| `HostSources` | `service.ts:84-92` | `lib.rs:20-28` | `model_name,host,side,light_spec_xml,inspection_specs:{light,xml}[],spec_parameter_xml?,spec_tree_node_xml?` |
| `TeachSelection` | `service.ts:94-101` | —（前端持久化） | `host,light,group,parent,node,color` |
| `MedianImage` / `MedianImageOutcome` | `service.ts:105-124` | `lib.rs:309-333` | image: `side,host,version,path,width,height,data(base64 JPEG)`; outcome: `status:'found'\|'missing',image\|null,searched[]` |
| `GvRoiIn` | `service.ts:129-134` | `GvRoi` `lib.rs:644-649` | `x,y,w,h`（原始 TIFF 像素，可小数） |
| `MedianGvStats` / `MedianGvOutcome` | `service.ts:136-157` | `lib.rs:659-682` | stats: `roi:{x,y,w,h},mean,std,min,max,pixels,histogram?:number[256]`; outcome: `status,stats\|null,width,height,path,searched[]` |
| `RoiRect` / `RoiShape` | `service.ts:163-182` | `RoiRectIn` `fiducial.rs:187-193`（仅入参子集） | `id,name,x,y,w,h,shape?,points?`（预览像素） |
| `AlignSourcePath` / `AlignSourceProbe` | `service.ts:212-225` | `lib.rs:862-876` | path: `status,path\|null,version\|null,searched[]`; probe: `side,model_name,median,master_data` |
| `AlignTruthTransform` | `service.ts:230-235` | `TruthTransform` `align/mod.rs:26-31` | `tx_px,ty_px,theta_deg,scale` |
| `AlignCaseParams` | `service.ts:238-247` | `CaseParams` `align/mod.rs:42-51` | `noise_sigma,gain,offset,blur_sigma,occlusion_ratio,downsample` |
| `AlignCase` | `service.ts:250-260` | `align/mod.rs:62-73` | `schema_version,case_id,seed,model_name,side,template_path,input_path,truth,params` |
| `CaseImagePreview` | `service.ts:262-267` | `lib.rs:1422-1429` | `width,height,data(base64 JPEG)` |
| `AlignCaseOutcome` | `service.ts:269-275` | `lib.rs:1431-1438` | `case,case_dir,template,input` |
| `AlignResult` | `service.ts:280-291` | `align/mod.rs:116-128` | `aligner,tx_px,ty_px,theta_deg,scale,score,psr,ok,elapsed_ms,message` |
| `TruthComparison` | `service.ts:294-300` | `lib.rs:1567-1576` | `tx_error_px,ty_error_px,total_px,translation_only` |
| `AlignRunOutcome` | `service.ts:302-306` | `lib.rs:1578-1583` | `case,result,comparison` |
| `StepImage` / `StepOut` | `service.ts:310-328` | `align/steps.rs:22-42` | step: `id,title,subtitle,numbers:[label,value][],curve:number[]\|null,images:StepImage[]` |
| `FiducialConfig` | `service.ts:332-345` | `fiducial.rs:32-54` | 13 个阈值字段（见 Rust default `fiducial.rs:56-73`） |
| `FiducialMatch` / `DistanceConsistency` / `FiducialVerdict` / `FiducialReport` | `service.ts:347-377` | `fiducial.rs:75-112` | report: `matches[],fit:{tx,ty,theta_deg,scale},residual_rms,mean_ncc,psr,distance,inliers,verdict:{level,reasons[]}` |
| `RoiMatch` / `RoiReport` | `service.ts:384-408` | `fiducial.rs:198-227` | roi match 额外含 `located:boolean` |
| `RoiAlignOutcome` | `service.ts:412-422` | `lib.rs:1660-1675` | `base,grid_width,grid_height,template,input,truth,comparison,report,elapsed_ms` |
| `MetalSimAligned` / `MetalSimTruth` / `MetalSimOutcome` | `service.ts:426-458` | `lib.rs:1261-1296` | outcome: `seed,offset,grid_width,grid_height,preview,preview_width,preview_height,aligned\|null,truth\|null` |
| `GvValueSet` / `GvValues` | `service.ts:461-468` | —（纯前端 JSON） | `Record<host, Record<pageIndex, Record<row, {Red,Green,Blue}>>>` |
| `ModelData` / `HostData` | `service.ts:472-487` | —（前端解析产物） | 见 §2.2 |

**Rust 命令签名（参数名原文，供 Wails 结构体对齐）**

| Command | Rust 签名位置 | 参数（snake_case） |
|---|---|---|
| `scan_machine_models` | `lib.rs:70-74` | `machine: MachinePaths, kind: Option<String>, targets: Option<Vec<ScanTarget>>` |
| `read_model_sources` | `lib.rs:128` | `machine: MachinePaths, model_name: String` |
| `load_median_image` | `lib.rs:584-590` | `app, machine, repository_path, model_name, host` |
| `measure_median_gv` | `lib.rs:816-824` | `app, machine, repository_path, model_name, host, roi: Option<GvRoi>, source_path: Option<String>` |
| `align_probe_sources` | `lib.rs:907` | `machine, repository_path, model_name, host` |
| `align_load_overlay` | `lib.rs:931-937` | `app, machine, repository_path, model_name, host` |
| `align_load_metal_median` | `lib.rs:1101-1107` | `app, machine, repository_path, model_name, host` |
| `align_metal_sim` | `lib.rs:1308-1317` | `app, machine, repository_path, model_name, host, seed: u64, rois: Option<Vec<RoiRectIn>>, force_truth: Option<bool>` |
| `align_generate_case` | `lib.rs:1488-1498` | `app, machine, repository_path, model_name, host, seed, base_source, truth, params` |
| `align_list_cases` | `lib.rs:1533` | `app` |
| `align_delete_case` | `lib.rs:1545` | `app, case_id: String` |
| `align_run` | `lib.rs:1590` | `app, case_id, aligner: Option<String>` |
| `align_run_steps` | `lib.rs:1624` | `app, case_id` |
| `align_verify` | `lib.rs:1640` | `app, case_id, config: Option<FiducialConfig>` |
| `align_run_rois` | `lib.rs:1683-1693` | `machine, repository_path, model_name, host, base_source, seed, truth, config, rois` |
| `read_app_file` | `app_files.rs:29` | `app, name: String` |
| `write_app_file` | `app_files.rs:73` | `app, name: String, content: String` |
| `reference_machine` | `machine.rs:708` | `(无)` |

### 1.3 appService 方法 → 调用组件（业务触发矩阵）

| appService 方法 | 组件调用点（文件:行） | 业务语义 |
|---|---|---|
| `getMachines` | `App.svelte:107` | 启动机台+reference 列表 |
| `getActiveSelection` | `App.svelte:107` | 恢复上次选中型号 |
| `saveMachines` | `MachineManagement.svelte:78,89` | 机台增改删持久化 |
| `getModelData` | `App.svelte:112` `DataCollection.svelte:30` `CalibrationLight.svelte:93,144` `ParameterConfig.svelte:108,227` | 会话内 XML 解析缓存（见 §2.2） |
| `scanModels` | `App.svelte:118` `ModelPickerDialog.svelte:60` | PxInventory 型号扫描 |
| `loadMedianImage` / `alignLoadOverlay` | `CenterImage.svelte:657 / 720` | 舞台 MEDIAN / Align 预览 |
| `measureMedianGv` | `CenterImage.svelte:482` | GV 精确测量 |
| `alignMetalSim` | `CenterImage.svelte:751,788,844` | Metal 偏移模拟×3 场景 |
| `getRoiBoxes` / `saveRoiBoxes` | `RoiOverlay.svelte:100,172` `CenterImage.svelte:780` `AlignCaseLab.svelte:223` | ROI 框持久化 |
| `getGvValues` / `saveGvValues` | `CalibrationLight.svelte:97,143,127` | GV 标定值持久化 |
| `getTeachSelection` / `set teachSelection` | `ParameterConfig.svelte:124,349` | TEACH 树选择持久化 |
| `saveActiveSelection` / `clearActiveSelection` | `App.svelte:128` `DataCollection.svelte:33,76` `ConnectorDialog.svelte:65` `ModelPickerDialog.svelte:85` | 当前型号持久化 |
| `alignGenerateCase` / `alignRun` / `alignRunSteps` / `alignVerify` / `alignDeleteCase` / `alignRunRois` | `AlignCaseLab.svelte:65,93,155,182,196,241` | 对齐案例实验室全流程 |
| `parseLightSpec` / `parseInspectionSpecGroups` / `getLightChannels` | `ParameterConfig.svelte:275,281` `CalibrationLight.svelte:39` | **纯前端** XML 解析（无 IPC，迁移时原样保留） |

> 未接线（dead-but-registered）命令：`align_probe_sources`、`align_load_metal_median`、`align_list_cases` — 前端有封装方法但无组件调用点。

---

## 2. Events & Streaming Synchronization（事件监听与流式通信）

### 2.1 Tauri 事件使用盘点

| 检查项 | 结果 | 证据 |
|---|---|---|
| `listen(...)` 调用 | **0** | 全仓库 grep `listen\|emit\|@tauri-apps/api/event` 无命中 |
| `emit(...)` / `emitTo(...)` | **0** | 同上 |
| Rust `app.emit` / `Manager::emit` | **0** | `src-tauri/src` 无 `emit(` 调用 |
| `@tauri-apps/plugin-event` 依赖 | 无 | `package.json` 无 |
| 前端 `addEventListener('keydown')` | 2 处（**DOM 事件，非 IPC**） | `CenterImage.svelte:417`、`RoiOverlay.svelte:438`（`RoiOverlay` 经 `$effect` 绑定 Esc/Delete） |
| `window` 级事件 | `App.svelte:179` `<svelte:window onkeydown>`（关闭功能菜单） | DOM 事件 |

**结论**：当前架构 100% 为「请求-响应（invoke RPC）」模型，**无任何后端推送 / 流式通道**。所有"刷新"由用户显式触发（`CenterImage.refresh()` `CenterImage.svelte:680`）或状态变更 `$effect` 驱动。

### 2.2 双向数据同步链路（非事件、基于 runes + 文件）

前端自闭环与后端推拉边界：

| 链路 | 方向 | 载体 | 关键位置 |
|---|---|---|---|
| 机台/型号选择 → 舞台 | 前端内部 | `appStore.stageTarget` / `activeConnector` | `stores.svelte.ts:79-126`，`App.svelte:44` |
| 型号选中 → XML 载入 | 前端拉取（invoke） | `getModelData` 去重缓存（`pendingModels` Map + `sessionModels`） | `service.ts:507,813-827` |
| 参数编辑（会话内） | 前端闭环，**不写回后端** | `ModelData.sessionEdited` + WeakMap `localEdits` | `ParameterConfig.svelte:22,195-208` |
| ROI 框绘制 | 前端 → 文件（invoke 写） | `ui/roi-boxes.json`（imageKey 分组） | `RoiOverlay.svelte:169-173`，`service.ts:891-912` |
| GV 标定值 | 前端 → 文件（防抖写） | `ui/gv/<machineId>/<model>.json` | `CalibrationLight.svelte:116-133`，`service.ts:877-888` |
| 当前型号 | 前端 → 文件（invoke 写） | `ui/active-selection.json` | `service.ts:829-853` |
| TEACH 树选择 | 前端 → 文件（fire-and-forget） | `ui/teach-selection.json` | `service.ts:855-875` |
| Connector（机台+Vision） | 前端 → `localStorage`（非后端） | key `afvi-connector` | `stores.svelte.ts:19,24-58` |
| Tab / 主题 / 实机设置面板 | 前端 → `localStorage` | `afvi-tab`, `afvi-theme`, `afvi-machine-settings` | `App.svelte:79,102-104`；`theme.ts:88-101`；`MachineSettingsOverlay.svelte:42,73,95` |
| epoch 失效广播 | 前端内部 | `selectionEpoch` / `modelEpoch` 计数器被 `$effect` 监视 | `stores.svelte.ts:92-93`，`ParameterConfig.svelte:72-80`，`CalibrationLight.svelte:55-67` |

### 2.3 Wails 平替方案与注意事项

Wails 运行时事件 API：`runtime.EventsOn(ctx, name, cb)` / `runtime.EventsEmit(ctx, name, data...)`（Go）/ 前端 `window.runtime.EventsOn(name, cb)`。

| 场景 | 当前实现 | Wails 方案 | 注意事项 |
|---|---|---|---|
| 请求-响应（用户主动操作） | `invoke(cmd, args)` | `wailsjs/go/main/App.Cmd(args)` 返回 `Promise` | Go binding 无 camelCase 转换，参数按 Go 结构体 JSON 名传递 |
| 长耗时任务进度（**当前无**） | 无（仅前端本地计时器 `CenterImage.svelte:508-515`） | 若未来需要：`EventsOn('scan:progress')` | Wails 事件为全局广播，需带 `requestId` 去重，避免多窗口/多请求串扰 |
| 扫描/解码（gigapixel TIFF） | 同步等待 + 后端 `spawn_blocking` | Go 侧需 `go func()` 异步 + 事件回报 | 必须保持「只传 base64 JPEG 预览」；Wails 大 payload 走 JSON 序列化，与 Tauri 同样受限于内存 |
| 文件持久化 | `invoke('write_app_file')` 原子写 | Go 侧封装 `os.Rename` 原子写 + 同款路径校验 | 见 §3.4 |
| 刷新（用户点刷新） | `refresh()` 重发 invoke | 同 | 无需事件 |

> 关键风险：Wails 无 Tauri 的 `#[tauri::command]` 参数名映射层。Tauri 2 会把 JS 端 `repositoryPath` 映射到 Rust `repository_path`；**Go 不会**。适配层必须显式完成 camelCase↔snake_case/Schema 转换（§3）。

---

## 3. Frontend Decoupling & Adapter Layer（解耦与适配器架构）

### 3.1 设计原则

1. **UI 组件永远不 import 平台包**：组件只依赖 `appService`（现有单例契约）；把 `invoke` 提升为一个可注入的 `IpcClient` 接口。
2. **契约 = 现有 appService 公开面**（§1.3 方法集），保持签名不变，最小化组件改动。
3. **两层适配**：`IpcClient`（低层命令名+payload 映射）→ `AppService`（业务语义+XML 解析，已存在）。
4. **返回类型零迁移成本**：TS 接口即契约，Wails binding 返回结构对齐同名 JSON 字段即可。

### 3.2 抽象层接口（TypeScript 声明）

```ts
// src/lib/ipc/ipc-client.ts  —— 平台无关 IPC 抽象
export interface IpcClient {
  /** 唯一原语：命令名 + 命名参数对象。Tauri 传 camelCase，Wails 适配器内部转换。 */
  invoke<T>(command: IpcCommand, args?: Record<string, unknown>): Promise<T>;
}

export type IpcCommand =
  | 'read_app_file' | 'write_app_file' | 'reference_machine'
  | 'scan_machine_models' | 'read_model_sources'
  | 'load_median_image' | 'measure_median_gv'
  | 'align_probe_sources' | 'align_load_overlay' | 'align_load_metal_median'
  | 'align_metal_sim' | 'align_generate_case' | 'align_list_cases'
  | 'align_delete_case' | 'align_run' | 'align_run_steps'
  | 'align_verify' | 'align_run_rois';
```

```ts
// src/lib/ipc/tauri-client.ts —— 现网实现（语义等价于当前 service.ts:1 的 invoke）
import { invoke } from '@tauri-apps/api/core';
import type { IpcClient, IpcCommand } from './ipc-client';
export const tauriClient: IpcClient = {
  invoke: <T>(cmd: IpcCommand, args?: Record<string, unknown>) =>
    invoke<T>(cmd, args), // Tauri 2 自动 camelCase→snake_case
};
```

```ts
// src/lib/ipc/wails-client.ts —— 目标实现（映射表驱动）
import type { IpcClient, IpcCommand } from './ipc-client';
// 由 wails generate module 生成（示例路径）
import * as App from '../../wailsjs/go/main/App';

// 命令 → (camelCase 参数 → Go binding 调用) 显式映射
const WAILS_BINDINGS: Record<IpcCommand, (a: any) => Promise<any>> = {
  read_app_file:      (a) => App.ReadAppFile(a.name),
  write_app_file:     (a) => App.WriteAppFile(a.name, a.content),
  reference_machine:  ()  => App.ReferenceMachine(),
  scan_machine_models:(a) => App.ScanMachineModels(a.machine, a.kind ?? null, a.targets ?? null),
  read_model_sources: (a) => App.ReadModelSources(a.machine, a.modelName),
  load_median_image:  (a) => App.LoadMedianImage(a.machine, a.repositoryPath, a.modelName, a.host),
  measure_median_gv:  (a) => App.MeasureMedianGv(a.machine, a.repositoryPath, a.modelName, a.host, a.roi ?? null, a.sourcePath ?? null),
  align_probe_sources:(a) => App.AlignProbeSources(a.machine, a.repositoryPath, a.modelName, a.host),
  align_load_overlay: (a) => App.AlignLoadOverlay(a.machine, a.repositoryPath, a.modelName, a.host),
  align_load_metal_median: (a) => App.AlignLoadMetalMedian(a.machine, a.repositoryPath, a.modelName, a.host),
  align_metal_sim:    (a) => App.AlignMetalSim(a.machine, a.repositoryPath, a.modelName, a.host, a.seed, a.rois ?? null, a.forceTruth ?? false),
  align_generate_case:(a) => App.AlignGenerateCase(a.machine, a.repositoryPath, a.modelName, a.host, a.seed, a.baseSource ?? 'median', a.truth ?? null, a.params ?? null),
  align_list_cases:   ()  => App.AlignListCases(),
  align_delete_case:  (a) => App.AlignDeleteCase(a.caseId),
  align_run:          (a) => App.AlignRun(a.caseId, a.aligner ?? 'ecc'),
  align_run_steps:    (a) => App.AlignRunSteps(a.caseId),
  align_verify:       (a) => App.AlignVerify(a.caseId, a.config ?? null),
  align_run_rois:     (a) => App.AlignRunRois(a.machine, a.repositoryPath, a.modelName, a.host, a.baseSource ?? 'median', a.seed, a.truth ?? null, null, a.rois),
};

export const wailsClient: IpcClient = {
  invoke: <T>(cmd: IpcCommand, args?: Record<string, unknown>): Promise<T> =>
    WAILS_BINDINGS[cmd](args ?? {}) as Promise<T>,
};
```

### 3.3 替换对照表（Tauri → Wails Binding）

| 现调用（`service.ts` 行） | Tauri | Wails Go Binding | 参数转换 |
|---|---|---|---|
| `:510` | `invoke('read_app_file',{name})` | `App.ReadAppFile(name)` | 直传 |
| `:514` | `invoke('write_app_file',{name,content})` | `App.WriteAppFile(name, content)` | 直传 |
| `:518` | `invoke('reference_machine')` | `App.ReferenceMachine()` | 无参 |
| `:543` | `invoke('scan_machine_models',{machine,kind,targets})` | `App.ScanMachineModels(machine, kind, targets)` | `null` 语义需 Go 端用指针/`*T` |
| `:560` | `{machine,repositoryPath,modelName,host}` | `LoadMedianImage(machine, repositoryPath, modelName, host)` | camelCase 保持 |
| `:580` | `{...,roi,sourcePath}` | `MeasureMedianGv(..., roi, sourcePath)` | `roi:null`→Go `*GvRoi` |
| `:639` | `{...,seed,rois,forceTruth}` | `AlignMetalSim(..., seed, rois, forceTruth)` | `rois:null`→`*[]RoiRectIn` |
| `:658` | `{...,baseSource,truth,params}` | `AlignGenerateCase(..., baseSource, truth, params)` | 可选对象→指针 |
| `:686` | `{caseId,aligner}` | `AlignRun(caseId, aligner)` | 直传 |
| `:733` | `{...,config:null,rois:[{name,x,y,w,h}]}` | `AlignRunRois(..., null, rois)` | `config` 恒 null，可省略 |

### 3.4 关键组件迁移前后对比

**示例 A — `CenterImage.svelte` 的 MEDIAN 载入（`CenterImage.svelte:657`）**

迁移前（硬编码 Tauri）：
```ts
// service.ts:557-561
loadMedianImage(machine, modelName, side, host?) {
  const selectedHost = hostForSide(side, host);
  const repositoryPath = this.getRepositoryPath(machine, selectedHost)
    || deriveHostPath(machine.main_ip ?? '', selectedHost, 'repository');
  return invoke<MedianImageOutcome>('load_median_image',
    { machine, repositoryPath, modelName, host: selectedHost }); // ← 平台耦合
}
```

迁移后（注入 IpcClient，组件零改动）：
```ts
export class AppService {
  constructor(private readonly ipc: IpcClient = tauriClient) {} // 入口一次性切换实现

  loadMedianImage(machine, modelName, side, host?): Promise<MedianImageOutcome> {
    const selectedHost = hostForSide(side, host);
    const repositoryPath = this.getRepositoryPath(machine, selectedHost)
      || deriveHostPath(machine.main_ip ?? '', selectedHost, 'repository');
    return this.ipc.invoke<MedianImageOutcome>('load_median_image',
      { machine, repositoryPath, modelName, host: selectedHost });
  }
}
// 组件（CenterImage.svelte:657）保持 `await appService.loadMedianImage(...)` 不变。
// 启动切换： main.ts 中 `new AppService(wailsClient)`。
```
> `CenterImage.svelte`、`AlignCaseLab.svelte`、`RoiOverlay.svelte` 等 8 个组件全部只调用 `appService.*`，**无需修改**。

**示例 B — `AlignCaseLab.svelte` 的 ROI 对齐（`AlignCaseLab.svelte:241-250`）**

迁移前：
```ts
roiOutcome = await appService.alignRunRois(
  machine, modelName, side, roiList,
  { width: image.width, height: image.height },
  { width: natW, height: natH }, undefined, host);
```

迁移后（组件不变；内部 `service.ts:733` 换 client，并把预览坐标→原始 tif 坐标转换保留在前端）：
```ts
alignRunRois(...): Promise<RoiAlignOutcome> {
  const payload = rois.map(r => roiToOriginalPixels(r, original, preview))
                     .map(({name,x,y,w,h}) => ({name,x,y,w,h}));
  return this.ipc.invoke<RoiAlignOutcome>('align_run_rois', {
    machine, repositoryPath, modelName, host: selectedHost,
    baseSource: options?.baseSource ?? appStore.stageMode,
    seed: options?.seed ?? Date.now() % 100000,
    truth: options?.truth ?? null, config: null, rois: payload });
}
```

### 3.5 文件持久化层适配（安全性要求）

现实现安全边界（`app_files.rs:8-26`）：拒绝空名、绝对路径、盘符、父目录、尾随空格/点、非 `Component::Normal` 组件；根为 `app.path().app_data_dir()`。

Go/Wails 迁移必须**等价复刻**：
```go
// 校验：name 为相对路径，逐段拒绝 "", ".", "..", 含 ':', 尾随 '.'/' '
// 根：os.UserConfigDir()/afvi-parse 或 Wails app data dir（保持与旧版同根，见 CLAUDE.md 数据不变量）
// 写：同目录 .tmp → Sync() → os.Rename（原子性，防断连写入半文件）
```
路径常量（前端生成，`service.ts:1020-1023`）：`machines.json`、`ui/roi-boxes.json`、`ui/gv/<machineId>/<model>.json`、`ui/teach-selection.json`、`ui/active-selection.json`。

---

## 4. Svelte Specific Considerations（前端兼容性与细节）

### 4.1 构建与打包适配（Vite → Wails）

| 项 | 现状 | Wails 迁移动作 |
|---|---|---|
| 构建工具 | `vite.config.ts`（`@sveltejs/vite-plugin-svelte`），`build.target: "es2022"` | 保留；Wails `wails.json` 指向 `frontend:install/build` 脚本 |
| 开发端口 | `server.port: 1420`, `strictPort: true`（`vite.config.ts:8-11`）；Tauri `devUrl` 同值（`tauri.conf.json:9`） | Wails dev server 端口与 `wails.json` `frontend:dev:serverUrl` 对齐；可保留 1420 |
| 静态资源 base | **无显式 `base`**（默认 `/`）；`index.html` 用绝对 `/src/main.ts` | Wails 走 `embed.FS` + asset server，路径为根，无需改；若子路径部署需设 `base: './'` |
| 单页路由 | **无路由库**；`appStore.activeTab` 手写切页（`stores.svelte.ts:86`，`App.svelte:194-197`） | 无 SPA 路由改造；Wails 单窗口直出 |
| 静态导出 | `vite build` → `dist/`（`tauri.conf.json:11` `frontendDist: ../dist`） | Wails `frontend:dist: "dist"` |
| 挂载点 | `index.html:9` `<div id="app">` + `main.ts:9-12` `mount(App,{target})` | 不变 |
| 无 SvelteKit | `svelte.config.js` 仅 `vitePreprocess`，无 `@sveltejs/kit` | 无需 adapter/SSR 处理 |
| Node 版本锁 | `.vfox.toml` 固定 Node 24.11.1（`build_app.bat:16`） | 迁移期保持 |
| TypeScript 严格度 | `strict`, `verbatimModuleSyntax`, `noPropertyAccessFromIndexSignature`（`tsconfig.json`） | 生成 `wailsjs` 声明需通过严格检查（可能需要 `skipLibCheck` 已有） |

### 4.2 平台专属样式与 WebView 内核差异

| 项 | 现状 / 位置 | Windows WebView2 (Wails) 注意 |
|---|---|---|
| 滚动条 | `::-webkit-scrollbar` 全局定制（`styles.css:84-96`） | WebView2 = Chromium，`-webkit-` 前缀有效，无需改 |
| 字体 | `'Segoe UI', Tahoma, Geneva, Verdana`（`styles.css:77`） | Windows 原生；Wails 同为系统 WebView，表现一致 |
| 主题切换 | `theme.ts:71-86` 生成 `<style>` 注入 CSS 变量；`App.svelte:64` **切换即 `location.reload()`**（注释说明 WebView2 惰性重算导致混合调色板） | 该 workaround 针对 WebView2，Wails 沿用 WebView2 → **必须保留 reload 策略** |
| 窗口拖拽区域 | **当前无自定义标题栏拖拽**；`App.svelte:181` `.title-bar` 是普通 DOM，非 OS 标题栏（`tauri.conf.json:14-21` 用系统装饰窗口） | 若 Wails 用无边框窗口需加 `data-wails-drag`；当前架构**不需要** |
| 全屏 | `App.svelte:65-70` `document.requestFullscreen/exitFullscreen` | WebView2 支持；Wails 同内核，行为一致 |
| 用户选择/触摸 | `user-select:none`（`CenterImage.svelte:1272`）、`touch-action:none` | 一致 |
| 图像 data URI | base64 JPEG 直接 `src="data:image/jpeg;base64,..."`（`AlignCaseLab.svelte:407,462,570` 等） | 无 convertFileSrc 依赖，Wails 下直接可用 |
| CSP | `tauri.conf.json:24` `"csp": null`（无限制） | Wails 需确认 asset server 头部不引入 CSP 阻止 `data:` URI |
| 高 DPI | 尺寸用 `clamp()`/`vw` 响应式（`styles.css:6-11`） | 一致 |

### 4.3 迁移风险清单（前端侧）

| 风险 | 说明 | 缓解 |
|---|---|---|
| camelCase 参数 | Wails 不做参数名转换 | §3.2 映射表显式处理 |
| `Option<T>` 语义 | Rust `Option` ↔ JS `null`；Go 需指针 | Go 命令签名用 `*T`，前端保持 `null` |
| 大 payload 内存 | TIFF 预览 base64（可达数 MB）经 JSON | 保持 D3 契约：仅预览、限制 ≤4096px（`lib.rs:157`） |
| epoch/keep-alive | 组件常驻挂载，靠 `selectionEpoch`/`modelEpoch` 失效 | 与平台无关，原样保留 |
| `pendingModels` 去重 | 并发 `getModelData` 共享 Promise | 与平台无关，保留 |
| localStorage 持久化 | Connector/tab/theme/实机设置 | Wails WebView2 同源 localStorage 可用 |
| 无事件通道 | 未来若引入进度流需新增 `EventsOn` | 见 §2.3 |
| `plugin-opener` 残留 | 前后端均声明但未用 | 清理 `package.json:15` + `Cargo.toml:22` + `lib.rs:1758` |

---

## 附录 A：命令注册与插件（后端边界快照）

- 命令注册：`src-tauri/src/lib.rs:1759-1778`（18 个）
- 插件：`tauri_plugin_opener::init()`（`lib.rs:1758`）— 未被前端使用
- 能力：`src-tauri/capabilities/default.json` → `core:default`, `opener:default`（Wails 无对应概念，可删）
- 主窗口：`tauri.conf.json:14-21`（1440×900，min 1180×720，系统装饰）

## 附录 B：前端文件清单（27）

| 目录 | 文件 |
|---|---|
| `src/` | `main.ts`, `styles.css` |
| `src/lib/` | `service.ts`(1030L,唯一 IPC 层), `stores.svelte.ts`, `stage-api.svelte.ts`, `light-simulation.ts`, `roi-tools.ts`, `theme.ts`, `spec-model.ts` |
| `src/app/` | `App.svelte` |
| `src/app/components/` | `AlignCaseLab.svelte`, `AlignView.svelte`, `CalibrationLight.svelte`, `CenterImage.svelte`, `ConnectorDialog.svelte`, `DataCollection.svelte`, `ImageAlignSettings.svelte`, `MachineManagement.svelte`, `MachineSettingsOverlay.svelte`, `ModelPickerDialog.svelte`, `ParameterConfig.svelte`, `ParamTable.svelte`, `ReviewDefect.svelte`, `RoiOverlay.svelte`, `RoiToolPalette.svelte`, `SearchSelect.svelte`, `Settings.svelte`, `SettingsPanel.svelte` |
