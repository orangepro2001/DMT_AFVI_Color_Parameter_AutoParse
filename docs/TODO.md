# TODO

## 2026-10-18 teach-imgui：原生迁移（Go + Dear ImGui）

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. core 移植 | done | teach-imgui/core：gray / rng / light / warp / align / defect 的 Go 版；58 个测试（TS 单测逐个移植 + RNG / 颗粒哈希逐位对照）；与 TS 在 reference 25fbo015-15 上 16 段摘要 0 差异，扭曲图与加噪缺陷图逐字节相同 |
| 2. 应用框架 | done | 面板注册、后台任务（每键 1 个在途 + 最新待办）、图像视图（缩放 / 平移 / 工具拖拽 / 叠加）、型号扫描与 AlignSpec、深浅主题、中英韩运行时切换、控件库、自测截图与交互断言 |
| 3. 三个页面 | done | 光照与 GV、对齐（结果与 Web 版逐数一致）、缺陷检出（含截断前绘制、幅度模式、噪声、相对阈值、探查、随机批量） |
| 4. 验收 | done | build.ps1 -Selftest：gofmt / vet / core 测试 / 静态 exe 6.82 MB / 自测 0 错误 6 截图；交互断言 6/6；i18n 三语 258 键齐全 |
| 5. 复审 | done | OpenCode DeepSeek（high）只读复审（第一次因读取模块缓存被拒中断，用户授权刷新额度后重跑）：并发 / 缓冲 / 坐标 / i18n 无问题；修复笔画启用复选框不刷新、视图类型切换与在途任务竞态、判定原因阈值与报告不一致、lastScale、计时无界增长、加载失败型号下标 |
| 6. 已知限制 | open | 纹理线性过滤；60 fps 持续重绘；仅 Windows 字体；未适配高 DPI；自测鼠标在视图层注入；reference 只有 1 个型号，未测多型号切换；对齐页参数变化按“自动执行”开关决定是否重跑（TS 版无条件重跑，与其标签矛盾）；C:\selftest-out 为一次误写的自测输出，需手动删除 |

本轮文件：teach-imgui/（go.mod、go.sum、README.md、build.ps1、14 个应用源文件、core/ 6 个源文件 + 4 个测试文件）、.gitignore、docs/TODO.md。

## 2026-10-18 teach-app 传统工控风格与浅色主题

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 主题与样式 | done | styles.css 重写为 Windows 2000 经典 / 工控风格：斜面按钮、凹陷输入、分组框蓝色标题条、经典滚动条 / 复选框 / 下拉 / 滑块，零圆角、无过渡动画滤镜，Tahoma + 宋体 12px，等宽状态栏；深色（夜间，默认）与浅色（经典灰）两套令牌；theme.ts + 顶栏主题选择，localStorage `teach.theme` 与 `?theme=`，切换不重载、无闪烁 |
| 2. 面板 | done | 叠加层改经典机器视觉纯色（OVERLAY）；直方图 / 热力图随主题重绘；视图背景随主题；缺陷表最多 300 行并提示；缺陷叠加层批量路径 + 视口裁剪 + 最多 200 个面积标注；缩放状态仅变化时写 DOM |
| 3. 验收 | done | npm run teach:smoke 10/10；npm run test:teach 59/59；无头 Edge 深 / 浅：圆角 / 过渡 / 动画 / 滤镜元素均为 0，主题切换约 3 ms 并持久化，直方图背景 黑→白，热力图重绘，13723 个连通域时表格 300 行、DOM 3731 节点，控制台 0 错误 |
| 4. 已知限制 | open | 未运行 tsc（无 node_modules）；未在真实 WebView2 exe 与高 DPI 屏上目测；teach-app/native 的 web 与 exe 未重建；切换语言仍会重载页面 |

本轮文件：teach-app/public/{styles.css,index.html}、teach-app/src/{theme.ts(新),main.ts,viewer.ts,ui.ts,light-panel.ts,align-panel.ts,defect-panel.ts}、teach-app/README.md、docs/TODO.md。

## 2026-10-18 teach-app 缺陷模拟增强与检出逻辑复核

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 复核 | done | reference 25fbo015-15 复现：Red1024 gain4 时 ROI 均值 200.9、65% 饱和，SR 局部 GV 134 上 +60 亮点仍检出；原因是余量 255−134 远大于 TH30，属于正确行为，但原模型在已截断 8 位图上叠加固定 ΔGV（不随光照变化，暗点画在 255 区会虚检）、只有绝对 TH、没有噪声、探查结果不看区域和连通域 |
| 2. 核心算法 | done | teach-core：截断前绘制（renderDefectPair）；幅度模式 absolute / relative / target；块形状、高斯边缘、颗粒；成像噪声 σ²=read²+shot×GV（仅测试图）；相对阈值 TH+Golden×%（教学近似）；blob 背景 GV / 有效 TH / 饱和像素；regionStats；ProbeReport 改为区域 + 连通域判定；generateRandomDefects |
| 3. 面板 | done | 亮块 / 暗块、幅度 / 轮廓 / 颗粒、拖拽设半径、笔画启用开关、随机批量、成像噪声、Rel %、base 区域、饱和警示、余量解释；渲染与检出分开标记 dirty，并修复渲染期间新增笔画被丢弃的竞态；调参不再复位视图 |
| 4. 验收 | done | npm run test:teach 59/59；npm run validate:teach all checks passed；npm run teach:smoke 10/10；无头 Edge + CDP 实测缺陷页：画块、随机批量、相对幅度、噪声、禁用笔画、探查均生效，控制台 0 错误；reference 对比：饱和 metal 上的暗点，旧逻辑检出 1 个，截断前绘制后为 0 |
| 5. 已知限制 | open | 本机无 node_modules，未运行 tsc 类型检查；Margine、Offset1/2、Pad Offset、Block Offset 仍未模拟；teach-app/native 的 web 与 exe 未重建 |

本轮文件：teach-core/src/{defect,light,index}.ts、teach-core/tests/defect.test.ts、teach-core/README.md、teach-app/src/{defect-panel,worker,protocol}.ts、teach-app/README.md、docs/TODO.md。

## 2026-10-18 teach-app i18n（中/EN/KR）与 Windows 原生壳

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. i18n | done | teach-app/src/i18n.ts（zh/en/ko，各面板自注册词典，顶栏语言选择，localStorage 记忆 + ?lang=）；main/light/align/defect 全部界面串接入；机台参数名、材料代码、ROI 名、OK/MANUAL 保持原文 |
| 2. 原生壳 | done | teach-app/native/main.go：Go + go-webview2（纯 Go、离线模块缓存构建），go:embed 剥离后的前端，单 exe 7.5 MB，运行时无需 Node；固定端口 51780 保证语言记忆；--serve 供自动化 |
| 3. 验收 | done | npm run teach:smoke 10/10；npm run test:teach 47/47；npm run teach:native 构建成功；go test 通过；exe --serve + 无头 Edge：三语三页均 ready，en/ko 无中文残留（仅语言选择项“中文”），语言选择重载后保持，控制台 0 错误；窗口模式实际启动 WebView2 窗口并加载型号，关闭窗口进程退出 |
| 4. 已知限制 | open | 切换语言会重载页面（会话中的笔画/ROI 丢失）；ko 部分措辞待母语校对（如“밝음 점”）；exe 未签名、无图标；固定端口被占用时回退随机端口，语言记忆不跨该次启动 |

本轮文件：teach-app/src/i18n.ts（新）、main.ts、light-panel.ts、align-panel.ts、defect-panel.ts、public/index.html、public/styles.css、teach-app/native/{main.go,main_test.go,go.mod,go.sum}（新）、teach-app/scripts/build-native.ts（新）、teach-app/README.md、package.json（teach:native）、.gitignore（native/web、native/dist）。

## 2026-10-18 教学核心 teach-core 与浏览器前端 teach-app

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 核心算法 teach-core | done | gray / tiff / rng / light（反射率可调）/ warp / align / defect 零依赖 TS；npm run test:teach：47/47 通过 |
| 2. 浏览器前端 teach-app | done | Node 静态服务 + Worker + WebGL2；光照→GV、扭曲对齐、手绘亮暗缺陷三页；npm run teach 启动于 127.0.0.1:5178 |
| 3. 验收 | done | npm run teach:smoke：10/10 通过；无头 Edge 实测：光照拖框测 GV、调光自动重测、材料图切换；对齐无扭曲 OK（平均误差 0.27 px），强扭曲降为 MANUAL；SR 亮点检出；控制台 0 错误 |
| 4. 已知限制 | open | 角部 ROI 的 NCC 热力图有边缘裁剪空白；__teach.runAlign 拟合值为工作分辨率；teach-core 对齐唯一性 minSep 未修；未测多型号切换与长时间手绘 |

本轮文件：teach-core/、teach-app/、package.json（新增 test:teach、validate:teach、teach、teach:smoke 脚本）、MIGRATION_PLAN.md、docs/TODO.md。

## 2026-10-17 纯教学软件重构

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 后端瘦身与文件兼容 | done | machine.rs 移植扫描、凭据及测试；app_files.rs 沿用 app-data 根目录，增加路径校验与原子写入；移除外部领域依赖和远程存储实现 |
| 2. 实时参数与离线机台 | done | read_model_sources 实时读取；reference 自动定位并只读合并；启动回退首个型号；参数与 Load XML 仅保留会话修改 |
| 3. 界面、脚本与文档 | done | 型号选择、移除旧入口、根布局构建脚本、中文使用说明及设计资料清理；保留已有中心舞台与 ROI 改动 |
| 4. 前端验收 | done | npm run check：0 errors / 11 warnings；npm run build 通过；npm run test:light：6/6 通过 |
| 5. Rust 离线验收 | done | cargo check --offline 通过，仅既有 template_point unused assignment 警告；cargo test --lib --offline：99 passed / 1 ignored；包含路径校验、原子覆盖、Windows 本地规范路径、扫描和实时 XML 读取 |
| 6. 残留与运行边界 | done with source limit | 限定源码残留搜索无匹配；实际 reference XML 服务验证通过，覆盖三个 Vision / 三组 Light、并发去重、会话保留、Reload 更新及失败保留；reference 只有 XML，彩色图像仍需真实 TIFF，未做原生窗口目检 |

本轮文件清单：

- 根目录：CLAUDE.md、README.md、build_app.bat。
- 后端：src-tauri/Cargo.toml、Cargo.lock；src/lib.rs、src/machine.rs（新增）、src/app_files.rs（新增）、src/align/mod.rs、src/align/overlay.rs；删除 src/storage.rs。
- 诊断：src-tauri/examples/align_overlay_check.rs、aligndata_identity.rs、aligndata_resolve_check.rs、inspect_masks.rs、median_metal_check.rs（只改文档或输出路径）。
- 前端：src/lib/service.ts、stores.svelte.ts；src/app/App.svelte；components/CalibrationLight.svelte、CenterImage.svelte（仅旧注释）、DataCollection.svelte、MachineManagement.svelte、MachineSettingsOverlay.svelte、ModelPickerDialog.svelte、ParameterConfig.svelte、Settings.svelte、SettingsPanel.svelte；删除 src/lib/document-store.ts、src/app/components/DatabaseSettings.svelte。
- 文档：docs/05_ALIGN_DEV_PLAN.md、07_ALIGNDATA_OVERLAY_PLAN.md、10.5_GV_MEASURE_BRIGHTNESS.md、ALIGN_OVERLAY_DEV_NOTES.md、Align_DEV_Idea.md、SETTINGS_HIDDEN_ENTRIES.md、SPEC_REFERENCE.md、TODO.md、design.md。

附加差异检查：build_app.bat 的 git diff --check 通过；较早的限定目录检查报告原有 src/styles.css:193 文件末尾空行，该文件未在本轮修改。

后续条目均为历史记录，其构建与目检结果不代表本轮验收。

## 2026-10-15 当前 Vite/Tauri 窗口复现：Metal 仍为灰 Pattern

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 直接检查现有窗口 | done | 当前型号 `25FBO015-15`、Metal 节点、ROI 工具均正常；Metal/SR 点击后均显示灰 Pattern |
| 2. IPC/前端路径核对 | done | 确认不是浏览器 IPC 问题；现有 `stageMode -> loadPattern -> alignLoadOverlay` 路径已执行 |
| 3. 数据源定位 | blocked by source | 本地 reference 无 TIFF，配置机台路径未提供可解析的 AlignData 或 GB/L01 源；后端按契约 fallback 灰图 |

下一步前提：为当前 配置机台提供可访问的 `AlignData\\SR.tif` + `Metal.tif`，或 `GB\\Pattern.tif` + `L01\\UNIT_0.tif`；然后在现有窗口刷新/重载型号即可验收彩色合成图。

## 2026-10-15 Metal 点击显示绿 SR + 黄 Metal 合成图

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 项目路径与历史产物审计 | done | 确认 Rust `align_load_overlay` / `compose_identity` 已实现；选模型后台预加载，Metal 树节点切换到 pattern 结果；本地 identity 合成图可见 |
| 2. 原生容器复现 | done with runtime limit | 旧 `afvi-parse.exe` 被占用且当前本地 reference 无 overlay TIFF；旧窗口点 Metal 显示灰 fallback。隔离 target 新后端构建成功，未强杀旧进程 |
| 3. 断点修复与验证 | done | `aligndata_identity` 成功写出绿 SR + 黄 Metal；`cargo test --lib` 89 passed / 1 ignored；确认代码路径无需新增合成器 |

结论：`ParameterConfig Metal -> stageMode=pattern -> CenterImage.loadPattern -> appService.alignLoadOverlay -> Rust align_load_overlay` 已是现有直接路径，且选模型后后台预载。要在运行窗口看到彩色图，需关闭/重启旧原生进程使用最新后端，并确保当前模型的 AlignData 或 GB/L01 图层源可访问；源缺失时既有设计会安全回退灰 Pattern。

## 2026-10-15 Align ROI 侧栏按实机排布

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 对照参考图与现有操作 | done | 确认实机约 94px 双列/40px 按钮；只映射现有 ROI 真实操作，不展示未接线的笔、列表、保存占位项 |
| 2. 调整工具栏布局 | done | 复用现有 `RoiToolPalette`，改为双列 40px 按钮；形状添加/擦除成对，指针置顶，清空入口靠底 |
| 3. 构建与界面验收 | done | `npm run check` 0 errors / 21 warnings；`npm run build`、`git diff --check` 通过；参考图裁剪确认栏宽与按钮比例 |

边界：实机截图还显示笔、列表/芯片、网格、保存等额外按钮；当前项目地图没有对应行为接线，暂不显示无操作控件。ROI 修改仍自动保存。

## 2026-10-15 实机 Align/ROI 的 Metal 节点绘框入口

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图与参考图审计 | done | 确认 Metal 树节点切换 pattern；确认 CenterImage 有持久化 ROI/Rust 对齐链路，定位主工具栏与 ROI palette 的入口断点 |
| 2. Metal 节点接入 ROI 工具 | done | 选中 TEACH 树 Metal（parent 1 / node 10）默认启用矩形并显示现有 ROI 工具栏；离开 Metal 恢复指针，复用 pattern ROI 存储键 |
| 3. 构建与交互验证 | done | `npm run check` 0 errors / 21 warnings；`npm run build`、`git diff --check` 通过；已核对 H5 教学模拟与树节点 pattern 是不同流程，运行态绘框目检待实际型号窗口 |

验收边界：已恢复树节点下画 Align 框入口。H5 的 MEDIAN+Metal 配准教学模拟与 Align/ROI 树的 pattern ROI 尚非同一端到端配准流程。

## 2026-10-15 同步 origin/main

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 检查远端与工作区 | done | `main` 落后 `origin/main` 1 个提交；本地未提交文件清单已确认并保留 |
| 2. 更新合并 | done | `--ff-only` 快进到 `ea7fbd0`；无冲突 |
| 3. 刷新地图与验证 | done | repomix 203 文件生成成功；`main` 与 `origin/main` 同步，原本地改动保留 |

## 2026-10-15 按实机截图 1:1 对齐 UI 与交互

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 截图测量与设计 | done | 逐区域量取历史实机参考图的行高/列宽/配色；确认 SR Align 无独立 Ov 栈，工具栏顺序与色环态 |
| 2. 右栏 Specification 对齐 | done | SR Align 静态标题 + Light 下拉（数值+三角+浮层）；删除误加的 Ov 复选框栈；Overlay 默认仅 MK；树列宽 43% |
| 3. 工具栏与外壳对齐 | done | 新增 detect/match/dots/defect/shape 图标；按截图重排工具栏；色块 + 三灯泡 + 四色环（Red 实心其余空心） |
| 4. 验证 | done | `npm run check` 0 errors / 21 existing warnings；`npm run build` 通过；`npm run test:light` 6/6；CDP 叠放比对通过 |

下一步：载入实际型号后在实机/实图下拉与色环选中态做最终目检。

## 2026-10-14 Connector 单机台 / 单 Vision 切换

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图、设计与风险 | done | 确认左栏入口、全局选择、图像服务和 TOP/BTM 切换链路；更新 `docs/design.md` 与本表 |
| 2. Connector 入口与共享单选状态 | done | 左栏入口打开 Connector；单选机台 + FM1/FM2/BM 并持久化；模型选择限定到当前 Connector |
| 3. 页面与数据源统一 | done | 中心图像/测量/Align/光源依 Connector 路由；移除页面 TOP/BTM 与重复 Host 选择；异步请求作废并区分缓存 |
| 4. 验证与地图 | done | `npm run check` 0 errors / 20 existing warnings；前端 build、`cargo check`、`cargo test --lib`（89 passed / 1 ignored）及 release 构建通过；FM2 路由专测通过；repomix 地图已刷新 |

## 2026-10-14 Choose Model Names 弹窗实机对齐

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图、截图与设计 | done | 确认弹窗当前误把 Product/Model 当作 Tab；记录 595×395px 结构、列宽、按钮和颜色目标 |
| 2. 组件结构与样式 | done | 固定 `Product - Model` 文本，列表展示型号并留空 Resolution（2026-10-17 起由 PxInventory 读取），重排标题/说明/表头/列表/底部区域 |
| 3. 验证与地图 | done | `npm run check` 0 errors / 20 existing warnings，`npm run build` 通过，repomix 地图已刷新 |

## 2026-10-13 底部扳手设置面板精细还原

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图、截图与规划 | done | 确认扳手专用组件与七组/29字段；记录原始参考尺寸、间距、默认值及现有改动边界 |
| 2. 面板实现 | done | 七组默认全展开、工具/搜索栏、左对齐紧凑属性表、小三角、灰色 Off 开关、正确默认值、焦点返回/循环及关闭时 inert |
| 3. 验证与交付 | done | 类型检查 0 errors / 22 既有 warnings；前端与原生构建、浏览器入口/搜索/折叠/编辑/持久化/键盘/深浅主题及多尺寸核验通过；项目地图刷新，临时页面和服务已清理 |

下一步：用户打开新版 `src-tauri/target/release/AFVI_Parse.exe`，点击左侧底部扳手查看还原后的设置面板。


## 2026-10-13 亮块 GV 偏低排查

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 核对与复现 | done | 已复现缓存命中把 230-GV 亮块测成 40-GV 背景；本地 TIFF 5860×4020 / 预览4096×2810确认尺寸错配 |
| 2. 修正与回归 | done | MEDIAN 从本地 TIFF 头发布真实尺寸；19 项 MEDIAN 回归及 6 项通道/增益回归通过 |
| 3. 验收与地图 | done | 类型检查 0 errors / 22 既有 warnings；前端与原生构建通过（release 4m22s），项目地图刷新 |

下一步：用户重新打开构建产物并重画 GV 框；该实图 WH 应为5860×4020，蓝框显示 GV 推算约239～240。

TDD 进度：Red done（第二次加载 40≠230）；Green done（三种加载路径均为230）；Refactor done（仅 MEDIAN 元数据加载及回归）；Verify done（19+6项回归、类型检查、原生构建与地图）。

## 2026-10-13 可复用 ROI 工具条组件 + GV 测量集成

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 组件设计 | done | `RoiToolPalette.svelte`：竖排 rail（指针 / 添加矩形·椭圆·多边形 / 删除矩形·椭圆·多边形 / 删除 ROI），全部按钮按 `enabled` 启用，默认全禁用 |
| 2. 工具模型 | done | `lib/roi-tools.ts`：RoiPaletteTool / RoiDrawTool / 分组 / 映射；`service.ts` RoiRect 增加 `shape`/`points`（向后兼容） |
| 3. Overlay 能力 | done | `RoiOverlay` 用 `tool` 取代 drawMode：rect/ellipse 拖绘，polygon 点击+右键闭合，erase 点删 |
| 4. GV 集成 | done | `CenterImage` GV 模式显示 rail 并全启用；paletteTool↔overlay 映射；stage-api 暴露 tool/setTool |
| 5. 验收 | done | `npm run check` 0 error（22 既有 warning）；`npm run build` 通过；一次性 Vite 预览页目检两态后清理 |
| 6. 一键清空 + 不残留 | done | 垃圾桶右键一键清空（含抑制 WebView2 菜单）；GV 选框改为临时：模式结束/切 Tab 即清空，避免与教学/配准框混用同一 key；画布绘制态抑制浏览器右键菜单 |

- 已知限制：椭圆/多边形 GV 目前取包围盒（后端仅支持矩形）；三个删除按钮暂映射同一 erase 行为。
- 后续：按用户说明在其它位置挂载本组件，并给出各自启用/禁用清单。

## 2026-10-13 右栏按 Tab 切换（Review / Calibrate / Settings 实机布局）

中间区（图标栏、画布、缩略图、状态栏、日志）在所有 Tab 下保持不变，只切换右栏内容。

| 交付 | 说明 |
|------|------|
| REVIEW 页签启用 | AppTab 增加 `review`；新增 `ReviewDefect.svelte`：`● Inspection - Defect` + Image/Merge ID/CH/Code/Size/Avr 表头 + 空列表 + 底部预览区（实机 1:1，暂无数据源故列表为空） |
| CALIBRATE 1:1 | `CalibrationLight.svelte` 重构为右栏形态：顶部标定图框 + `ON` 药丸 + Host/Page Index 头 + `Calibration - Light` 20 通道表（Brightness 滑条/Value/Angle/Color/ON-OFF）+ 底部 Auto/Reload/Save；原 GV 亮度表收进底部折叠区保留功能 |
| SETTINGS 风琴 | 新增 `SettingsPanel.svelte`：`型号选择`、`Machine Configuration`、`Image/Alignment`、`Teaching Parameters` 四个折叠分区（现状更新于 2026-10-17），内容仍是我们原有组件 |
| Image/Alignment 桥接 | 新增 `lib/stage-api.svelte.ts` + `ImageAlignSettings.svelte`：把 CenterImage 的图像/配准教学控制（显示、色调、ROI/GV、Metal 配准、案例实验）以访问器对象暴露给右栏，不再整屏覆盖中间 |
| ParameterConfig | 新增 `fullscreen` 属性：`showSettings+fullscreen=false` 时为右栏内联编辑模式（原整屏 settings-mode 保留） |

- 验收：`npm run check` 0 error（24 warnings 均为既有 a11y 提示）；`npm run build` 通过；本地 1420 逐页目检 REVIEW/CALIBRATE/SETTINGS 分区展开 正常，stage-api 桥接滑条/按钮生效。

## 2026-10-12 实机 UI 重构

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 地图与设计 | done | 刷新地图、确认 Tauri/Svelte 与原型、记录比例/假设/风险 |
| 2. 壳层与画布 | done | 品牌栏、导航、工具栏、缩略图、画布、状态和日志 |
| 3. Specification / Analysis 与 Settings | done | 双栏参数面板、教学调节归档、现有功能入口 |
| 4. 构建与交互/视觉验收 | done | 类型检查0错误；生产构建通过；1440×900、1920×1080、1180×720无页面溢出；深浅主题与交互通过 |
| 5. 收尾 | done | 最终Rust可执行文件构建通过；缓存测试页已清理，完成深浅主题对照，项目地图已刷新 |

下一步：按用户后续说明逐项调整机器控件与现有功能的对接。

### 本次验收记录
- `npm run check`：0 errors，22 warnings（既有 ParamTable、MachineManagement、SearchSelect 无障碍提示）。
- `npm run build`：通过。最终 `npm run tauri build -- --no-bundle`：通过（2026-10-13，release耗时4m06s，既有Rust unused_assignments警告1条）。
- 历史浏览器验收使用隔离的内存型号数据与缓存 MEDIAN/Overlay 图片；当前版本改为源 XML 实时读取。
- 1440×900：主画布607px高，右栏411.8px宽；1920×1080：主画布690.1px高，右栏549.1px宽；1180×720：无页面溢出。
- 参数输入 `-` → TEACH → Teaching Parameters：草稿仍为 `-`，aria-invalid=true；Escape恢复0.000。
- 主画布ROI拖绘 → Settings中Delete：框保留；返回TEACH按Delete：框删除。
- Light-2 / Green单选切换通过；功能导航打开后Escape关闭；缩放125%显示正确。
- Align / ROI实验seed改77 → TEACH → Image / Alignment：seed仍为77，组件状态保留。
- 暗/亮主题完成1920×1080对照，原始图片内容不随主题更改。

## 阶段 1: 主题基础设施 — done
- [x] styles.css: 变量扩展（--bg-elev/--tint-*/--row-*），dark 默认 + light 调色板
- [x] lib/theme.ts: 双调色板 + 生成 <style> 注入 + localStorage 持久化
- [x] main.ts: 挂载前 applyTheme（防闪暗）

## 阶段 2: 组件配色变量化 — done
- [x] 两轮主题配色映射，后续按组件维护 scoped 样式
- [x] 手工修正: Settings color:white、ParameterConfig 状态及确认栏、行名 JS 色

## 阶段 3: 启动目检 + 交互优化 — done
- [x] 亮色逐页目检: TEACH/CALIBRATE/SETTINGS 全部正常（浏览器 + 真实窗口）
- [x] WebView2 原地换肤不重呈现 → 切换 = 持久化 + reload；activeTab 跨重载持久化
- [x] "黑框"排查: 与 AFVI 应用无关（后端零外部进程调用），系机器后台工具控制台窗口

## 阶段 4: 收尾 — done
- [x] tauri build release（AFVI_Parse_0.1.0_x64-setup.exe / msi）
- [x] svelte-check 0 错误（30 警告均为既有 a11y 提示）
- [x] CDP 回归: dark→light→dark 三态计算样式全对，持久化正确

## 2026-10-13 教学光源独立叠加与 GV 联动

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 设计与地图 | done | 更新 design/TODO；刷新 repomix 地图；确认现有未提交 UI 不回滚 |
| 2. 共享光源状态 | done | stores 增加全局 ON、Host、Page、通道选择和三页独立通道值 |
| 3. Calibration 与工具栏 | done | 0..1024 输入校验；Page 灯泡独立开关；Red/Green/Blue/White 高亮；取消 Tab 限制 |
| 4. 中心图像与 GV | done | SVG RGB 混光；悬停/拖框 GV 使用合成增益；保留 ROI 交互边界 |
| 5. 验证与收尾 | done | npm check/build、cargo check/test、跨 Tab 手工验收、刷新 repomix |

### 验收场景
- OFF 显示原图且控件禁用，ON 显示叠加且控件可编辑。
- 0、1024、负数、超过 1024、非数字输入均不会污染共享状态。
- Page 1/2/3、Red/Green/Blue/White 和 GV 读数按设计独立联动。
- TEACH、REVIEW、CALIBRATE、SETTINGS 中可见的顶部工具栏均可点击。

### 本次验证
- `npm run check`：0 errors，22 existing warnings。
- `npm run build`：通过。
- `cargo check`：通过，保留既有 `template_point` unused assignment warning。
- `light-simulation` Node self-check：通过，覆盖 OFF、三色、White、范围和 GV 换算。

## 2026-10-13 RGB 通道灰度与彩色显示修正

| 阶段 | 状态 | 交付 |
|------|------|------|
| 1. 需求与设计 | done | 参考实机截图和远程彩色视图；记录视图/White 区别及 GV 裁剪风险 |
| 2. 通道投影与工具栏 | done | Red/Green/Blue 灰度，第四按钮 RGB；显示状态独立于 White 光源 |
| 3. GV 联动 | done | 所选通道与 RGB 统计一致，直方图处理饱和，切换后立即重算 |
| 4. 回归与地图 | done | 6 个前端回归、3 个 Rust 测量测试、原生构建与界面验收；刷新地图 |

### 本次修正验收
- `npm run test:light`：6/6 通过，覆盖 R/G/B 灰度、RGB、White、Page 独立、OFF、SVG/读数一致以及饱和统计。
- `cargo test --lib gv_stats`：3/3 通过，验证 ROI 全图、越界裁剪与直方图分布。
- `npm run check`：0 errors、22 条既有 warnings；`npm run tauri build -- --no-bundle` 通过，生成 `src-tauri/target/release/AFVI_Parse.exe`。
- 隔离浏览器 fixture 的同一像素：Red `(200,200,200)` / Green `(150,150,150)` / Blue `(100,100,100)` / RGB `(200,150,100)`；悬停均值/标准差与显示一致。
- 同一拖框缓存切换 Red / Green / Blue / RGB：GV 均值分别为 227.50 / 202.50 / 150.00 / 203.99；对应标准差为 27.50 / 52.50 / 50.00 / 44.74。
- REVIEW / CALIBRATE / SETTINGS / TEACH 均可切换显示通道，OFF 禁用光源输入，Reload 恢复初值；临时 fixture 与测试服务器已清理。
- 历史原生程序已验证 Red 灰度与 RGB 合成颜色，相关截图不随仓库保留。
