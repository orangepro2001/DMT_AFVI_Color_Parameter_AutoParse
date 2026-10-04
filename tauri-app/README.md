# DMT AFVI 参数工具 — 桌面应用（Tauri 2 + Svelte 5）

AFVI 检查机颜色参数的离线采集与查看工具。读取设备 `PxInventory` 目录下的
`LightSpec.xml` / `InspectionSpec.xml` / `SpecParameter.xml` / `SpecTreeNode.xml`，
在本地保存为可直接浏览的模型快照，界面按 **AFVI Inspect 实机软件**的布局复刻，
作业者可在两套软件之间无缝切换。旧版单文件网页工具见仓库根目录的
`SpecParamTool.html` 与 `README.md`（本应用是它的桌面化演进）。

---

## 1. 当前成果

### 顶部导航
`HOME`（占位）/ `TEACH` / `REVIEW`（占位）/ `CALIBRATE` / `SETTINGS`，主区域为
料带视图 mock + 状态栏 + 日志面板，右侧面板承载当前 tab 页面（`appStore.activeTab`
+ `{#if}` 切换，无路由库）。

### SETTINGS — 数据采集
- 机器配置（Machine Configuration）：维护 AFVI 设备的 FM1 / FM2 / BM 三个主机路径；
  可选 **网络凭证**（用户名/密码，对应 UNC 路径 `\\server\share\...`）——Rust 端在
  扫描/采集前对每台服务器执行 `net use \\server\IPC$ <密码> /user:<用户> /persistent:no`
  （仅 Windows；仅填密码不填用户名会报错，两者都空则跳过）；**支持空密码账户**
  （如设备账户 `pixel` 无密码）：空密码以 `""` 参数显式传入，等价于 Win+R 里
  "用户名 + 空密码"登录，且关闭 stdin 保证永不弹出交互提示；遇系统错误 1219
  （服务器已有其他用户的连接）会先 `net use /delete` 再重试一次。凭证明文存于
  machines.json（机器本地文件）
- 数据收集（Data Collection）：一次收集 **FM1 + FM2 + BM 三台主机**的同一型号
  （`LIGHT_SPEC/<model>/LightSpec.xml`、`INSPECT_SPEC/<model>/{TOP,BOTTOM}/LIGHT0..2/InspectionSpec.xml`、
  `SpecParameter.xml`、`SpecTreeNode.xml`），解析后作为一个快照入库（模型选择器
  支持按文件夹扫描）
- **模型选取与本地库联动**：选中/输入型号后自动检查本地数据库——
  - 已有快照：弹框提示加载成功，自动设为当前模型并应用到 TEACH / CALIBRATE，
    Collect 降级为可选的 `Re-collect (optional)`（灰色），并提供 `Open TEACH` 直达按钮；
  - 无数据：状态栏引导 + Collect 按钮脉冲高亮，提示点击 `Collect & Save` 采集；
  - 重新打开页面时自动恢复上次的设备/型号并静默检查；
  - 型号名大小写、`-00` 后缀不影响匹配（与 Rust 采集端同样规范化）

### SETTINGS — 数据库（Database 标签页）
- **In use** 徽章实时显示当前使用的数据库（Local JSON files / MongoDB / Firestore）及库名/项目
- 后端切换（local / mongodb / firestore）、连接串与库名编辑——**所有配置都在 Settings 内完成**，
  保存于本机 `storage.json`（随 app-data 走，不随安装包）
- `Test Connection`：ping Atlas 集群并显示文档数（可在保存前测试表单里的新连接串）
- `Migrate Local Data → MongoDB`：本地 JSON 全量 upsert 到 Mongo（`migrate_store`），
  显示迁移报告（成功数 / 目标文档数 / 失败明细）；可重复执行（upsert 幂等）
- `Save & Apply`：立即生效（Tauri 端缓存自动重建）；Mongo 读失败/缺文档时自动
  回退读本地 JSON 备份，网络抖动不影响浏览

### SETTINGS — Firestore（Firebase 云数据库）
- 后端选 **Firestore (Firebase)** 即列出写死的连接配置（只读）：项目
  `project-f8cc5d3d-f29a-43ed-b7e`、Web API Key、集合 `documents`、数据库
  `dmtafviparse0923`（命名库，非默认库），常量位于 `src-tauri/src/storage.rs`
  （`FIRESTORE_*`）——Key 只是应用标识，真正的访问控制靠 Firestore 安全规则
- 同样提供 `Test Connection` / `Migrate Local Data → Firestore` / `Save & Apply`，
  读失败自动回退本地 JSON，写入仅走 Firestore
- 数据布局与 MongoDB 相同：集合 `documents`，字段 `key`（原始文档键，`/` 编码为 `__`）
  + `content`（JSON 文本），REST API 直连 `firestore.googleapis.com`
- **超 1MiB 自动分片**：Firestore 单文档上限 1MiB，超大模型快照按 700KB 分片——
  主文档存分片 0 + `total` 字段，其余分片存 `<id>__part<n>`（带 `chunkIndex`，
  列表时跳过）；读取透明拼装、删除连带清理，对功能代码完全透明
- **首次使用需在 Firebase 控制台开通**：项目 → Firestore Database → 创建数据库
  （Native mode）→ 规则用测试模式（允许读写）；未开通时 Test Connection 会给出提示

### SETTINGS — 导出参数 Excel（검사기술파라미터）
- 数据收集卡片下方的 **Export Parameter Excel** 区：配置导出路径（默认
  `D:\검사기술파라미터`）与模板工作簿路径（默认
  `D:\검사기술파라미터\Parameter_Template.xlsx`），配置自动保存到
  `ui/export-config.json`
- 输出文件名 `<设备名去空格>_<型号>.xlsx`，如 `AFVI14_6ST2001Q01.xlsx`
- 实现位于 `src-tauri/src/export_excel.rs`：直接改写模板的 worksheet XML——
  只填数值/清空占位，其余部分（样式、合并、打印设置、其他 sheet）逐字节保留，
  供上传服务器自动解析，格式不会漂移
- 填充规则（设备知识，与旧工具 `LIGHT_AREA_RULES` 一致）：
  - **工作簿命名（2026-09 起 FM1/FM2 分开管理）**：`Top1-Light2/3`（FM1）、
    `Top2-Light2/3`（FM2）、`Bottom-Light2/3`（BM）、`DMG 조명 1번`（只填 GV，
    Top/Bottom RED）；旧韩文命名 `Top 조명 2번` 等仍兼容（主机取 FM1 优先）
  - **GV 页码对齐 Calibrate**：每张 조명 表读自己光源页的 GV（light N → Calibrate
    第 N 页 → 键 N-1）；此前 Light2 表错读第 1 页导致 GV 写不进去（已修）
  - **조명 축 行自动填比例**：从 LightSpec 通道按颜色分析——启用的通道按角度分组
    （同角度取峰值）、按 GCD 约分，如 `White 0 : 30 = 3 : 1`（동축 180 : 30° 60）；
    B/D/F 列填同色光（Red/Green/Blue），无该色光时 B 列回退 White；单角度只写值
    （`Blue 0 = 330`）；禁用通道不参与
  - `DMG 조명 1번`（LIGHT0）：无 INSPECTION 参数，只填 GV（Top - RED / Bottom - RED 两列）
  - `Top1/Top2/Bottom-Light2`（LIGHT1）：只填 AU（PNODE 2）与 OSP（PNODE 3）区域的块；
    模板里的 Laser Marking 块按规则清空
  - `Top1/Top2/Bottom-Light3`（LIGHT2）：只填 NonMetal（PNODE 5）区域的块
- **节点树补全**：数据中存在而模板缺失的 영역 块会追加到表尾（克隆同 sheet 首块
  的样式与族标签，区域名换成本块、值按 ParamKey 匹配填充；超出族的参数追加为
  末尾行，标签取字典名）；6ST2001Q01 实测 Top 3번 补全 SR All / EtchBack / VIA /
  Laser Marking / Dummy 区块等
- 参数行标签匹配：模板拼写变体（Offest/Offset、(Size)/(Pixel) 等）通过别名表 +
  字典双向解析；GV 行写入用户在 CALIBRATE 页录入的测量值（自由文本，原样写入）
- **导出路径不再 hardcode**：导出路径与模板路径只存于数据库（`ui/export-config.json`），
  配置一次到处使用；两者为空时导出会明确提示先配置（代码里没有默认路径）
- **保存失败可见**：GV / 路径保存失败不再被静默吞掉（Calibrate 显示红字提示、
  Data Collection 显示汇总警告）；Firestore 写失败时数据自动落地本地文件，
  下次迁移补推，绝不丢失录入
- 端到端测试：`cargo test --test export_real`（模板与数据文件在本机存在时运行）

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
`StoredModelRecord`（`src/lib/service.ts`）：

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
machines.json                      机器列表（含可选的网络凭证）
models/<machineId>/<model>.json    模型快照（schemaVersion 2）
ui/active-selection.json           当前选中的设备/型号
ui/teach-selection.json            TEACH 页选中路径（主机/光源/组/父/节点/颜色）
ui/gv/<machineId>/<model>.json     手动测量的 GV 值
ui/export-config.json              Excel 导出路径 / 模板路径
```

---

## 3. 数据库环境与可扩展性（本地 JSON 默认 / MongoDB 已实现 / Firestore 已实现）

两端各自留有**唯一的存储接缝**，功能代码不直接触碰文件/驱动：

| 层 | 接缝 | 位置 |
|---|---|---|
| 前端 | `DocumentStoreClient` 接口：`read / write / remove / list` | `src/lib/document-store.ts` |
| 后端 | `DocumentStore` trait：同名四方法 | `src-tauri/src/storage.rs` |
| 配置 | `storage.json`：`{"backend":"mongodb","mongodb":{"url":"mongodb+srv://...","database":"dmt_afvi"}}` | app-data 目录 |

- **`local` 后端（默认）**：Rust `JsonFileStore` 按"一个 JSON 文档 = 一个文件"存取，
  首次启动自动写出默认 `storage.json`；命令面 `load_local_file / save_local_file /
  delete_local_file / list_local_files` 与 `get_storage_config / set_storage_config`
  对后端透明
- **`mongodb` 后端（已实现）**：`MongoDocumentStore`（mongodb crate + 内嵌 tokio
  runtime）——`documents` 集合中 `_id` = 文档键（与文件路径相同）、`content` =
  JSON 文本；连接串支持 `mongodb+srv://`（Atlas，需 `dns-resolver` feature，
  已启用）；打开时先 `ping`（10s 超时快速报错），连接实例缓存在 Tauri State
  （`StoreCache`），切换配置后自动重建
- **`firestore` 后端（已实现）**：`FirestoreStore`（reqwest blocking + REST API，
  无驱动依赖）——项目与 Web API Key 写死在 `storage.rs` 的 `FIRESTORE_*` 常量；
  集合 `documents` 中字段 `key`（文档键，`/` 编码为 `__` 存入 doc id）+ `content`
  （JSON 文本）；同样套 `WithFallbackStore` 读回退与 `StoreCache` 缓存
- **异步命令（重要）**：Tauri 同步命令运行在主线程，MongoDB 的每次读写都是跨
  网络请求（集群异常时阻塞至 10s 超时）——因此所有存储命令（load/save/delete/
  list_local_files、export_parameter_excel、test_mongo_connection、
  migrate_local_to_mongo、test_firestore_connection、migrate_local_to_firestore）
  均为 **async + `spawn_blocking`**，主线程零阻塞，UI 永不因数据库卡死
- **读回退**：`backend = mongodb` 时读写走 `WithFallbackStore`——主库读取失败或
  缺文档时回退到本地 JSON 文件（网络抖动不会白屏），写入只写主库
- **迁移与诊断命令**：`migrate_local_to_mongo`（本地全量 upsert 到 Mongo，返回
  报告）与 `test_mongo_connection`（ping + 文档数）；`migrate_store(from, to)`
  是纯函数，可复用于任意方向
- **当前状态**：本机数据（12 个文档：2 个模型快照、机器配置、GV、UI 状态）已
  迁移至 Atlas `dmt_afvi.documents` 并逐字节校验，`storage.json` 已切换为
  `mongodb`；本地 JSON 文件保留作为备份。**Atlas 连接串含凭证，只存于本机
  app-data 的 storage.json / Atlas 的 env 文件，绝不入库入仓**
- 离线验证过的存储单元测试：读写删回环、缺失文档、路径穿越防护、前缀列举
  （`cargo test`）

---

## 4. 构建与验证

```bash
cd tauri-app
npm install
npm run dev             # vite 开发服务器（端口 1420，与 tauri.conf.json devUrl 一致）
npm run build           # 生产构建（vite build）
npm run check           # svelte-check 类型检查
npm run tauri dev       # 桌面应用开发模式
cargo test              # 在 src-tauri/ 内：存储层单元测试
build_app.bat           # 一键打包（msi/nsis）
```

- 离线验证解析逻辑：用 `reference/FM2/PxInventory` 下的真实 XML 写 node 脚本，
  以 `tauri-app/node_modules` 里的 `fast-xml-parser` 复现服务端逻辑（字典 81 条、
  节点树 2/6/34、L-Pad 的 Master 表与实机截图逐行一致）
- 技术要点：Svelte 5 runes（`$state` / `$derived` / `$effect`）响应式模型，
  全局状态在 `src/lib/stores.svelte.ts`（machines / activeSelection /
  teachSelection / activeTab），组件里**没有也不需要手动变更检测**；
  `tsconfig` 开启 `noPropertyAccessFromIndexSignature`（索引签名需用 `[]` 取值）

---

## 5. 已知限制与下一步

- 集合（机器）管理、数据收集页面仍偏工具化，后续按实机风格继续打磨
- `NodeCheck`/GV 等编辑只写入本地快照，未回写生产 XML（设计如此，需导出功能时再评估）
- Global Align / SR Align 的光源与通道来自固定规则（全光源 + 最后一光源，Red 通道），
  待确认 `AlignSpec.xml` 是否应纳入采集范围
- MongoDB 后端按第 3 节步骤实现；`list_documents` 目前仅前缀列举，未接入任何 UI
- 切回本地：把 app-data 下 `storage.json` 的 `backend` 改回 `"local"` 即可（本地
  JSON 备份仍在，随时可用）

---

## 6. 站点局域网 Agent（Model Copier / 模型扫描加速）

桌面端不在设备局域网内、只经 Tailscale subnet 路由可达时，SMB 高往返使
Model Copy 与模型扫描极慢。可按站点部署 `dmt-agent` 守护进程（站点主 PC）：
桌面端把请求经 Tailscale 发给 agent，agent 在站点真实局域网内以千兆速度
执行机器间直拷与目录扫描，**数据流不出站点**，桌面端实时收到逐文件进度
（Model Copier 页进度条）。

- 领域逻辑（复制计划、删除防护、扫描、`net use` 凭据）在共享 crate
  `dmt-copy-core` 中，agent 与桌面端直连回退路径共用同一实现
- 机器配置新增可选 `agent: { addr, token }`（Machine Management 表单可填，
  主 IP 填写后自动建议 `main_ip:3777`）；列表带 agent 的机器有 **Test agent**
  按钮
- 复制走 agent 的条件：源与目标机器指向**同一个** agent 地址；地址不一致
  （跨站点）或未配置时自动回落直连 SMB，行为与过去完全一致
- 构建：`build_app.bat agent`；部署与协议细节见 `dmt-agent/README.md`
