# 07 · AlignData Overlay 与 ROI 驱动对齐

日期：2026-10-12。背景：用户提供实机（6SG0504A、7M99-631 等多个 model）的 Align/ROI Overlay 截图，
并给出 7M99-631 的 `AlignData\Metal.tif / Open.tif / SR.tif` 三张层图，要求验证能否合成 Overlay，
并明确产品约束：**model 千奇百怪，不许抓固定规律；唯一可信的输入是用户画的 ROI 框（假设它正确）**。

## 1. 已验证事实（2026-10-12，examples/aligndata_check.rs + aligndata_identity.rs）

- AlignData 布局：`\\<host>\PxRepository\<model>\AlignData\{Metal,Open,SR}.tif`（另有 10_C.csv）。
- 7M99-631 三张 tif：**4890×4140、8-bit 灰度、三张同尺寸**；白色占比 Metal 2.45% / Open 6.11% / SR 66.02%。
- **三张层图共享同一网格**（白像素 bbox 几乎满幅：SR (5,5)-(4889,4139)、Metal (0,0)-(4889,4139)）。
  恒等合成（union bbox 裁剪 → 缩放 → SR 涂绿 / Metal 涂黄，零配准）与实机截图逐特征一致：
  左缘斜条纹、四角 fiducial、底边 pad 排、顶部双黄条全部就位 → `Plan/aligndata_identity.png`。
- **现有 `compose_overlay` 的角点十字配准在该 model 上配错**：黄色条纹内移约 12% 板宽、角点漂移
  （`Plan/aligndata_overlay_sr_metal.png`）。根因即用户警告的"固定规律"：cross_anchor 在
  TL/BR 角窗按行扫描找首个白色连通域，SR 这种 66% 白的大板体层在角窗里抓到的往往不是 fiducial；
  且整板瓦片精修 0 可用（`refine local: only 0 usable tiles`），错误无人兜底。
- 实机的 Overlay ≈ **恒等叠加 + 用户画的 ROI 矩形框**（截图中的细黄框），框选在特征丰富处
  （角点 fiducial、pad 群、条码/Mark），用于局部校准原本不重叠的部分。

## 2. 结论

- **AlignData 三张 tif 能合成 Align/ROI Overlay**——且不需要跨层配准（同网格直通合成）。
  `Open.tif` 为第三层（白 6.11%，SR 开窗层），可作显示第三色，非配准必需。
- 现有 `GB\Pattern.tif + L01\UNIT_0.tif` 路径上的 cross-anchor 配准**不能**作为通用方案推广；
  它是 25fbo015-15 上的校准特例。
- 跨层对齐的通用形态 = **ROI 驱动**：假设用户 ROI 正确（框内有两层共见的特征），
  每 ROI 求局部匹配 → 一致性拟合全局变换；ROI 之间不一致时如实报告，不硬凑。

## 3. 设计：假设 ROI 正确的对齐管线

复用现有件（全部已存在、63 测试绿）：`fiducial::locate_roi`（coarse-to-fine NCC 定位单个框）、
`fit_rois`（RANSAC + Umeyama 相似变换拟合 + 距离一致性）、`verify_with_rois`（整链 + verdict，
已适配"框数少时降低 min_matches"）、前端 `RoiOverlay.svelte`（画框/拖拽/缩放）、
`saveRoiBoxes/getRoiBoxes`（按 imageKey 持久化）。

```
输入: 层A(template) + 层B(input) + 用户 ROI 矩形[] (假设正确)
prior: 恒等 (AlignData 同网格) 或 phase 相关 (独立拍摄的层, 可配置)
每 ROI:
  1. prior 预测框心 → 局部搜索窗内 coarse-to-fine NCC 定位 (locate_roi)
  2. 无特征/无匹配 → located:false (UI 画红, 不静默丢弃)
全局:
  3. located 框心 → RANSAC+Umeyama 相似变换 fit (fit_rois) + 残差/距离一致性
  4. verdict: 依框数自适应 (verify_with_rois 逻辑), 残差 RMS / scale 越限 → NG 如实报
渲染:
  5. 用 fit 变换层B → 上色叠加层A; 每 ROI 画绿(inlier)/红(未定位)轮廓 + 残差
可选 (后期):
  6. 残差大 → 分片显示 (每 ROI 局部偏移, ROI 心之间插值), 报告不改
```

不假设的东西（对齐用户的警告）：特征长什么样、在哪（角窗/固定偏移一律不写）、层间是平移还是
含旋转缩放（由 RANSAC 投票决定）、ROI 数量（≥1 即可工作）。

## 4. 代码改动

1. **resolver**（2026-10-12 已完成）：`align::resolve_aligndata_tifs(repo, inventory, model)`。
   用户指定优先级：PxRepository 高于 PxInventory；各根内部改用**有界 BFS 递归扫描**
   （`find_aligndata_trio`：最浅的完整 Metal+SR 对获胜——自然覆盖"模型根 > AlignData\
   > 任意深层"，不再枚举布局；深度上限 6、目录上限 512，防慢速共享扫穿；
   同层按名称排序保证确定性）。已见过的投放位置全部覆盖：
   `PxRepository\<model>\`、`PxRepository\<model>\AlignData\`、
   `PxInventory\INSPECT_SPEC\<model(-00 折叠)>\`（spec 目录根）、
   `...\AlignData\`、以及任意 ≥2 层的嵌套。
   完整定义 = Metal+SR 同现（Open 可选）；不完整的位置不拦截继续扫描。
   仓库根不可达 = 硬错误；其余一律 `Missing{searched}`（前端安全空态）。
   inventory 不可达不算致命（次要来源）。
2. **compose_identity**（已完成）：同网格直通合成（无配准、无 idealize 补偿），
   cross-anchor 的 `compose_overlay_with` 保留为 GB/L01 路径 fallback。
3. **align_load_overlay 接入**（已完成）：AlignData 优先；trio 损坏降级 GB/L01 旧路径；
   两者皆缺 → status missing + 合并 searched（安全空图）。
   inventory 根取自 `machine.fm1_path`（TOP）/`machine.bm_path`（BOTTOM）。
4. **Median+Metal 对齐模拟**（2026-10-12 已完成）：`compose_median_metal` +
   `align_load_metal_median` 命令 + median 视图"◧ 叠 Metal"开关。事实依据：
   `Median_0_1_0.tif` 与 `Metal.tif` 均为 5860×4020——**MEDIAN 是单 unit、与 AlignData
   同网格同分辨率**，恒等叠加即实机 align 后的效果（黄色标记贴 pad、四角十字对位）。
   金属 75% alpha 混合；MEDIAN 解码持 MEDIAN_DECODE_GATE；缺 median 或 Metal →
   missing 空态。刷新按钮同时清 metal 缓存。
5. **ROI 对齐模拟（里程碑 C，2026-10-12 已完成）**：`align::metal_sim`（种子确定性偏移
   ±3%·±0.25° + 逆映射双线性 warp + 校正 = warp_layer(layer, fit)）+ `align_metal_sim`
   命令（层缓存 2 条 model|side）+ 前端偏移视图/↺重新偏移/🎯用 ROI 对齐/verdict 显示。
   对齐走**真实 M5 管线**（verify_with_rois：逐框 NCC + RANSAC/Umeyama + 距离一致性），
   不泄露模拟真值；跨层匹配阈值按实测调整（`metal_sim::sim_config`：ncc_min 0.6 /
   ncc_ok 0.75 / local_search 128——金属渲染 vs 扫描图实测 NCC 0.70-0.83）。
   实测对拍（examples/metal_sim_check.rs，25fbo015-15 seed42 偏移 (-21,-24,0.24°)）：
   特征框（pad 区 4 框）→ verdict ok、4/4 内点、残差 0.66px、fit 与真值差 ~2px（框聚集
   力臂短，诚实反映）；无特征框 → verdict ng、0/4 内点、真实失败。
   UI 提示：ROI 框选在两层共见的特征处（pad/标记），框分得越开旋转估计越准。
6. **偏移可见性 + 强制按钮（2026-10-12 补充）**：工具条实时显示当前模拟偏移量
   （tx/ty/θ）；"⤴ 强制偏移"（新随机种子回到错位态）；"✓ 正确答案"
   （`force_truth` 参数：跳过 ROI 管线直接按已知偏移校正显示，教学/验收用）。
7. **合成结果磁盘缓存（2026-10-12）**：app 数据目录 `image-cache\`，键 = kind+schema+
   源 tif(路径+mtime ns+大小) 的 FNV-1a——**tif 重投自动失效**（⟳ 刷新零簿记）。覆盖：
   median 灰度预览、GB pattern 预览、AlignData identity 合成、GB/L01 合成、median+Metal、
   sim 两张网格层（PNG，重启后不再回共享）。上限 48 条按最旧驱逐（~1-3MB/条）；
   命中读 JPEG 头取尺寸不解码；任何缓存错误静默回落重算。83 测试绿
   （新增：键跟踪 kind/路径/内容变化、命中不重算+源变失效、上限驱逐）。
8. **定位鲁棒性修复（2026-10-12，用户 5 框失败驱动）**：诊断 example
   （metal_sim_debug，按"用户在当前偏移视图上画框"的诚实方式扫 400 种子）暴露两级问题：
   ① 稀疏金属模板（黑底+小十字，白占比 9-19%）跨层 NCC 被黑底稀释，300px 框粗阶段
   1/4 缩放后峰值仅 0.41-0.60；② 粗搜索半径被 factor 减半（128→64），与最大偏移 63px
   贴死。修复：`locate_rect_ncc` **内容裁剪**（模板补丁裁到白色 bbox+8px，匹配点改为
   裁剪中心；dense 补丁无变化，M5 合成用例全绿）+ 粗搜索不再除 factor + 偏移上限
   3%→2% + ncc_ok 0.75→0.70（实测真匹配 0.70-0.83、错误峰 0.41-0.60）+ success 语义
   改 `level != "ng"`（manual=成功需人工确认）+ 失败文案列出未定位框名。
   修复后诚实扫描：400 种子全部 5/5 定位（此前 worst 1/5），verdict 通过 318/400，
   剩余 20% 全部是极端偏移把角点十字推出画布后的真歧义匹配——RANSAC 诚实拒绝，
   UI 提示重画/重新偏移（真实机器角标记出视野时同样如此）。
9. **待做**：per-ROI 绿/红轮廓回显（RoiMatch 已返回，仅剩前端着色）；Open 层第三色；
   对齐练习的教学化（并入 05 计划 M6 失败教材）。

## 5. 里程碑

- A（2026-10-12 完成）：AlignData 三 tif 事实验证 + identity 合成对拍实机。
- B（2026-10-12 完成）：resolver 递归扫描 + compose_identity + align_load_overlay 接入 +
  missing 安全空态；76 测试绿；真实共享五例验证（repo-root / repo-sub / inv-spec-root /
  inventory-only / safe-missing，见 examples/aligndata_resolve_check.rs）+
  25fbo015-15 端到端合成（5860×4020 → 4096×2810，两张 23MB tif 经 Tailscale 解码 ~36s
  ——慢速共享在 spawn_blocking + loading 态内，可接受）。
  另：舞台工具条加 ⟳ 刷新按钮（CenterImage：清当前 model 两侧 median+pattern 缓存重探测，
  用户往模型目录放/换 tif 后无需重启）。
- C（2026-10-12 完成）：ROI 对齐模拟（偏移视图 → 画框 → 真实 M5 对齐 → 诚实 verdict）；
  80 测试绿。
- D（视需求）：分片显示、Open 层第三色、失败教材（并入 05 计划 M6）。
