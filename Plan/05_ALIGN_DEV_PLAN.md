# AFVI 离线对位（Align）模拟工具 — 开发计划与节奏

> 设计依据：[`Align_DEV_Idea.md`](Align_DEV_Idea.md)（技术设计方案 v2，教学型工具定位）。
> 本文件把设计方案转化为**可执行的里程碑、节奏与验收**；技术原理、算法分层、UI 细节
> 一律看设计文档，本文件不重复。
> 前置状态：Center-stage MEDIAN 查看器已上线（[`10.4.txt`](10.4.txt)，TOP=FM1 `2.0` / BTM=BM `3.5`）。

| 文件 | 角色 | 状态 |
|---|---|---|
| [`Align_DEV_Idea.md`](Align_DEV_Idea.md) | 技术设计 v2（需求定位 / 算法 / 架构 / 教学模块） | 已评审 |
| `05_ALIGN_DEV_PLAN.md`（本文件） | 开发计划：里程碑 / 节奏 / 决策 / 风险 / 验收 | 执行中 |
| [`10.4.txt`](10.4.txt) | 前置：Center-stage MEDIAN 图查看器 | **已实现** |

---

## 1. 目标（一句话）

在现有 AFVI_Parse 应用内新增 **ALIGN 页签**，以同一 Rust 内核支撑三种外壳——
**① 模拟/仿真（一键跑完）、② 教学演示（单步+讲解）、③ 练习/考核（出题+评分）**，
完全离线，不联真机。

## 2. 现状盘点（2026-10-04）

**已有（可直接复用）**

| 资产 | 位置 | 对 Align 的价值 |
|---|---|---|
| MEDIAN tif 路径解析 + 版本回退 | `src-tauri/src/lib.rs` `resolve_median_tif` | Template/Input 取图链路照此扩展 MasterData |
| 大图解码串行闸 + 4096px 预览 + JPEG/base64 | `MEDIAN_DECODE_GATE` / `decode_median_preview` | IPC 不传大 buffer 的既有范式 |
| 前端缩放/平移查看器 + LRU 缓存 | `CenterImage.svelte`（scale 1–10x、wheel/drag） | 对位叠加画布的底座 |
| 机器/模型选择、`PxRepository` 派生路径 | `stores.svelte.ts` / `service.ts` `deriveHostPath` | ALIGN 页签直接复用 |
| Tauri 命令注册 + `spawn_blocking` 模式 | `lib.rs` `invoke_handler` | 新命令照抄既有模式 |

**缺口（本计划要补）**

- 零对齐算法代码；图像栈仅 `image 0.25`（tiff/jpeg），无 rustfft / imageproc / nalgebra。
- 无金字塔/瓦片设施（当前靠后端一次性降采样，对"教学看中间产物"不够）。
- 无 ALIGN 页签；无案例库/生成器/评分器。

## 3. 范围

**In scope**
- 离线对位模拟全管线：预处理 → 相位相关粗对齐 → 精对齐 → 校验 → 补偿 → 判定。
- 合成数据生成器（真值注入）与案例库；失败模式教材；出题/评分。
- ALIGN 页签 UI：结果面板、叠加查看、单步拆解、手动对位练习。

**Out of scope（另行决策）**
- 联真机、写回生产数据（本工具与产线物理隔离，零副作用）。
- Gerber/ODB 自渲染 MasterData（用 PxRepository 现成渲染图；若 M0 spike 发现没有，退化为"已对齐 MedianImage 当理想底图"，设计文档 §2 已允许）。
- P5 深度学习兜底（SuperPoint/LoFTR）：列入 backlog，不排期。

## 4. 关键决策

### 已定
| # | 决策 | 说明 |
|---|---|---|
| D1 | **M0–M2 纯 Rust**（rustfft + imageproc + nalgebra），算法全部封在 `trait Aligner` 后面；**M3 启动时做 spike 复评**：ECC 自实现 vs 引入 opencv crate vs 金字塔相位相关加强——spike 结论落盘后才动工精对齐 | 用户拍板"M3 再决策"；纯 Rust 保证教室机零构建依赖、源码可教学；trait 留替换口 |
| D2 | ~~UI 挂现有 app 新增 ALIGN 顶级页签~~ **2026-10-04 修订（用户拍板）**：不设 ALIGN 顶级页签；入口复刻真机——TEACH 树 **Align/ROI 的 align 节点（Metal，parent id 1）** 点击后中央舞台切换显示 GB Pattern.tif（预加载、点开零延迟），点其他节点回到 MEDIAN。`AlignWorkbench` 已删除，后端命令与 align 模块保留 | 增量最小；教室独立部署由 M7 打包解决，无需拆应用 |
| D3 | IPC 只传路径/结果/预览 JPEG，**不传整图 buffer**（沿用 median preview 范式）；瓦片/自定义协议推迟到确有性能问题再做 | 194 MP 铁律；当前 4096px 预览 + 前端 transform 够用 |
| D4 | 所有随机走 **seeded RNG**；案例 = `seed + 参数`，跨机器可复现 | 出题/补考/回归一致性的根基 |
| D5 | 对齐**只在降采样层算**，全分辨率仅用于可视化与 ROI 精修 | 设计文档 §9；性能与内存护栏 |
| D6 | MasterData 缺失不报错（对齐 `resolve_median_tif` 的 `Missing` 语义），生成器可用已对齐 MedianImage 作理想底图 | 教学数据集不依赖 Gerber 渲染链 |
| D7 | **2026-10-05 M3 spike 拍板：(a) 纯 Rust 自实现 ECC**（Gauss-Newton 相似变换 4 自由度）+ 相位相关粗初值 + 两级金字塔（1/4→全分辨率，吸收方案 (c) 的粗层思想）为精对齐主干。(b) opencv crate 排除——Windows 需 OpenCV+LLVM 构建链违背 D1 教室零部署约束、源码黑盒教学价值低；(c) Fourier-Mellin 单独作主干精度不足（~0.1–1°），降级为金字塔粗层保留在管线内。验收阈值随之定为：**平移 ≤0.5px、θ ≤0.1°、scale ≤0.2%**（合成案例） | `align::ecc::EccAligner`，`trait Aligner` 第二实现，"ecc" 命令分支 |

### 待确认（不阻塞 M0/M1，按里程碑节点拍板）
| # | 问题 | 默认取值 | 拍板时点 |
|---|---|---|---|
| Q1 | MasterData 在 PxRepository 的实际形态（目录名/文件命名/是否带 µm-per-pixel 元数据） | **2026-10-04 现场确认（部分）**：Gerber 渲染叠加图在 `PxRepository\<Model>\<version>\Line\<Top|Bottom>\Layer\GB\Pattern.tif`（TOP=FM1 2.0 / BOTTOM=BM 3.5，版本回退同 MEDIAN）；`resolve_pattern_tif` + `align_load_pattern` 已落地，ALIGN 页签进入即预加载。目录/元数据其余形态待补确认 | 已部分拍板 |
| Q2 | 教学降采样数据集（2K 级 FOV 单元）取哪些机型/板块 | 每侧 1 个规则板 + 1 个 BGA 板 | M1 结束 |
| Q3 | 练习评分三档阈值（平移 px / 角度 deg / 尺度 %） | 优秀 ≤0.5px·0.05°；合格 ≤2px·0.2°；其余 NG（可调） | M6 启动前 |

## 5. 里程碑与节奏

> **节奏形式：阶段制。** 不排日历日期，一次只推进一个里程碑；预估为**净开发日**
> （含编码与单测，不含联机调试——本工具不联真机）。总计约 **23–31 净开发日**。
>
> 固定节奏规则：
> 1. 每个里程碑以**可演示增量**收尾（能当场跑给人看，不是"代码写完了"）。
> 2. 自 M1 起，**案例库回归（`cargo test`）是每个里程碑收尾的固定验收项**——生成器产出的带真值案例就是全项目的回归锚点。
> 3. 大图铁律贯穿始终：194 MP 不整图进 IPC；对齐只在降采样层算（D3/D5）。
> 4. 里程碑内先做后端算法 + 单测，再接前端；UI 不阻塞算法（先用命令行/测试出结果）。

| 里程碑 | 设计阶段 | 主题 | 预估 |
|---|---|---|---|
| M0 | P0 | 数据地基与脚手架 | 2–3 天 |
| M1 | P0.5 | ★ 合成数据生成器（真值注入） | 2–3 天 |
| M2 | P1 | 相位相关 MVP（全局 tx,ty 亚像素） | 3–4 天 |
| M3 | P2 | 精对齐 + 叠加可视化（**含技术栈决策 spike**） | 4–5 天 |
| M4 | P2.5 | ★ 管线单步拆解 UI（教学演示） | 3–4 天 |
| M5 | P3 | 相似变换 + 基准点校验 + 置信度 | 3–4 天 |
| M6 | P3.5 | ★ 失败案例教材 + 出题/评分 | 4–5 天 |
| M7 | P4 | 打包与教室部署 | 2–3 天 |

### M0 — 数据地基与脚手架（2–3 天）

**目标**：数据链路探明、代码骨架立住，后续里程碑往里填肉。

- 后端：新增 `align` 模块（`align/mod.rs` 定义 `trait Aligner` 与 `AlignResult`）；`AlignCase` JSON schema（template/input 路径、truth、参数、seed、案例版本号）；扩展 `resolve_median_tif` 模式支持 MasterData 路径解析（Q1 spike 的产出决定实现）。
- 后端：尺度/坐标系归一化——读取两侧分辨率元数据，按物理单位（µm/px）对齐像素网格（设计文档 §5.1：能靠数据准备解决的交给数据）。
- 前端：`appStore.activeTab` 新增 `ALIGN`；`AlignWorkbench.svelte` 空页骨架（机器/模型选择复用现有组件）。
- 完成判据：
  - [x] ~~ALIGN 页签可打开并选中机器/模型~~（D2 修订：入口改为 TEACH 树 Align/ROI 节点，见 §4）；
  - [x] 能列出所选模型的 MasterData 与 MEDIAN 实际路径（缺失时明确提示，不异常）；
  - [ ] `AlignCase` schema 定稿并落文档；Q1 拍板。

  > 2026-10-04 执行：`align` 模块（`trait Aligner` + `AlignResult` + `AlignCase` v1 schema + `IdentityAligner` 占位）与
  > `align_probe_sources` 命令落地；前端 ALIGN 页签 + `AlignWorkbench.svelte`（机器/模型/侧选 + 探测结果面板）。
  > MasterData 解析按 D6 语义实现（found/missing，缺失不报错），候选布局
  > `Line\<Side>\Layer\MasterData` 与 `<version>\MasterData` 均探测、大小写不敏感；
  > **Q1 的实地确认仍待到现场跑一次探测**（布局可能有出入，届时把解析收紧为唯一布局）。

### M1 — 合成数据生成器（2–3 天）★教学/练习/自测的共同地基

**目标**：给定理想图 + 参数 + seed，产出 `(template, input, truth.json)` 三元组。

- 后端：`generator` 模块——几何变换（tx/ty/θ/scale）+ 光照增益/偏移 + 噪声σ + 模糊σ + 局部遮挡，全走 seeded RNG；案例库落盘（带版本号）；降采样教学集（2K 级 FOV 单元，Q2 拍板）。
- 命令：`generate_align_case`（spawn_blocking）；列出/读取案例。
- 前端：一键生成 + 双图预览 + truth 侧栏（默认可隐藏）。
- 完成判据：
  - [x] 同 seed 同参数 → 字节级可复现（单测）；
  - [x] UI 一键生成案例并排预览两张图；
  - [x] 案例库进入 `cargo test` 作为回归锚点（本条自此成为后续每个里程碑的固定验收项）。

  > 2026-10-05 执行：`align::generator` 落地——自写 seeded RNG（splitmix64 播种
  > xoshiro256** + Box-Muller，不依赖 rand crate，字节级复现契约不被三方升级破坏）；
  > 手写逆映射双线性 warp（教学可读，M4 直接展示）；退化链固定顺序
  > 光照→模糊→噪声→遮挡。案例库 `<app_data>/align-cases/<case_id>/{case.json,
  > template.png, input.png}`（PNG 保字节复现；case_id = 模型_侧_seed，重生成幂等）。
  > 命令 `align_generate_case`（base=median 默认/pattern；downsample=0 自动适配 2K
  > 工作网格，Q2 的"教学集降采样"由该参数承担）/ `align_list_cases` /
  > `align_delete_case`。前端：Align/ROI 视图工具栏「🧪 案例生成」抽屉
  > （`AlignCaseLab.svelte`）——参数表单 + 一键生成 + 双图并排 + 真值侧栏默认隐藏
  > 一键揭示（M6 出题的揭示门复用此交互）。`cargo test --lib` 40 通过
  > （新增 8：RNG 确定性、同 seed 字节复现、平移质心验证、退化链可观测、
  > 案例库往返/损坏容错等），`npm run build` 通过。

### M2 — 相位相关 MVP（3–4 天）

**目标**：真实跑通第一条算法路径：降采样层全局 (tx,ty) 亚像素 + PSR。

- 后端：`rustfft` 互功率谱相位相关（设计文档 §15.1 骨架）+ 抛物线亚像素 + PSR（峰值旁瓣比）；`trait Aligner` 第一实现 `PhaseCorrelateAligner`；命令 `align_run`。
- 前端：运行按钮 + 结果面板（tx/ty/PSR/耗时/OK-NG）+ 最小叠加查看（复用 center-stage 查看器）。
- 完成判据：
  - [x] M1 案例库全部**平移**案例：|误差| ≤ 0.5 px（降采样层）；
  - [x] BGA 周期案例**如预期暴露多峰错峰**——不修，记录为教学点（设计文档 §3）；
  - [x] `align_run` 全程不向 IPC 传整图。

  > 2026-10-05 执行：`align::phase::PhaseCorrelateAligner`——rustfft 2D FFT（行/列
  > 1D 规划器拼装）+ Hann 窗抑环绕 + 幅度归一化互功率谱（光照不敏感的根源）+
  > 抛物线亚像素 + PSR（峰值旁瓣比，11×11 排除窗）。**设计稿 §15.1 骨架的 1D FFT
  > 是示意，实现为正确的 2D 变换**。踩坑记录：抛物线分母（凹峰为负）曾被
  > `.max(1e-12)` 钳成正值导致亚像素爆到 1e15——分母只能判零不能钳正。
  > PSR 阈值 10 为默认 ok 门。命令 `align_run`（读案例库→跑对齐→真值对比，
  > 对比含 translation_only 标志——真值带旋转/尺度时残差含 M2 看不到的部分，
  > 前端标注"M3 解决"）。前端：案例抽屉新增「▶ 运行对位」+ 结果面板
  > （OK/NG 徽标、PSR、耗时、求解值、揭示真值后显示误差）+ 纯 CSS 红绿
  > anaglyph 叠加开关（对齐区域呈黄色，M3 三模式叠加的前奏）。
  > 单测 6 个：平移案例 ≤0.5px（3 seed）、增益/偏移不扰锁、退化拉低 PSR 至
  > ok 门之下、周期图案整周期偏移暴露歧义（PSR 崩 + 锁错或拒判，教学点）、
  > 派生案例误差 ≤ 旋转/尺度残余理论界、网格不匹配报错。

### M3 — 精对齐 + 叠加可视化（4–5 天）【技术栈决策点】

**目标**：拿下旋转/尺度；叠加模式让"对齐好坏"肉眼可见。

- **Spike（先做，≤1 天，结论落盘本文件）**：精对齐三选一——(a) 纯 Rust 自实现 ECC（平移+欧氏，Gauss-Newton）；(b) 引入 opencv crate（评估 Windows 构建链 + 教室离线安装代价）；(c) 金字塔多尺度相位相关 + 局部精修加强。拍板后动工。
- 金字塔多尺度管线（粗层定位 → 细层精修）；旋转/尺度场景处理。
- 前端：红绿立体 / 差异图 / 闪烁 三种叠加模式（canvas 合成）。
- 完成判据：
  - [x] 案例库含旋转/尺度案例误差达标（阈值随 spike 结论定：平移 ≤0.5px、θ ≤0.1°、scale ≤0.2%）；
  - [x] 三种叠加模式可用；spike 决策记录更新到 §4/§8。

  > 2026-10-05 执行：`align::ecc::EccAligner`——GN 相似变换（W 与生成器前向同式，
  > 解出即真值）+ 零均值/单位方差归一化（光照鲁棒）+ 每迭代记录 Pearson 相关
  > 曲线（M4 教学素材）+ [4,1] 两级金字塔。**两个真实踩坑（详见笔记 §14）**：
  > ①`solve4` 行交换写成标量交换（扁平数组 `a.swap(col,pivot)`）——主元消元
  > 从未真正执行，GN 被静默送上山；②二值锐利图像上中心差分梯度在双线性
  > warp 的整数折点处与真实单侧导数差数倍——GN 先平滑（σ=1）再求导解决。
  > 前端：求解器选择（ECC M3 / 相位 M2 对照）+ 结果面板含 θ/scale/相关系数
  > + 三模式叠加（红绿/差异/闪烁，纯 CSS）。「运行对位」默认 ECC。
  > `cargo test --lib` 53 通过（新增 7）、`npm run build` 通过。

### M4 — 管线单步拆解 UI（3–4 天）★"白盒化"是教学内容本身

**目标**：管线 stage 化，每步可停、可看中间产物、可分层讲解。

- 后端：`align_run_steps`——每个 stage 输出中间产物（灰度/CLAHE 图、频谱与互功率谱、峰值位置+PSR、迭代相关曲线、NCC 得分、warp 图），中间产物按预览尺寸降采样走既有 JPEG/base64 通道。
- 前端：步骤条（点哪步看哪步）+ 中间产物面板 + 分层讲解三档（🟢直觉 / 🟡数学 / 🔴代码）+ 真值揭示按钮 + 参数滑块实时反馈（改噪声/角度立即看 PSR 变化）。
- 完成判据：
  - [ ] 任意步骤可见其输入图/输出图/数值；
  - [ ] 三档讲解可切换；真值默认隐藏、一键揭示。

### M5 — 相似变换 + 基准点校验 + 置信度（3–4 天）

**目标**：从"平移正确"升级到"变换可信、结果带置信度"。

- 后端：MK 基准点（方形 pad/倒三角/十字）NCC 定位（imageproc `match_template`）；Umeyama 最小二乘求相似变换（nalgebra），N≥3 时 RANSAC 剔误匹配；置信度体系 = NCC 峰值 + PSR + 残差 RMS + **基准点距离一致性**（抓尺度错误的唯一指标，设计文档 §13.3）→ OK / 人工 / NG。
- 前端：基准点 overlay、各点得分表、置信度徽标；低置信度引导人工微调后重锁。
- 完成判据：
  - [ ] 尺度差案例被"距离一致性"指标抓出（纯平移法抓不到的那类）；
  - [ ] 三档判定输出且阈值可配置。

### M6 — 失败案例教材 + 出题/评分（4–5 天）★练习/考核闭环

**目标**：教学闭环 `出题 → 作答 → 评分 → 揭示 → 复盘` 全通。

- 失败案例教材：设计文档 §3 的 8 类失败模式（平移/旋转/尺度差/光照/噪声模糊/**BGA 多峰**/遮挡/通道选错）逐类一键加载，配教学点文案。
- 出题：生成器随机 seed 生成案例，truth 隐藏；学员手动对位（拖拽叠加图，复刻真机"画定位点"手感）或调参后提交。
- 评分：误差 = ‖求解变换 − 真值‖，按 Q3 拍板的三档阈值打分；手动模式实时残差反馈。
- 完成判据：
  - [ ] 8 类失败案例一键加载可用；
  - [ ] 出题→作答→评分→揭示→复盘全流程走通，评分与真值一致（单测）。

### M7 — 打包与教室部署（2–3 天）

**目标**：教室电脑双击即用、完全离线。

- Windows 单文件安装包（复用 `build_app.bat` / Tauri 打包经验）；预置教学数据集（M1 产出）；案例库带版本号。
- 完成判据：
  - [ ] 干净 Windows 机器（无 Rust/无运行时）双击安装可跑全流程；
  - [ ] 全程断网可用；学员操作零副作用。

## 6. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **MasterData 形态未知**（PxRepository 里可能没有现成渲染图或无分辨率元数据） | M0 归一化无法落地 | M0 spike 实地确认；D6 退化路径——已对齐 MedianImage 当理想底图，归一化改为"同源像素网格" |
| **ECC 纯 Rust 无成熟实现**（(a)/(c) 方案需自研迭代求解器） | M3 工期膨胀 | spike 限时 1 天先拍板；(c) 金字塔相位相关加强为保底方案，旋转场景可先覆盖欧氏子集 |
| OpenCV 构建链（若 M3 选 (b)） | Windows 需 OpenCV + LLVM，教室离线安装复杂 | 仅在 spike 证明自研不可行时才引入，且封在 `trait Aligner` 后 |
| 真实数据域差大，MVP 在真实图上效果差 | 动摇工具可信度 | 生成器案例（已知真值）+ 真实数据双轨验证；教学定位下"展示失败并讲解"本就是产品能力 |
| 194 MP 内存/解码耗时 | UI 卡死 | 沿用 `MEDIAN_DECODE_GATE` 串行化 + 降采样层对齐（D5）+ 异步 loading 态（既有约定） |
| 教学数据集体积 | 安装包过大 | 2K 级降采样 FOV 单元（设计文档 §12），案例 = seed+参数 可随需重新生成 |

## 7. 整体验收

- [ ] `cargo test` 全绿，其中 M1 案例库回归固定通过；同 seed 复现字节级一致。
- [ ] 三种模式可用：①一键模拟出 tx/ty/θ/s + 叠加 + OK/NG；②单步拆解 + 分层讲解；③出题 + 评分 + 揭示。
- [ ] 全程无整图 buffer 过 IPC；断网全流程可用。
- [ ] 干净机器双击安装包可用。
- [ ] `npm run build` + `cargo test` 通过，无新增硬编码路径（配置入 JSON/数据库，遵循项目既有规则）。

---

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-04 | 首版：依据 Align_DEV_Idea v2 制定；拍板 D1（M3 再决策技术栈）、D2（ALIGN 页签）、阶段制节奏 |
| 2026-10-04 | **M0 代码完成**：`align` 模块 + `align_probe_sources` + ALIGN 页签骨架；`cargo test`（23 lib）与 `npm run build` 全绿。剩余：Q1 实地拍板、AlignCase 文档定稿随 M1 生成器一并出 |
| 2026-10-04 | **Q1 部分拍板 + Pattern 预加载**：现场确认叠加图为 `GB\Pattern.tif`（2.0/3.5）；`resolve_pattern_tif` + `align_load_pattern` + ALIGN 页签进入即预加载（带 LRU 缓存，重进零延迟）；26 lib 测试全绿。另记录：大图加载慢，性能优化（缓存/瓦片）列入后续议题，不阻塞里程碑 |
| 2026-10-04 | **D2 修订（用户拍板）**：撤销 ALIGN 顶级页签与 AlignWorkbench（M0 判据第 1 条随之修订）；交互复刻真机——TEACH 树 Align/ROI 的 Metal 节点为入口，中央舞台经 `appStore.stageMode` 在 MEDIAN / GB Pattern 间切换；Pattern 与 MEDIAN 在选模型时并行预加载（各侧独立 LRU），点开零延迟。透明化+上色叠加列为后续议题（真机效果参考，工程复杂度待评估）。`npm run build` 通过 |
| 2026-10-04 | **入口排查 + 内存护栏**：实地核对本地快照确认树结构（Align/ROI parent id=1，Metal node id=10），代码路径正确，"点 Metal 无反应"最可能是运行了旧构建（需重启 dev/重装）；触发条件加固为 id=1 或父名含 "align" 双重匹配。内存：解码后全尺寸缓冲先于 base64 释放（gigapixel 条图峰值降约 1GB），前端 LRU 6→4（median+pattern 双缓存最坏 ~60MB 常驻）；Pattern 预览同样走 4096px 下采样。后续更大图的根治（瓦片/低分辨率 SubIFD 解码）记入性能优化议题 |
| 2026-10-04 | **彩色渲染可行性验证通过**：真机绿色 SR + 黄色金属视图 = 两张二值掩码上色合成——`GB\Pattern.tif`（白=SR 板面→绿，黑=线路/焊盘保持黑）+ `L01\UNIT_0.tif`（白=露铜→黄，叠在上层）。原型 `src-tauri/examples/align_overlay_check.rs`，效果图 `Plan/align_overlay_demo.png`。UNIT_0 路径已记录（TOP=FM1 2.0 / BOTTOM=BM 3.5）。集成方案：新增 `align_load_overlay` 命令在解码闸内合成 RGBA→JPEG 预览，替代 pattern 模式的单图显示 |
| 2026-10-04 | **合成对齐验证通过（基准点配准）**：两个渲染物理比例不同（UNIT_0=整机视野、板占中带 ~55%；Pattern=紧凑 Gerber、板占 ~92%），纯平移对不齐。用四角基准点十字质心作锚（机器自己的 align 标记）：bbox 清污（截图状态栏白字曾污染包围盒）→ TL/BR 两点对解 (scale, tx, ty) → ±8px IoU 精修。放大验证：BGA 黄环精确套住焊盘、角十字重合（残余 2-4px，为截图重采样误差）。真实 tif 若同网格则 identity 直通，配准仅作保险，亦是 M2 相位相关的先导验证 |
| 2026-10-04 | **真实 tif 终验通过（FM1 = \\\\192.168.1.61，经 afvi13 Tailscale 子网路由，共享名实际为小写 pxrepository）**：`GB\Pattern.tif` 与 `L01\UNIT_0.tif` 均 5860×4020 同网格。**图层角色实测定正（与先前假设相反）**：`L01\UNIT_0.tif` = SR 板面（白→绿底、黑走线），`GB\Pattern.tif` = 金属标记层（白→黄，即用户截图中的稀疏标记）。两层内容存在真实 ~25px（原尺度）偏移，配准必要；修掉配准 seed 的坐标系混用 bug（native vs 工作画布）后角十字同心、BGA 区精确落位，效果与真机 Align/ROI 视图一致（`Plan/align_overlay_demo.png`）。集成要点：`align_load_overlay` 在解码闸内双图解码→归一→基准点配准→RGBA→JPEG；稀疏掩码的 IoU 只能作排序不能作质量分 |
| 2026-10-04 | **理想化（二次处理）原型验证通过**：金属层显示前做轻量形态学补偿——闭运算实测会焊死 BGA 细走线间隙（3-5px），**剔除**；最终为纯膨胀 1px（工作网格 ≈4px 原生），标记更饱满、间隙全保。配准最终形态：bbox 裁剪 → 无界洪泛十字锚（包围盒中心，质心有窗口截断偏置）→ 几何 seed（TL/BR 平移取平均抵消贴边截断内偏）→ ±5px 基准窗 Dice 精修。已知边界：两层基准标记本就是不同设计（小对称标记 vs 长不对称开窗），"完美重叠"需真机成套渲染数据，交付判据为"同心 ±2px + 饱满 + 间隙完整"。**完整复盘文档：[`ALIGN_OVERLAY_DEV_NOTES.md`](ALIGN_OVERLAY_DEV_NOTES.md)**（含访问踩坑、全部弯路、集成蓝图）；`cargo test --lib` 全绿 |
| 2026-10-04 | **备选思路评估入档**：用户提出"在绿层上寻找 Pattern 涂黄"——评估结论：显示层不采纳（读法 A 修不了形状差、读法 B 会丢 BGA 走线，复杂度不成比例；dilate 1px 已达 1x 观感等效），但该思路本身即 M5 基准点 NCC 定位与 M2+ 对 MedianImage 匹配的机制原型，转入 M5 思路库存档。详见笔记 §10 |
| 2026-10-04 | **CV 强化路线评估入档**：用户追问能否"不依赖坐标、真正理解对应"——原理上 matching+transform 不可拆；本数据真对应只在标记中心层（两层是不同设计层的渲染）；可强化项 = Chamfer/距离变换匹配（集成时配准增强）+ RANSAC 多点对应（M5）；DL 语义对应（LoFTR 等）维持 P5 backlog 不排期。详见笔记 §11 |
| 2026-10-04 | **彩色叠加集成进 app（用户确认残余对齐瑕疵可接受、留待 M2/M3 对位管线解决）**：新增 `align_load_overlay` 命令——解码闸内双图解码→基准点配准→理想化（膨胀 1px）→彩色 JPEG，`align::overlay` 子模块全链 Result 化（缺 UNIT_0/找不到基准十字/形状异常自动回退灰 Pattern 预览，不报错）；前端 `alignLoadOverlay` 无缝换入原预加载链（CenterImage 缓存/交互零改动）。`cargo test --lib` 32 通过（新增配准恢复偏移/降级路径/合成语义等 6 测），`npm run build` 通过。完整记录：笔记 §8.1 集成实施记录 |
| 2026-10-04 | **overlay 首载性能修复**：用户实测首载过久——根因①合成解码排进 MEDIAN 串行闸（选模型瞬间 4 加载全串行）②两侧 overlay 都预加载抢带宽。修复：overlay 解码移出大图闸（层缓冲仅 ~24MB，非 gigapixel）+ 只预加载当前激活侧（切侧按需加载）。详见笔记 §8.1 |
| 2026-10-04 | **边缘对齐/大小/放大失真修复（用户放大实测反馈）**：①真 bug——两层各自 bbox 缩放到同宽，但包围盒边距不同导致**两层缩放系数差 6%**（配准 scale 0.9447 的真身），改为两层共用同一 master 缩放系数，相对几何严格保持；②工作分辨率 1400→**4096**（与 MEDIAN 预览同级，放大不再马赛克），全部标定参数按分辨率比例化；③退化守卫：锚点重合时 scale=∞ 会试图分配 12TB（测试揪出的生产 bug），加锚距/scale 合法性检查走灰图回退；④膨胀量 4096 网格重标定为 1px（细走线根根分明）。产物：`Plan/align_overlay_demo_d{0,1,2}.png` 三档对比；`cargo test --lib` 33 通过、`npm run build` 通过。详见笔记 §8.2 |
| 2026-10-04 | **渲染语义修正 + 板中心精修（用户实机对照反馈：黄标应在绿层对应部分里，黑=Open 不涂黄）**：①渲染改为**黄 = Pattern ∧ SR白**，Open 黑区永不涂黄、黄边自动跟随绿层几何；②语义修正暴露板中心错位实锤——角十字不对称设计的 bbox 偏置 → 全局 scale 微差 → 误差随离锚距离放大（板中心达半个 BGA 线距），新增 `refine_board` 全板 Dice 精修（1024 代理扫 5 档 scale × ±15px + 全分辨率收敛），实测走线落回白线；③测试夹具教训：合成层间偏移必须整体刚性平移。`cargo test --lib` 32 通过（4096 端到端用例标 ignore，真实数据由 example 覆盖）。详见笔记 §8.3 |
| 2026-10-04 | **横向尺寸补偿（用户实机对照："横向太短"）**：GB 层金属标记蚀刻后横向收缩 vs 实机标称渲染，且横纵不对称。理想化改**各向异性膨胀**（自写可分离 1-D 最大值滤波，imageproc 仅各向同性），真机数据标定 dx=4/dy=1（dx6 焊死线距、dx2 仍偏瘦），默认常量 `IDEALIZE_DILATE_X_PX=4`/`Y=1`。产物 `Plan/align_overlay_demo_dx{2,4,6}.png` 三档。按模型自适应推算 dx 记入 M5 思路。详见笔记 §8.4 |
| 2026-10-04 | **架构修正：统一坐标系 + 多区域局部配准 + 验收门（用户反馈"不同区域需要不同增益"）**：①真 bug——两层各自 bbox 裁剪后配准/渲染混用两个坐标系，改为**联合白色包围盒**统一帧；②新增 `refine_local`：3×3 探测 tile 各自 Dice 局部搜索（1/4 分辨率粗搜+全分辨率收敛）→ 逐轴最小二乘拟合残余 scale+平移（2.5×中位数离群剔除）；③**验收门**：候选必须使全板 Dice 严格优于基准点配准——实测该模型 tile 投票被周期性线距锁错（野值 (21,−35) 全板分更差）被正确拒绝，保留基准点配准+各向异性膨胀的组合。`cargo test --lib` 全绿。详见笔记 §8.5 |
| 2026-10-05 | **M1 合成数据生成器完成**：`align::generator`（自写 seeded RNG + 手写逆映射双线性 warp + 固定顺序退化链光照→模糊→噪声→遮挡）+ 案例库（`<app_data>/align-cases/<模型_侧_seed>/`，PNG 字节级复现，重生成幂等）+ 命令 `align_generate_case`/`align_list_cases`/`align_delete_case` + 前端「🧪 案例生成」抽屉（Align/ROI 视图内，双图并排 + 真值侧栏默认隐藏）。`downsample=0` 自动适配 2K 工作网格（Q2 的降采样教学集由生成时参数承担，具体机型选取仍待现场拍板）。真值可指定或由 seed 派生（case = seed + params 严格成立）。`cargo test --lib` 40 通过（新增 8）、`npm run build` 通过。**M1 验收三条全勾**，案例库自此为全项目回归锚点。下一站 M2 相位相关 MVP |
| 2026-10-05 | **M2 相位相关 MVP 完成**：`PhaseCorrelateAligner`（rustfft 2D + Hann 窗 + 互功率谱 + 抛物线亚像素 + PSR）+ `align_run` 命令（案例库读入→求解→真值对比，仅数字过 IPC）+ 前端运行按钮/OK-NG 结果面板/CSS 红绿叠加。平移案例 0.5px 达标；BGA 周期歧义按计划"记录不修"（PSR 是见证人）；踩坑：抛物线凹峰分母被钳正 → 亚像素 1e15。`cargo test --lib` 46 通过（新增 6）、`npm run build` 通过。**M2 验收三条全勾**。下一站 M3：技术栈 spike（ECC 自实现 vs opencv vs 金字塔加强，≤1 天结论落盘）+ 旋转/尺度 + 三种叠加模式 |
| 2026-10-05 | **M3 精对齐 + 叠加可视化完成（spike 拍板 D7）**：采纳 (a) 纯 Rust 自实现 ECC（GN 相似变换 4 dof）+ 相位相关粗初值 + [4,1] 金字塔；opencv 排除（违背 D1）、Fourier-Mellin 降级为粗层。验收阈值：平移 ≤0.5px / θ ≤0.1° / scale ≤0.2%，全部达标（含 4°/3% 超出派生范围的金字塔用例）。**两个高价值踩坑**：①solve4 扁平数组行交换写成标量交换 → GN 静默发散（数值求解器测试必须含"需主元"用例）；②二值图像中心差分在双线性 warp 整数折点处失真 → GN 先 σ=1 平滑再求导。前端：ECC/相位求解器选择 + 三模式叠加（红绿/差异/闪烁）。`cargo test --lib` 53 通过（新增 7）、`npm run build` 通过。**M3 验收两条全勾**。下一站 M4：管线单步拆解 UI（stage 化中间产物） |
