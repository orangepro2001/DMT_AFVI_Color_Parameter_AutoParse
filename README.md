# AFVI 彩色检查机教学软件

Color AFVI Master Teach 是基于 Tauri 2、Svelte 5 和 Rust 的 Windows 桌面教学软件。它从 FM1 / FM2（TOP）与 BM（BOTTOM）的 PxInventory 实时读取 XML，在内存中解析光源、检测节点与参数，不改写生产设备文件。

## 功能

- **TEACH**：显示 Unit / Dummy、Light、Align/ROI 节点与 Master / Submaster / Inspection 参数；中心舞台查看 MEDIAN 或 Pattern，支持缩放、平移、ROI、量尺、灰度统计、Metal 叠加与对齐教学。
- **REVIEW**：呈现缺陷列表与预览区域；当前没有接入检测结果，列表为空。
- **CALIBRATE**：切换 Light 和 RGB 通道、调整教学光源、预览亮度、录入并保存 GV 实测值。光源调整只影响教学显示。
- **SETTINGS**：型号选择、机台共享路径配置、图像与对齐设置、教学参数编辑。型号选择实时读取 XML；Reload 重新读取源 XML。参数值、NodeCheck、Load XML 的修改仅本次会话有效；有会话修改时 Reload 会要求确认丢弃。

左侧 Connector 选择当前机台与 Vision（FM1 / FM2 / BM），Model 打开型号列表。扳手打开实机配置教学面板，其配置仅本地展示。对齐案例生成、相位相关、ECC、基准点校验和步骤查看位于图像与对齐设置中，无独立顶级对齐标签。

## 离线 reference

机台网络不可达时，准备以下本地数据即可读取参数：

```text
reference/
  FM1/PxInventory/
    LIGHT_SPEC/<model>/LightSpec.xml
    INSPECT_SPEC/<model>-00/TOP/LIGHT0/InspectionSpec.xml
    INSPECT_SPEC/<model>-00/TOP/LIGHT1/InspectionSpec.xml
    INSPECT_SPEC/<model>-00/TOP/LIGHT2/InspectionSpec.xml
    SpecParameter.xml
    SpecTreeNode.xml
  FM2/PxInventory/  （结构同 FM1）
  BM/PxInventory/   （检测面目录为 BOTTOM）
```

查找顺序为环境变量 **AFVI_REFERENCE_DIR**、可执行文件旁的 **reference/**、编译时项目根的 **reference/**。每个候选必须包含 FM1/PxInventory；发现后增加只读机台 **Reference (offline)**，排在机台列表首位且不写入 machines.json。启动时若当前选择不存在或无法加载，自动选择 reference 扫描到的第一个型号。

```powershell
$env:AFVI_REFERENCE_DIR = 'D:\AFVI\reference'
npm run tauri dev
```

三个 Vision 的同型号 XML 都需可读。字典从 PxInventory 根读取。reference 可不含 PxRepository：此时图像显示明确的 missing 提示或灰色 Pattern 回退，不影响 TEACH 参数。若需真实图像教学，可另行准备对应 PxRepository 的 MEDIAN、GB / L01 或 AlignData TIFF。

**reference/** 与 **firebase.store.txt** 仅在本地保留，不进入 Git；它们不是启动必需的远程服务配置。

## 本地文件与图像缓存

配置仍位于 Tauri 的 app-data 根目录，Windows 默认是 `%APPDATA%\com.afvi.parse`，与原本地 JSON 路径一致。

| 文件 | 用途 |
|---|---|
| machines.json | 用户机台路径及可选 UNC 凭据，不包含 reference |
| ui/roi-boxes.json | 按机台、型号与图像标识保存的 ROI |
| ui/gv/<machineId>/<model>.json | GV 实测值 |
| ui/teach-selection.json | TEACH Host / Light / 节点 / 色彩位置 |
| ui/active-selection.json | 当前机台与型号 |

JSON 通过 read_app_file / write_app_file 读写；写入自动创建父目录，使用同目录临时文件后 rename。型号 XML 每次加载直接从 PxInventory 读取，解析后只保存在会话内存中。切换标签和返回已加载型号可保留会话修改，退出程序后消失。

MEDIAN TIFF 本地副本、预览 JPEG、composite 与对齐 case 继续使用现有 app-cache 目录。它们属于图像缓存，路径及淘汰逻辑不变。主题、当前标签、Connector Vision、扳手面板等展示偏好保留在 WebView localStorage。

## 目录结构

| 路径 | 内容 |
|---|---|
| src/app/ | Svelte 常驻标签与组件 |
| src/lib/ | IPC、XML 解析、全局状态、光源模拟、ROI 工具 |
| src/styles.css | 全局主题与样式 |
| src-tauri/src/lib.rs | XML、图像、GV、对齐命令 |
| src-tauri/src/machine.rs | 机台路径、扫描、UNC 凭据、reference 定位 |
| src-tauri/src/app_files.rs | 小型 JSON 文件读取与原子写入 |
| src-tauri/src/align/ | 合成案例、相位相关、ECC、基准点与图层合成 |
| src-tauri/examples/ | 图像与对齐诊断程序 |
| tests/light-simulation.test.mjs | 光源模拟测试 |
| docs/ | 规格、设计与 TODO 阶段记录 |
| package.json、vite.config.ts | 根目录前端配置 |

## 工具链与命令

使用 vfox 按项目 .vfox.toml 选择 **Node 24.11.1 / Rust 1.91.1**，Windows 需具备 Tauri 的 MSVC 与 WebView2 开发环境。已有 node_modules 时无需重新安装依赖；首次准备环境可运行 npm ci。build_app.bat 会核对固定版本。

在项目根目录：

```powershell
npm run check
npm run build
npm run test:light
npm run tauri dev
npm run tauri build
.\build_app.bat check
.\build_app.bat dev
.\build_app.bat
```

Rust 离线检查及测试（不下载新包，需要本机已有依赖缓存）：

```powershell
cd src-tauri
# 如当前环境不能使用 sccache：
$env:RUSTC_WRAPPER = ''
cargo check --offline
cargo test --lib --offline
cargo run --offline --example aligndata_identity
```

诊断程序需要可用 TIFF，输入要求见对应源码。发布产物在 src-tauri/target/release；安装包位于其 bundle 子目录。开发阶段、验收结果和源数据限制记录在 [docs/TODO.md](docs/TODO.md)。
