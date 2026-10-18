# Color AFVI Master Teach：Wails 重建计划（v2）

> 状态：规划文档，未改动任何源码
> 分析基线：`main` @ `50026b2`
> 日期：2026-10-18
> v1（逐行移植 Tauri → Wails）已作废。原因：产品方向从“对齐算法教学”改为“1:1 还原实机体验”，大部分对齐教学代码不再需要移植。

---

## 1. 决策

**以现有应用为参考，在 Go + Wails v2 上重建，不做逐行移植。**

| 依据 | 说明 |
|---|---|
| 编译慢、`target` 目录大 | Rust 的 `src-tauri/target`（含 release LTO、`codegen-units = 1`）是直接痛点；Go 增量编译为秒级，构建缓存在 `GOCACHE`，不落在仓库里 |
| 方向改为 1:1 还原实机 | 合成案例、显示正确答案、分步讲解、案例实验室、Metal 偏移模拟等教学功能不再需要。v1 估算中最贵、风险最大的“算法逐位对拍”因此大部分取消 |
| 交互不完整、包袱重 | 现有前端经过多次改向，重建时按实机截图重新核对每个交互，不沿用错误假设 |
| 数据格式已验证 | 全部样本 TIFF 均为 Go 标准扩展库可直接读取的格式（§2.1） |

**不变的部分**：Svelte 5 前端技术栈、app-data 目录与 JSON 文件、“生产 XML 永不写回”等数据不变量（§6）。

---

## 2. 已核实的事实（作为实现依据）

### 2.1 样本数据（`reference/`，型号 25FBO015-15）

| 文件 | 格式 | 内容 |
|---|---|---|
| `PxRepository\25fbo015-15\{Metal,Open,SR}.tif`（与 `PxInventory\INSPECT_SPEC\25FBO015-15-00\AlignData\` 中同名文件 SHA-256 相同） | 经典 TIFF（II/42）、无压缩、8 bit 单通道、每条带 1 行、5860×4020，Matrox Imaging Library 10.00 | 纯二值（只有 0 和 255） |
| `PxRepository\25fbo015-15\2.0\Line\Top\Layer\GB\Pattern.tif` | 同上 | 二值 |
| `…\Layer\MEDIAN\Median_0_1_{0,1,2}.tif` | 同上 | 灰度，三张内容不同（均值 31.0 / 18.1 / 52.4） |

- Go 1.27.1 + `golang.org/x/image` v0.38.0 的 `tiff.Decode` 均解为 `*image.Gray`，与原始条带逐像素比对 **0 差异**，单张约 70–80 ms，堆约 68 MB。
- MEDIAN 是单元尺寸图，不是十亿像素长条。v1 中的大图内存风险不再成立。
- **MEDIAN 固定使用一张图**（与光源页不对应）。沿用现有行为 `Median_0_1_0.tif`（待用户确认是否为这一张，§8）。
- **拿不到实机对齐用的原始相机图**。

### 2.2 实机界面（Pixel Inspector 2.2.6.09210 - AFVI，TEACH，Align / ROI → Metal）

| 区域 | 实机表现 | 对应数据 / 现状差距 |
|---|---|---|
| 中心舞台 | SR 区域绿色、Metal 黄色、其余黑色；坐标就是 5860×4020 单元网格（状态栏 `XY: 5785, 3553`） | 用 AlignData 三件套在**全网格**上合成即可复现：已在临时目录用 Go 渲染，与截图逐特征吻合。现有 `compose_identity` 会**按并集外框裁剪并缩放**，坐标系与实机不一致 |
| 黄色定位框 | 四角十字各一个框，中央金手指区左右各一个框，共 6 个 | 来自 `INSPECT_SPEC\<model>\TOP\AlignSpec.xml` → `<AlignPoint><Unit>` 中 `Type="0"` 的 Param ID 4–9（`Left/Top/Right/Bottom`，单元网格像素），坐标与截图位置一致。`Type="3"` 的 ID 0–3 截图中未显示。现有应用**完全没有读取 AlignSpec.xml** |
| 右侧 Global Align / SR Align | `Light 1/2/3 Channel Red`；`SR Align Light 3 Channel Red` | `AlignSpec.xml` 的 `<GlobalAlign Light L1Channel L2Channel L3Channel>`、`<SRAlign Light="2" Channel="0">`。现有 `service.ts::buildAlignment` 按光源页数**硬编码**为全 Red，不是从源数据读取 |
| 树节点 | Align / ROI（Metal 红橙、SR 绿、DMG 灰）、AU、OSP、Drill、NonMetal…，带颜色与勾选 | 现有解析已覆盖（`SpecTreeNode.xml` + `InspectionSpec.xml`） |
| Overlay 勾选 | `MK`、`A_C`、`I_C`、`SK` | 推测与 `UserMask.xml`、`DefectMask.xml`、`LaserMarking.xml` 等有关，**未核实**（§8） |
| 规格页签 | Specification / Image Analysis；Unit / Dummy；Light-1/2/3；Red / Green / Blue | 现有 TEACH 面板已部分实现，重建时逐项核对 |
| 左侧 | 条带单元图（青/红网格） | 现有应用未实现，数据来源未知（§8） |
| 底部 | 连接与 KeepAlive 日志 | 现有应用有事件日志 |

### 2.3 现有 Metal 叠加“不出现”的代码路径

点击 Align / ROI 下任一节点 → `ParameterConfig.svelte:181` 把 `stageMode` 设为 `pattern` → `CenterImage.svelte:720` 调用 `align_load_overlay` → AlignData 三件套（`compose_identity`）→ 失败则回退到 GB/L01 十字配准 → 再失败回退为灰度 Pattern。链路存在，但有三层静默回退，任何一层出问题都只会显示灰度图而不报错。重建时改为单一路径：AlignData 全网格合成；三件套缺失则明确显示“缺少 AlignData”，不静默回退。

---

## 3. 范围

### 3.1 移植（行为保持，文件兼容）

| 现有（Rust / TS） | 重建后 |
|---|---|
| `app_files.rs`：`read_app_file` / `write_app_file`、路径防护、原子写 | `internal/appfiles`，规则逐条保留 |
| `machine.rs`：MachinePaths、型号扫描（inventory / repository）、`canonical_model_name`、`find_model_dir`、`net use`、`reference_machine` | `internal/machine` |
| `lib.rs`：`read_model_sources`（XML 原文透传） | `internal/sources`，**新增透传 `TOP|BOTTOM\AlignSpec.xml` 原文** |
| `lib.rs`：MEDIAN 定位与预览、GV 测量 | `internal/median`（固定 `Median_0_1_0.tif`） |
| `service.ts` 的 XML 解析、机台/路径推导、会话模型缓存 | 保留；新增 AlignSpec 解析，`buildAlignment` 改为读源数据 |
| Svelte 组件中与实机一致的部分 | 保留，按 §2.2 逐项核对 |

### 3.2 重做

| 功能 | 新行为 |
|---|---|
| Align / ROI 舞台 | AlignData `SR` 绿 + `Metal` 黄，全网格 5860×4020，不裁剪；预览图按比例缩放，但**所有坐标（XY 读数、定位框、用户 ROI）一律使用单元网格像素** |
| 定位框 | 从 AlignSpec.xml 画出 `Unit` 定位点（先显示 `Type="0"`，`Type="3"` 的含义待核实）；编辑属于会话修改，不写回 |
| Global / SR Align 面板 | 从 AlignSpec.xml 读取 |
| 状态栏 | `XY`（网格像素）与 `RGB`（当前预览像素值） |

### 3.3 删除（不移植）

| Rust | 前端 |
|---|---|
| `align/generator.rs`、`phase.rs`、`ecc.rs`、`fiducial.rs`、`steps.rs`、`metal_sim.rs`、`overlay.rs` 中 GB/L01 十字配准部分；8 个 `examples/` | `AlignCaseLab.svelte`、`AlignView.svelte`，`ImageAlignSettings.svelte` 中的偏移模拟、“用 ROI 对齐”、“显示正确答案”、案例实验按钮 |
| 命令：`align_probe_sources`、`align_load_overlay`（由新合成命令替代）、`align_load_metal_median`、`align_metal_sim`、`align_generate_case`、`align_list_cases`、`align_delete_case`、`align_run`、`align_run_steps`、`align_verify`、`align_run_rois` | `service.ts` 中对应方法与类型 |
| app-data 中的 `align-cases/` 不再使用（不主动删除用户数据） | |

**关于对齐成功率**：拿不到原始相机图，就无法真实模拟对齐的成败。用已对齐、均匀采样的 MEDIAN 去模拟，只会得到虚高的成功率，相当于向用户展示假结果。因此重建版**不提供对齐成功/失败判定**，只还原实机 TEACH 中定位点的查看与编辑。日后拿到原始图再单独立项。

---

## 4. 架构

### 4.1 目录

```
<repo root>/
├── main.go                 # wails.Run；//go:embed all:dist
├── app.go                  # 生命周期（startup 保存 ctx）
├── wails.json              # frontend:dir "."，build "npm run build"，devServer http://localhost:1420
├── go.mod / go.sum
├── build/                  # appicon.png、windows/icon.ico、NSIS 资源
├── internal/
│   ├── appdirs/            # %APPDATA%\com.afvi.parse（与 Tauri 版同一目录）
│   ├── appfiles/
│   ├── machine/            # unc_windows.go / unc_other.go
│   ├── sources/
│   ├── imaging/            # TIFF 解码、缩放、JPEG q85、base64
│   ├── median/
│   └── layers/             # AlignData 全网格合成
├── services/               # Wails 绑定层：FileService / ModelService / ImageService
├── src/                    # Svelte 前端（目录不动）
└── src-tauri/              # 重建期保留作对照；功能对齐后删除
```

### 4.2 IPC 规范

- 每个命令一个 Go 方法，参数为一个请求结构体，`json` tag 使用前端现有的 camelCase 参数名，`service.ts` 的参数对象可原样传入。
- 返回结构体的 `json` tag 与现有 serde 字段名逐字一致（snake_case）。
- 新增 `src/lib/ipc.ts`：`call(command, args)`，按命令名映射到生成的 Wails 绑定；`service.ts` 只把 `invoke` 换成 `call`。
- 错误返回 `error`，前端收到字符串，与 Tauri 一致；错误文本沿用现有英文原文。
- 当前无事件，不引入事件总线。

| 命令 | Go 方法 |
|---|---|
| `read_app_file` / `write_app_file` / `reference_machine` | `FileService.ReadAppFile` / `WriteAppFile` / `ReferenceMachine` |
| `scan_machine_models` / `read_model_sources` | `ModelService.ScanMachineModels` / `ReadModelSources` |
| `load_median_image` / `measure_median_gv` | `ImageService.LoadMedianImage` / `MeasureMedianGv` |
| `load_align_layers`（新，替代 `align_load_overlay`） | `ImageService.LoadAlignLayers`：返回全网格尺寸 + 合成预览 JPEG |

### 4.3 必须处理的 Go 序列化差异

| 差异 | 处理 |
|---|---|
| `nil` 切片输出 `null`（Rust 为 `[]`） | 所有切片字段初始化为空切片（前端如 `{#each view.searched}` 遇 `null` 会报错） |
| `NaN` / `Inf` 会让 `json.Marshal` 失败 | GV 统计在像素数为 0 时提前返回错误，不产生 NaN |
| 漏写 `json` tag 时输出 Go 字段名 | 每个返回体用 JSON 键集合单测兜底 |
| Rust `Option` 输出 `null` | Go 指针，不加 `omitempty` |

---

## 5. 实施阶段

每阶段完成后在 `docs/TODO.md` 顶部记录实际执行的检查与真实结果。

| 阶段 | 内容 | 验收 | 估时 |
|---|---|---|---|
| **0. 底座** | 新分支；安装固定版本的 Wails v2 CLI 与 Go 模块（需授权）；`main.go`/`app.go`/`wails.json`；窗口 1440×900、最小 1180×720；`internal/appdirs`；`src/lib/ipc.ts` | `wails dev` 打开现有界面；Tauri 版仍可运行 | 2 天 |
| **1. 数据层** | `appfiles`、`machine`（含 `net use`、reference 三级探测）、`sources`（含 AlignSpec 原文）；对应绑定方法 | 移植 `app_files.rs` 与 `machine.rs` 的单测；reference 机台排第一、只读；读出的 XML 原文与 Tauri 版逐字节一致；生产 XML 无写入 | 3 天 |
| **2. 图像层** | `imaging`、`median`（固定 MEDIAN、预览缓存、GV 测量、本地快照）、`layers`（全网格合成） | GV 统计与 Tauri 版完全相等；合成图与实机截图逐特征一致；AlignData 缺失时显示明确提示 | 4 天 |
| **3. TEACH 实机交互** | 删除 §3.3 前端功能；Align / ROI 节点 → 绿黄合成；AlignSpec 定位框（网格坐标）；Global / SR Align 从源数据读取；XY / RGB 状态栏；对照截图逐项核对 TEACH 面板 | 截图对比清单逐项通过；`npm run check` 0 错误 | 5–8 天 |
| **4. 收尾与打包** | 删除 `src-tauri/` 与 `@tauri-apps/*` 依赖；新 `build_app.bat`（Node + Go 版本检查、`npm run check`、`go vet`、`go test ./...`、`wails build -nsis`）；`.vfox.toml` 加 Go；更新 CLAUDE.md / README | 安装包可在无外网产线 PC 上安装（WebView2 引导程序随包）；冷启动与体积记录 | 2–3 天 |
| **合计** | | | **约 16–20 个工作日** |

打包说明：Wails v2 原生只生成 NSIS 安装包，不生成 MSI。若产线必须用 MSI，需另写 WiX 工程。

---

## 6. 不变量（重建中不得破坏）

- 生产 XML 永不写回：对 `PxInventory` / `PxRepository` 只允许读取、列目录、取元数据。
- 参数、NodeCheck、Load XML、定位框编辑都是会话修改；Reload 确认后丢弃修改并重新读取源 XML，失败时保留原会话数据。
- FM1/FM2 → TOP，BM → BOTTOM；主机 IP 派生 Vision：FM1 +1、FM2 +2、BM +3；UNC 用 `net use`，本地路径不登录。
- reference 机台 `id == "reference"`、排第一、只读、不写入 `machines.json`；源图缺失时显示 missing，不伪造图像。
- app-data 目录与 `machines.json`、`ui/*.json` 文件名、格式保持兼容；界面偏好可继续使用 localStorage（WebView 来源改变后会重置一次，可接受）。
- 大图只传预览，不经 IPC 传整张 TIFF。
- UI 如实显示未接入功能（REVIEW 无检测结果；对齐无成功判定）。

---

## 7. 风险

| 风险 | 等级 | 对策 |
|---|---|---|
| BOTTOM（BM 3.5）侧没有样本图 | 中 | TOP 跑通后取 BM 样本验证；格式预计相同（同一 MIL 软件写出） |
| `AlignSpec.xml` 中 `Type` 的语义、`Cell` 定位点（`CellNO="25"`，坐标超出单元网格）的坐标系未确认 | 中 | 先只还原截图中可见的 `Unit Type=0`；其余在 §8 中向用户确认 |
| 用户已存 ROI（`ui/roi-boxes.json`）是预览像素坐标 | 低 | 新版以网格像素存储，并在条目上标记坐标空间；旧条目按旧规则读取一次后换算 |
| WebView2 全屏、localStorage 重置等宿主差异 | 低 | Phase 0 实测；全屏如有问题改用 `runtime.WindowFullscreen` |
| 重建期间两套代码并存 | 低 | Tauri 版只读保留，不再加功能 |

---

## 8. 待确认

1. MEDIAN 固定的那张是否为 `Median_0_1_0.tif`？
2. 实机 TEACH 中 `Type="3"` 的定位点（AlignSpec Unit ID 0–3）在什么操作下显示？
3. Overlay 勾选项 `MK` / `A_C` / `I_C` / `SK` 分别对应什么数据？
4. 左侧条带单元图是否需要还原？数据从哪里来？
5. 是否需要 MSI 安装包？
6. 授权：新建分支，安装 Wails v2 CLI（`go install`）并下载 Go 依赖（`wails/v2`、`golang.org/x/image`、`golang.org/x/sync`）。
