# DMT AFVI 参数工具 — 桌面应用（Tauri 2 + Angular 18）

AFVI 检查机颜色参数的离线采集与查看工具。读取设备 `PxInventory` 目录下的
`LightSpec.xml` / `InspectionSpec.xml` / `SpecParameter.xml` / `SpecTreeNode.xml`，
在本地保存为可直接浏览的模型快照，界面按 **AFVI Inspect 实机软件**的布局复刻，
作业者可在两套软件之间无缝切换。旧版单文件网页工具见仓库根目录的
`SpecParamTool.html` 与 `README.md`（本应用是它的桌面化演进）。

---

## 1. 当前成果

### 顶部导航
`HOME`（占位）/ `TEACH` / `REVIEW`（占位）/ `CALIBRATE` / `SETTINGS`，主区域为
料带视图 mock + 状态栏 + 日志面板，右侧面板承载当前路由页面。

### SETTINGS — 数据采集
- 机器配置（Machine Configuration）：维护 AFVI 设备的 FM1 / FM2 / BM 三个主机路径
- 数据收集（Data Collection）：一次收集 **FM1 + FM2 + BM 三台主机**的同一型号
  （`LIGHT_SPEC/<model>/LightSpec.xml`、`INSPECT_SPEC/<model>/{TOP,BOTTOM}/LIGHT0..2/InspectionSpec.xml`、
  `SpecParameter.xml`、`SpecTreeNode.xml`），解析后作为一个快照入库（模型选择器
  支持按文件夹扫描）

### TEACH — 参数树界面（按实机复刻）
- 主机选择（FM1/TOP-1、FM2/TOP-2、BM/BOTTOM）+ 设备/型号显示 + Save Local / Reload
- **Unit / Dummy** 组标签卡（左侧）与 **Light-1 / 2 / 3** 标签卡（右侧），全部可点击切换
- Global Align / SR Align 信息块、Overlay 复选框（MK / A_C / I_C / SK）
- **彩色节点树**：节点名称与颜色来自 `SpecTreeNode.xml`，勾选状态来自 `NodeCheck`，
  点击选中呈橙红色；Align / ROI 子树无复选框（与实机一致）
- 三张参数表：Master（ControlType=1 显示为无文字蓝色开关）、Submaster（由
  Chain Align / Chain Inspection 开关门控显示）、检查表（Red/Green/Blue 标签卡切换
  `ValR/ValG/ValB`，带 Min 列）；参数名通过 `SpecParameter.xml` 字典解析
  （英文名，多语言包合并，英文优先）
- 编辑仅作用于本地快照（Save Local / Reload），生产文件不受影响

### CALIBRATE — 光源校准
- 20 通道亮度表（Value / Angle / Color / ON-OFF，来自 `LightSpec.xml` 的 Page）
- **GV 밝기 输入区**：GV 亮度目标是人工测量、手动录入的，不存在于任何 XML——
  Page Index = 1 / 2 时显示 **AU、OSP** 两行，Page Index = 3 时显示 **SR、Space**
  两行，每行均为 RED / GREEN / BLUE 三个输入框；按 主机 + PageIndex 分键，输入
  后自动保存（防抖 500ms），自由文本格式（允许 `180`、`60 : 50~70`、`X` 等）

---

## 2. 数据模型

### 模型快照（schemaVersion 2）
`StoredModelRecord`（`app.service.ts`）：

```
machine / modelName / collectedAt
hosts: { FM1, FM2, BM } 每主机:
  rootPath, side(TOP|BOTTOM)
  lightSpec                      LightSpec.xml 原始解析树
  alignment                      Global Align(每个光源一行) / SR Align(最后一个光源) → Light: n, Channel: Red
  parameterDictionary            ParamKey → 英文名（SpecParameter.xml，全部 stringpack 合并、英文优先）
  treeDictionary {gp,p,c}        节点 ID → 名称（SpecTreeNode.xml，三级分开存放）
  inspectionSpecs.LIGHTn.groups  GPNODE→PNODE→CNODE 完整树:
                                 节点含 id/name/color/checked(NodeCheck);
                                 叶含 kind(MASTER|SUBMASTER|INSPECTION)/key/name/
                                 controlType/specGroup/values{Val,ValR,ValG,ValB,MinVal*}
```

旧版扁平格式（schemaVersion 1，只有 `parameters` 数组）会被 TEACH 页的
`legacyRecord` 检测提示"重新收集"。

### 本地数据库文件布局（app-data 目录）
```
storage.json                       存储后端配置（见下节）
machines.json                      机器列表
models/<machineId>/<model>.json    模型快照（schemaVersion 2）
ui/active-selection.json           当前选中的设备/型号
ui/teach-selection.json            TEACH 页选中路径（主机/光源/组/父/节点/颜色）
ui/gv/<machineId>/<model>.json     手动测量的 GV 值
```

---

## 3. 数据库环境与可扩展性（本地默认，预留 MongoDB）

两端各自留有**唯一的存储接缝**，功能代码不直接触碰文件/驱动：

| 层 | 接缝 | 位置 |
|---|---|---|
| 前端 | `DocumentStoreClient` 接口：`read / write / remove / list` | `src/app/document-store.ts` |
| 后端 | `DocumentStore` trait：同名四方法 | `src-tauri/src/storage.rs` |
| 配置 | `storage.json`：`{"backend":"local","mongodb":{"url":"mongodb://localhost:27017","database":"dmt_afvi"}}` | app-data 目录 |

- **默认 `local` 后端**：Rust `JsonFileStore` 按"一个 JSON 文档 = 一个文件"存取，
  语义为文档型（与 MongoDB 的 collection+document 模型一一对应），首次启动自动
  写出默认 `storage.json`；命令面 `load_local_file / save_local_file /
  delete_local_file / list_local_files` 与 `get_storage_config / set_storage_config`
  对后端透明，前端与命令名不需要随迁移改变
- **Rust 单元测试**（`cargo test`）覆盖读写删、缺失文档、路径穿越防护、前缀列举
- **切换到 MongoDB 的步骤**（未来执行）：
  1. `Cargo.toml` 增加依赖 `mongodb = { version = "3", features = [] }`（可置于
     feature flag 之后，避免默认编译变重）；
  2. 在 `storage.rs` 实现 `MongoDocumentStore`：`read/write/delete/list` 直接映射
     到 `db.<database>.<collection>`（以文件路径为 `_id`，文档体为 `{ content }`），
     在 `open_store()` 的 `"mongodb"` 分支返回（当前该分支返回明确错误提示）；
  3. `storage.json` 改 `"backend": "mongodb"`，填 `url` / `database` 即完成切换；
  4. 前端无需改动；如需绕过 Rust，也可在 `createDocumentStore()`
     （`document-store.ts`）处替换为实现了同一接口的客户端
- 已知存量数据即 JSON 文档，迁移脚本只需按上面的文件布局把文件灌入对应
  collection 即可

> 说明：当前未引入 `mongodb` crate（避免无谓的编译体积），接缝与配置已就位，
> 实现后端本身是隔离在小模块内的工作。

---

## 4. 构建与验证

```bash
cd tauri-app
npm install
npm run build            # Angular 生产构建（ng build）
npm run tauri dev        # 桌面应用开发模式
cargo test               # 在 src-tauri/ 内：存储层单元测试
build_app.bat            # 一键打包（msi/nsis）
```

- 离线验证解析逻辑：用 `reference/FM2/PxInventory` 下的真实 XML 写 node 脚本，
  以 `tauri-app/node_modules` 里的 `fast-xml-parser` 复现服务端逻辑（字典 81 条、
  节点树 2/6/34、L-Pad 的 Master 表与实机截图逐行一致）
- 技术要点：Angular 18 standalone + `provideExperimentalZonelessChangeDetection`
  （异步 Tauri invoke 之后必须 `ChangeDetectorRef.markForCheck()`）；
  `tsconfig` 开启 `noPropertyAccessFromIndexSignature`（索引签名需用 `[]` 取值）

---

## 5. 已知限制与下一步

- 集合（机器）管理、数据收集页面仍偏工具化，后续按实机风格继续打磨
- `NodeCheck`/GV 等编辑只写入本地快照，未回写生产 XML（设计如此，需导出功能时再评估）
- Global Align / SR Align 的光源与通道来自固定规则（全光源 + 最后一光源，Red 通道），
  待确认 `AlignSpec.xml` 是否应纳入采集范围
- MongoDB 后端按第 3 节步骤实现；`list_documents` 目前仅前缀列举，未接入任何 UI
