# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


## 项目定位

AFVI 彩色检查机教学桌面软件：Tauri 2 + Svelte 5 runes + TypeScript + Rust。产品名为 Color AFVI Master Teach，Rust crate 为 afvi-parse。README.md 是当前功能入口，进度日志为 docs/TODO.md，界面设计为 docs/design.md。

## 根目录布局

- src/app/App.svelte：TEACH / REVIEW / CALIBRATE / SETTINGS 常驻面板，保持挂载以保留会话状态。
- src/app/components/CenterImage.svelte：中心 MEDIAN / Pattern 舞台、ROI、量尺、GV、Metal 与对齐；通过 src/lib/stage-api.svelte.ts 发布舞台能力。
- src/lib/service.ts：唯一 IPC 服务层和 XML 解析；组件经 appService 调用后端。
- src/lib/stores.svelte.ts：Svelte 5 全局响应状态、当前机台与型号、Connector、舞台和光源。
- src-tauri/src/lib.rs：只读 XML、图像、GV、对齐命令；新命令须注册 generate_handler 并在 service.ts 接入。
- src-tauri/src/machine.rs：MachinePaths、型号扫描、canonical_model_name、find_model_dir、UNC 凭据与 reference_machine。
- src-tauri/src/app_files.rs：app-data 中 JSON 文件读取与原子写入，拒绝绝对路径、盘符和父目录组件。
- src-tauri/src/align/：相位相关、ECC、基准点、合成案例与图层合成；src-tauri/examples/ 提供诊断入口。
- docs/：规格字典、对齐方案、界面设计、阶段记录。

## 数据与不变量

生产 XML 永不写回。选择机台和型号时从 PxInventory 实时读取，解析数据只留在会话内存中；参数、NodeCheck、Load XML 都是会话修改。Reload 确认后丢弃修改并重新读取源 XML，失败时保留原会话数据。

FM1/FM2 对应 TOP，BM 对应 BOTTOM。主机 IP 派生 Vision：FM1 +1、FM2 +2、BM +3。UNC 使用 net use 处理可选凭据；本地路径不执行网络登录。

reference_machine 按 AFVI_REFERENCE_DIR、可执行文件旁 reference/、编译时项目根 reference/ 顺序探测 FM1/PxInventory。reference 机台排第一、只读、不保存到 machines.json。没有有效选择时自动加载其首个型号。reference 无 PxRepository 时，图像 missing 或灰色 Pattern 回退属于源数据边界，不应伪造图像。

沿用原 Tauri app-data 根目录，保留 machines.json、ui/roi-boxes.json、ui/gv/<machineId>/<model>.json、ui/teach-selection.json、ui/active-selection.json。图像、composite 与对齐 case 的 app-cache 路径及行为保持不变。界面展示偏好仍可使用 localStorage。

## 开发与验收

.vfox.toml 固定 Node 24.11.1、Rust 1.91.1；build_app.bat 从根目录执行。

```powershell
# 项目根目录
npm run check
npm run build
npm run test:light
npm run tauri dev
npm run tauri build
.\build_app.bat check

# src-tauri/
$env:RUSTC_WRAPPER = '' # 仅在 sccache 不可用时
cargo check --offline
cargo test --lib --offline
cargo run --offline --example aligndata_identity
```

## 工作约定

保持现有用户改动，禁止通过还原文件覆盖。遵循 Svelte 5 runes 与现有风格，不为功能删减改动无关布局。UI 必须如实显示未接入功能（REVIEW 当前无检测结果）。大图仅传预览与结果，不经 IPC 发送整张 TIFF。

阶段记录写入 docs/TODO.md 顶部，使用「阶段 / 状态 / 交付」表，只记录实际执行的检查及真实结果；源图缺失写明 blocked by source。reference/、firebase.store.txt 仅本地保留且不进入 Git。
