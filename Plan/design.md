# Plan 07: UI 亮色模式 + 交互优化

## 2026-10-14：Choose Model Names 弹窗按实机图修正

### 需求、证据与推演
- 实机弹窗是单一列表视图：标题行只显示 `Choose Model Names` 和关闭按钮；下一行固定显示 `Product - Model`，不是可点击的 Product/Model tabs。
- 弹窗参考尺寸约 595×395px（1692×1045 截图），标题行约 33px，固定说明行约 27px，表头约 27px，列表约 250px，底部按钮区约 45px。
- 列边界按实机约为 75 / 152 / 151 / 51 / 126px；列表内容与表头共用五列，索引、名称、分辨率右对齐，时间列靠右对齐。
- 保留现有 Apply/Cancel 逻辑，但去掉 Tab 切换交互；列表只显示 PxRepository 目录名，Resolution 暂留空，PxInventory 不混入显示。
- 外框改为青蓝色细线，背景遮罩减弱；按钮按实机约 126×30px，Apply 无选择时禁用，Cancel 可用。

### 风险与验收
- 两类扫描结果同屏合并时可能出现重名；使用现有 canonical name/Resolution 合并逻辑，不新增排序规则。
- 交互验收：Product - Model 无焦点/点击状态；行单击选择、双击 Apply、Escape/关闭按钮关闭、Tab 仅循环真正可操作控件；npm check/build 通过。

## 2026-10-13：底部扳手设置面板按实机截图精细还原

### 需求、证据与推演
- 仅修改左侧底部扳手弹出的 `MachineSettingsOverlay.svelte`；按用户截图还原七个实机设置分组及字段，保留已有本地编辑/持久化功能。
- `repomix-output.md` 是实现与结构分析的唯一来源；开始时已有 App、CenterImage、RoiOverlay、Rust 以及设置组件的未提交工作，全部保留。
- 参考图原始尺寸 2490×1277；右侧设置栏约 500px 宽，顶部约 32px 工具/搜索栏，属性行约 24px，字体约 14px。七组默认全部展开，组名左侧只有小三角，字段和值左对齐；无 Settings 标题、窗口按钮、文件夹图标、分组背景块或行分隔线。
- 字段左边距约 28px，值列距面板左缘约 260px；五个 Off 开关同值列起点，灰色短轨道和左侧圆点。最后一项 Camera Userset 后留空白，底部约 64px 空白栏用细横线分隔。
- 截图中的 Backup Directory 为 `PxData\\StripImage`，3DResult IP 为 `192.168.1.9`；Directory 按图为 `3d xml`，Align Model Scale 显示 `1.0`。保留实机标签拼写 `IP Adress` 与 `Tavis Format`。
- 桌面尺寸按参考宽度比例缩放，设置最小可读字体/行高；小窗口允许面板内部滚动。使用现有 SVG 线框风格及原生表单，不增加依赖或配置系统。

### 阶段与验收
1. 地图分析、截图测量及规划记录。
2. 紧凑属性表、工具/搜索栏、默认展开状态、参考值和基础无障碍调整。
3. 类型检查与前端构建，真实浏览器核验扳手入口、字段/开关、折叠、搜索、编辑持久化及不同窗口尺寸；构建原生程序并刷新地图。

### 假设与风险
- 图片带远程桌面浮层及红色标注框，这些属于截图注释，不属于应用控件。
- 现有 `afvi-machine-settings` 已保存的用户值不能因修正默认值被覆盖；全新存储才采用截图默认值。面板仍只持久化本地设置，不对实机或后端发送配置。
- 不同分辨率、Windows DPI 和字体渲染可能影响像素外观；以参考尺寸的渲染测量为准，并明确实际验收范围。
- 键盘关闭后焦点应回到扳手按钮，面板关闭时不能被 Tab 聚焦；输入拒绝非有限数字，不能为外观去掉校验。

### 错误记录
- 前一轮错误判断本地文件接口不可用：当前 `exec_command` 与 `apply_patch` 已实测可用，继续仓库实现；此前被禁止的浏览器 `file://` 读取未重试。
- 浏览器读取 viewport 能力时使用了未定义的 `browser` 变量（`browser is not defined`）；页面扳手点击已成功，改为绑定已选中的 IAB 浏览器句柄后继续。
- 首轮 `npm run check`：0 errors / 23 warnings，其中本组件新增 `appearance` CSS 兼容警告 1 条；已补充标准 `appearance: textfield`，其余 22 条为既有提示。首轮 `npm run build` 通过。
- 浏览器只读 DOM 沙盒未提供 `parseFloat`（`TypeError: parseFloat is not a function`）；改为返回原始 CSS 数值，在外部计算。首次 IAB `screenshot({clip})` 忽略 x 偏移，返回左上角；改存完整截图后按已测面板坐标裁切，不修改像素内容。
- AX 将 `aria-pressed` 工具按钮显示为 checkbox，Playwright 按 checkbox 定位没有匹配（`Playwright selector deadline exceeded`）；只读 DOM 已确认实际为 BUTTON，后续按 button 角色定位。

### 已完成的参考尺寸核验
- 全新 `http://localhost:1421/` 预览存储：2490×1277 下七组均展开、29 个字段均可见；字体 14px、属性行 24px、面板宽 501.96875px、背景 `rgb(48, 48, 48)`。
- Screenshot 默认值逐项与图一致，包括 `PxData\\StripImage`、`192.168.1.9`、`3d xml` 和 `1.0`；本次没有覆盖已保存的用户配置。
- 值文字与五个开关均从面板内 x=260.484375px 开始，标签左边距 27px，开关 36×14px，底部横线 y=1212.015625px；与参考图测量一致。
- 浏览器交互已通过：折叠 Miscellaneous 后搜索 Camera Userset 会展开并显示结果；无匹配提示正确；按字母排序的视觉顺序为 3DResult / Backup / Data Format / Export / Language / Miscellaneous / Strip saving，分类按钮恢复截图顺序。
- 将 Camera Userset 改为 9、Light 改为 Light2、3D Enable 改为 On 后重载，三项均恢复；数值输入清空未把已保存的 9 改为 0。验收后恢复为参考值 2 / Light1 / Off。
- 键盘验证：末项 Tab 返回 Categorized settings，首项 Shift+Tab 返回 Camera Userset，Escape 关闭后焦点回到扳手 Settings 按钮。
- 修正兼容 CSS 后 `npm run check` 为 0 errors / 22 既有 warnings；原生构建内的 `npm run build` 通过，原生程序正在构建。
- 多尺寸核验：1440×900 面板宽 350px、字体 12px、行高 20px，29 项全部可见且页面无横向溢出；1180×720 面板仍为 350px，内部内容高度 728px / 可用 647px，聚焦末项滚动 81px 后完整可见，页面无横向溢出。
- 亮色兼容：面板背景 `rgb(229, 231, 233)`、文字 `rgb(31, 31, 31)`，29 项均保留。已恢复暗色和浏览器默认尺寸，测试仅使用独立 localhost 预览。
- 保存真实浏览器截图于本聊天可视化目录：`machine-settings-full.jpg`（完整界面）、`machine-settings-panel.jpg`（面板原像素裁切）、`machine-settings-1440.jpg`；未把空预览伪装成加载实机型号的画面。
- 最终原生构建 `npm run tauri build -- --no-bundle` 通过（release 4m27s），产物为 `tauri-app/src-tauri/target/release/AFVI_Parse.exe`，保留既有 Rust `template_point` unused assignment warning。`git diff --check` 通过。
- 独立浏览器没有 Tauri IPC，现有 DatabaseSettings 初始化产生 `TypeError: Cannot read properties of undefined (reading 'invoke')`（`get_storage_config`）；该现有数据库初始化不属于本面板，未改业务代码。面板的本地编辑/持久化核验仍完成，未宣称浏览器验证了原生数据库或实机配置效果。
- 临时预览页已关闭，自己的 Vite 1421 服务已停止；保留用户开始时的所有未提交修改，未执行重启或关闭用户运行中的应用。
- `repomix --style markdown` 已成功刷新项目地图（201 files）；本轮交付完成。原生窗口逐像素/DPI 目检未执行，本轮视觉证据来自按原图尺寸渲染的真实浏览器页面。


## 2026-10-13：亮块 GV 偏低排查

### 需求与验收目标
- 用户截图中白色亮块的 GV 标注为 39 / 48；核对取样位置、图像来源与灰度统计，确认原因并修正已证实的问题。
- 不把结果强行调整到 200；同一位置必须测到显示图像对应的原始像素，明确原图统计与教学显示变换的关系。
- 仅从 `repomix-output.md` 分析实现；保留开始时已有的 App.svelte 和 MachineSettingsOverlay.svelte 未提交工作。

### 当前证据与假设
- 截图蓝色框结果为均值 39.48、标准差 6.16、min 23 / max 45、ROI 12×21 @(902,567)，与框内白色外观不一致。
- 地图显示后端对原始 TIFF 的 Luma8 ROI 逐像素求均值、总体标准差、min/max 和 256 档直方图；前端将选区坐标映射回 TIFF 后请求统计。
- 待核实：预览缓存命中后的尺寸是否仍为原图尺寸、框与图像是否共用坐标变换、教学滤镜与 GV 计算是否一致、测量是否使用显示图像来源。
- 已确认：`decode_preview_jpeg` 返回原始 TIFF 尺寸，`cached_preview_bytes` 命中时却从 JPEG 头返回缩略图尺寸；`load_median_image` 直接发布该尺寸。前端的 `roiToOriginalPixels` 使用发布尺寸 / JPEG natural 尺寸，缓存命中后缩放变成 1，测到错误位置。
- 处理限定为 MEDIAN 加载：提取现有加载表达式为可独立测试的 `cached_median_preview`，先保持原行为并通过亮块回归测试复现；随后从已经存在的本地 TIFF 快照头读取真实尺寸。保留 JPEG 缓存及共享路径缓存键，不增加缓存格式、配置或额外远程读取。
- 本地实图快照为 5860×4020，缓存预览为 4096×2810；截图发布尺寸恰好是缩略图尺寸。按截图蓝框 `(902,567,12,21)` 直接取 TIFF，原始均值 27.0595、min/max 16/31；按比例映射为 `(1290,811,17,30)` 后原始均值 164.3784、min/max 162/166，预览同位置均值 164.5119。截图还启用了显示增益，不能把原始 164 当成截图显示亮度；需将通道增益应用后再对比。
- Red 已实测失败：8192×64 TIFF 中的亮块 GV=230，首次加载正常，缓存命中后测成背景 GV=40；断言输出 `left: 40.0 / right: 230.0`。本轮修正读取 TIFF 头尺寸，覆盖冷缓存、缓存命中和关闭缓存三种加载路径。
- Green 验收：`cargo test --lib median_tests::` 19/19 通过，新增亮块测试三种加载路径均为 230；`npm run test:light` 6/6 通过；`npm run check` 0 errors / 22 既有 warnings。
- 与截图匹配的增益推断：按 `round(raw × 1.4566)` 的通道投影，错位区域统计恰好为均值 39.4761904762、标准差 6.1634023351、min/max 23/45；正确位置均值为 239.3098039216、min/max 236/242。增益是根据截图结果推断，未读取当前会话光源值，不能宣称是实机当前精确设置。
- 以 0.0001 步长检查可复现截图均值/标准差的增益区间为 1.4566..1.4599；对应正确亮块显示均值 239.3098..239.8314，因此报告为约 239～240。
- 原生构建 `npm run tauri build -- --no-bundle` 通过（release 4m22s；内含 `npm run build` 通过）。构建产物为 `tauri-app/src-tauri/target/release/AFVI_Parse.exe`；仅剩既有 `template_point` unused_assignments 警告。完成后刷新项目地图。
- 验证范围：原始 TIFF / JPEG 实图采样、缓存命中回归、光源统计回归、类型检查、前端与原生构建；未对用户当前 GUI 会话执行重启或重画框。修正从新版重新加载图像后生效，旧会话结果需重新测量。

### 阶段与验证
1. 追踪地图并用现有样本或确定性图像复现坐标/统计差异。
2. 对已证实根因做最小修正，补充能够区分正确与错误路径的回归验证。
3. 运行针对性测试、类型检查和构建，更新阶段状态及项目地图，报告证据与验证范围。

### 风险与错误记录
- 原图尺寸与 JPEG 预览尺寸可能不同；不能以屏幕像素或缩小预览作为精确 TIFF 测量。
- 图像增益/饱和及整体色调变换可能改变显示 GV；应以实现和样本证据确认，不能仅凭肉眼推断原图 GV。
- 首次规划补丁依据旧地图匹配 TODO 后继标题失败：`apply_patch verification failed: Failed to find expected lines`；没有文件改动。已运行 `repomix --style markdown` 获取当前地图，改为锚定文件标题追加本节。
- 地图摘录脚本中 PowerShell 单项嵌套数组被展开，范围参数引发 `Argument types do not match`；改用确定的整数范围，未改源码。
- 预期 Red 回归失败：`gv_bright_roi_stays_on_the_same_pixels_after_preview_cache_hit` 在第二次加载得到 40 而非 230；已确认是缓存维度错误，进入 Green 修正。
- Green 首轮等待 Cargo 构建目录锁，随后自动释放并通过；诊断 `Get-CimInstance Win32_Process` 返回 `拒绝访问`，未中断任何进程，已无需该诊断。

## 2026-10-12：实机 TEACH 界面重构

### 需求与边界
- 以用户实机截图为视觉目标，`ui-prototype/index.html` 为控件参考，重做 Tauri/Svelte 应用的 UI 与交互。
- 保留亮色主题及现有真实图像、模型选择、参数读取等功能；不能确认含义的实机按钮暂不实现业务操作。
- 教学、配准实验和测量调节从主画面移到功能导航的 Settings 中，后续再调整功能接线。
- 现有未提交改动属于用户工作；基于刷新后的 `repomix-output.md` 修改，不回滚或直接重读源码验证。

### 布局推演
- 参考图宽度比例：功能栏约 3.5%，缩略图约 8.2%，主工作区合计约 71.4%，右侧约 28.6%。右侧两栏约 44% / 56%。
- 顶部品牌/时间栏约 6% 高度，主导航约 6.3%，信息栏与右侧标题约 5%；图像区优先占据剩余空间，日志约 17%。
- 使用 CSS Grid 与受限尺寸缩放，避免原型的右栏 `min-width:500px` 在常见窗口挤占画布。桌面最小窗口保持可用；小窗口允许局部滚动。
- 黑灰背景、蓝色 TEACH、黄绿色 Ready、粉色 Specification、浅粉 Image Analysis、黄/绿 ROI 树、三组参数表均采用参考图色彩。
- 深浅主题共用结构及语义色，保留现有主题持久化机制。截图上的浮层 FPS/码率不是应用 UI，不复刻。

### 实施拆分
- App：品牌、时间、五段导航、真实状态、功能导航、信息工具栏、日志、界面分区。
- CenterImage：保留真实图片和测量管线，将缩略图、地图、画布外观按参考图排列；将教学调节集中到设置入口。
- ParameterConfig / Settings：TEACH 使用并列 Specification 与 Image Analysis；参数配置、配准实验、数据采集、设备和数据库整理到 Settings。
- 不引入新框架、通用配置系统或未来抽象。原型已有线框 SVG 可沿用，不混入其他图标风格。

### 假设与风险
- 默认无模型时不伪造设备图像、检测结果或 KeepAlive；保留空画布和表格结构并提供选择模型入口。
- 各业务页保持挂载，切换导航不能丢失选择或进行中的操作。
- 截图在 2417×1258，下调至 1920×1080 / 1440×900 时必须兼顾文字可读性，无法每个分辨率均逐像素一致。
- 修改 CenterImage/ParameterConfig 时保留原有输入校验、错误处理、测量及配准接口；只搬动 UI。

### 验收
- `npm run check`、`npm run build`；以实际渲染检查暗色/亮色、导航切换、树选择、Light/RGB、模型入口、画布缩放及 Settings。
- 对新增交互做最小且有效的浏览器检查；不为纯 CSS 写镜像测试。
- 完成后运行 `repomix --style markdown` 刷新项目地图。

### 本次错误记录
| 错误 | 处置 |
|------|------|
| 初始地图未包含 ui-prototype 且部分前端已有未提交改动 | 实施前运行 repomix --style markdown，全部分析以新地图为准 |
| apply_patch 同一补丁 Delete+Add 同一路径返回 invalid patch: multiple operations target | 改用单次完整文件写入，不影响现有业务内容 |
| 首轮画布 --bg-stage 缺失导致回退为近黑背景 | 添加 --bg-stage: var(--machine-panel) 保持实机灰底及亮色模式 |
| 切换设置销毁案例组件/未完成参数草稿 | 改为保持挂载并隐藏，实验结果、输入草稿和校验状态保留 |
| 全幅设置遮挡后底层 ROI 仍响应 Delete | 添加 enabled/interactive 条件，仅 TEACH 可见时响应主画布快捷键 |
| 无图时工具外观可用但无动作 | 发布 hasImage/canMeasure 工具状态，禁用测量、ROI与缩放 |
| 浏览器测试 Teaching Parameters 同时匹配功能栏与分类页签，strict mode violation | 使用 Settings categories 导航范围限定 locator |
| 亮色下 root 颜色别名继承已解析暗色值 | 在亮色 body 上单独覆盖 --bg-stage |
| 覆盖页底下控件仍可被键盘/辅助技术访问，Align / ROI locator匹配两控件 | 隐藏底层工作区使用 inert，教学 sheet 作为独立可交互区域；测评 locator限定当前页 |
| 浏览器预览 get_storage_config 缺少 Tauri invoke（已有 DatabaseSettings 初始化路径） | 原生构建无此环境差异；缓存模型测试将文档写入隔离在内存，浏览器只验收 UI，不宣称验证设备/数据库连接 |

## 目标
1. tauri-app 添加亮色模式（dark 默认，可切换、持久化）。
2. 启动应用实际观察，修掉不合理/不舒适的交互点。

## 现状（依据 repomix-output.md，2026-10-09 快照）
- `tauri-app/src/styles.css`：全局暗色变量 `--bg-dark/--bg-panel/--text-main/...`，但只覆盖 body/控件基础样式。
- `App.svelte` scoped 样式全部硬编码 hex（#2b2b2b/#333/#0088cc/#8cc63f 等）。
- 各组件（AlignCaseLab/ModelCopier/ParameterConfig/...）scoped 样式同样硬编码 hex。
- 无任何主题切换。appStore 在 `lib/stores.svelte.ts`。

## 方案
- `styles.css` 扩展变量集（面板/边框/文字/强调/输入框背景/悬停等），`:root` = 暗色，`html[data-theme="light"]` 覆盖为亮色值。
- 主题状态：stores.svelte.ts 加 `theme: 'dark'|'light'`，初始化读 localStorage，切换写 localStorage + `document.documentElement.dataset.theme`。
- App.svelte 头部加 ☀/🌙 切换按钮；scoped 样式 hex → var() 机械替换。
- 组件 scoped 样式：把与全局变量同义的 hex 批量替换为 var()。canvas 内 JS 绘制颜色不动（CenterImage/RoiOverlay 的图形绘制与主题无关）。
- 亮色配色（VSCode-light 风格，护眼）：bg #f3f3f3, panel #ffffff, text #1f1f1f, muted #6b6b6b, accent #0067c4, border #d0d0d0, header #e4e4e4。

## 假设
- 假设所有组件 scoped 样式中 hex 可枚举并逐一映射（依据：repomix 快照中组件样式均为标准 hex）。
- 假设 localStorage 可用（WebView2 支持）。

## 风险
- 替换遗漏导致亮色下局部仍是暗色 → 启动应用逐页目检。
- 变量命名冲突 → 统一沿用现有 `--bg-*` 前缀风格。

## 错误记录表
| 错误 | 处置 |
|------|------|
| WebView2 (dev + HMR 重注入样式后) 切换 html[data-theme] 状态变更但 UI 不重绘（按钮字形已变、BTM 等其他点击正常） | 曾疑样式失效，最终 CDP 证实:计算样式/渲染帧均正确，"混合渲染"是目检时 ZCode 聊天窗口(内嵌亮色截图)遮挡应用窗口造成的采样污染 |
| 同上继续: 原地 <style> 换肤后 Page.captureScreenshot 仍是旧帧 | WebView2 对 html/body 级变量变更不触发重呈现 → 切换改为持久化 + location.reload()（重载后首帧渲染正确），并持久化 activeTab |
| Settings.svelte `color: white` 硬编码，亮色下子页文字不可见 | 改 var(--text-main) |
| 参数表行名 JS 硬编码 #00ff00/#ffff00/#dddddd，白底不可读 | 新增 --row-insp/--row-sub 变量，master 用 var(--text-main) |
| CUA 坐标点击偶发被窗口激活吞掉 / a11y 树拿不到 webview 内按钮 | 换 .NET SendInput 原生点击 + GDI CopyFromScreen 截图；最终用 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 + CDP Runtime.evaluate/Page.captureScreenshot 做确定性验证 |
| Svelte 注释里写字面 `<style>` 导致 svelte-check "<script> was left open" | 注释避免出现标签字面量；最终 svelte-check 0 错误 |
| 用户报告"启动后弹一堆黑框"（确认与启动强相关，十几个瞬现） | 根因: dmt-copy-core/credentials.rs 的 `net use`（GUI 进程无 CREATE_NO_WINDOW，每调用闪一个控制台）；启动恢复选区 → median TOP+BTM 加载 → ensure_unc_credentials ×N 台服务器 → 十几个黑框。修复: CommandExt::creation_flags(0x08000000)。冒烟: 启动+median 加载期 conhost 零增长 |
| 用户要求删除 Model-Copy 功能（已有专门工具） | 删 COPIER 导航/页签/ModelCopier.svelte、service.ts 复制 API、MachineManagement agent 配置；后端删 6 个复制/代理命令。dmt-copy-core 保留（credentials/scan_hosts/find_model_dir 被 median/XML/align 复用） |

## 2026-10-13：教学光源独立叠加与 GV 联动

### 需求与边界
- Calibration 的全局 ON/OFF、Page 1/2/3 灯泡、通道亮度和中心图像必须共享同一份会话状态。
- OFF 显示原始图像；ON 才启用光源叠加，并开放亮度滑块、数值输入和通道开关。
- Light 1/2/3 独立切换；Red/Green/Blue/White 为通道选择，高亮当前通道，White 均匀影响三个 RGB 通道。
- 只修改前端显示与读数，不写回 MEDIAN、LightSpec 或现有 GV 存储格式。

### 状态与数据流
- `appStore.lightSimulation` 保存 `enabled`、`host`、`selectedPage`、`selectedColor` 和三个 Page 的 `enabled + channels[]`。
- `CalibrationLight` 以当前 Host 的 LightSpec 初始化三页；模型或 Host 变化时重建，亮度改动仅保留在当前会话。
- 顶部工具栏直接读写共享状态，取消工具栏的 TEACH 专属 `inert`；中心画布只把 `interactive` 用于 ROI/拖拽等会改变图像操作。

### 混光与 GV 公式
- 每个启用 Page 的每种颜色贡献为该颜色启用通道的平均 `Value / 1024`；没有启用通道时贡献为 0。
- `R = 1 + Σ(Page.Red + Page.White)`，`G = 1 + Σ(Page.Green + Page.White)`，`B = 1 + Σ(Page.Blue + Page.White)`，各值限制在 `0..4`；全局 OFF 时三者均为 1。
- 图像使用 SVG `feColorMatrix` 分别缩放 RGB；既有整体亮度/对比度 filter 继续叠加。
- 悬停读数先应用 RGB 增益再计算 Rec.601 Avg/Std GV；拖框后端仍测原始灰度，前端按 `.299R + .587G + .114B` 的有效增益换算显示结果。

### 风险与处置
- `repomix-output.md` 可能落后于当前未提交 UI 文件：开始编码前刷新，新增/删除文件后再次刷新。
- WebView2 若 SVG filter 与读数更新不同步，保留原始 offscreen canvas，并把增益应用到采样值；不改后端测量缓存链路。
- 输入超出 `0..1024` 或不是有限数时拒绝写入、保留旧值并显示错误状态；不让异常值进入混光公式。

### 本次实现错误记录
| 错误 | 处置 |
|------|------|
| 首次追加设计补丁因历史行上下文不一致而未应用 | 改为只追加新章节，未覆盖既有设计记录 |
| `CalibrationLight.svelte` 初次类型检查将可空 `record` 传给 `getLightChannels` | 引入局部 `loadedRecord` 做类型收窄，`npm run check` 后续通过 |
| Windows PowerShell 不支持当前环境的 `Set-Content -NoNewline` 参数 | 改用兼容的 `Set-Content -Encoding UTF8` 清理 TODO 文件尾部空行 |
| Windows 计算机验收连接器未返回可操作 AFVI 窗口，且运行时没有 `listWindows` API | 未对用户窗口执行点击；改用 `npm run check/build`、公式自检和代码链路验证，保留该限制供实机验收 |

## 2026-10-13：RGB 通道灰度与彩色显示修正

### 需求与推演
- 实机 Red / Green / Blue 三个按钮是图像通道视图：提取合成后的对应分量并复制为 RGB 相等的灰度图；第四个按钮才是 RGB 彩色混光。
- White 保留为 Calibration 表中的光源颜色，等量贡献到 R/G/B；查看通道不改变任何光源开关或亮度，也不互相串通道。
- 会话状态改为 `displayChannel: Red | Green | Blue | RGB`，默认 Red；全局 OFF 使用单位增益的对应通道原图，RGB OFF 为完整原始 RGB。原有整体调光只在 ON 时叠加。
- SVG 矩阵、缩略图、悬停 RGB/GV 和拖框 GV 都采用同一个显示通道；切换视图必须立即更新读数，不能重新读取共享图像。

### 测量与验收
- 灰度视图的拖框 GV 使用对应 R/G/B 增益；彩色视图使用 Rec.601。以灰度 MEDIAN 为模拟基准，亮度增益沿用已确认的三页独立线性叠加公式。
- `measure_median_gv.stats` 追加可选的 256 档原始灰度直方图；前端按每档实际裁剪后像素重算统计。旧后端无直方图时明确显示“估算”，本次重建原生程序后使用直方图精确统计。接口原参数和已有字段不变。
- 补上可运行回归检查，使用已知 RGB 像素确认单通道取值、三通道无串扰、White、RGB 彩色、OFF、矩阵和读数一致；另验证切换视图后的缓存测量与悬停结果。
- 本次通过已有 RustDesk 会话读取 `192.168.1.71`：第四个按钮彩色模式显示蓝紫色图像，远程捕获检测人工输入后停止操作。未改变实机通道设置或保存模型。

### 风险
- MEDIAN 原始源为灰度时，RGB 彩色视图是教学光源合成颜色，无法从灰度恢复实物真实光谱。已有原始 RGB 预览必须逐通道取值，禁止先转加权灰度再分通道。
- 高亮度裁剪会使均值/标准差不能简单乘增益；验收需检查饱和像素，不能把裁剪前统计冒充当前显示测量。

### 本次修正问题记录
| 问题 | 处置 |
|------|------|
| 旧实现将第四按钮定义为 White，未按所选 RGB 分量显示灰度，ROI 仅乘加权增益 | 视图与光源颜色分离；SVG/悬停按分量投影，ROI 按 256 档直方图进行裁剪后统计 |
| `sky.launch_app` 传普通文件路径时匹配了已安装旧版，第一次未启动构建产物 | 改用明确的 `process:C:\develop\DMT_AFVI_Color_Parameter_AutoParse\tauri-app\src-tauri\target\release\AFVI_Parse.exe`，返回并验收新版本窗口 |
| 保存截图首次假定 PNG，而 Sky 返回 JPEG | 按实际 MIME 保存为 `Plan/light-channel-rgb-verified.jpg`，未修改截图像素 |
| 清理额外旧版窗口的 Alt+F4 被自动审批拒绝：可能丢失未保存状态，缺少明确关闭授权 | 保留旧版窗口；不通过其他方式终止进程，继续完成代码、构建、测试页清理与地图刷新 |

## 2026-10-13：可复用 ROI 工具条组件 + GV 测量集成

### 需求与边界
- 参考实机右侧竖排工具条，做一个可复用组件：选择器（指针）、添加矩形、添加椭圆、添加多边形（参考 PS 钢笔，右键闭合并首尾相接），下半部分为删除矩形/椭圆/多边形，最下面删除用户 ROI 选框。
- 组件只渲染全部按钮、由 `enabled` 决定可用/禁用；默认全部禁用。复用时差异仅在于启用哪些按钮。
- 本轮先在 GV（灰度）测量处挂载并启用整套按钮；其余位置与启用/禁用清单后续再定。

### 设计
- `lib/roi-tools.ts`：`RoiPaletteTool`（pointer / add-rect|ellipse|polygon / delete-rect|ellipse|polygon / delete-roi）、`RoiDrawTool`（select/rect/ellipse/polygon/erase）、添加/删除分组常量、`shapeForTool`/`drawToolFor` 映射。
- `RoiToolPalette.svelte`：46px 竖排 rail，顶部指针、添加组、删除组、底部垃圾桶；props `enabled`（默认全禁用）/`active`/`onselect`。
- `RoiOverlay`：用 `tool` 取代布尔 `drawMode`；矩形/椭圆左键拖拽绘制，多边形左键落点+右键闭合并首尾相接，erase 点选删除；形状存入 `RoiRect.shape`/`points`（旧数据缺省 `rect`，向后兼容）。
- `CenterImage`：`paletteTool` 为唯一工具状态，`drawMode`/overlay 工具由其派生；GV 模式显示 rail，点击切换 overlay 工具；垃圾桶删除选中（无选中则清空）。`stage-api` 暴露 `tool`/`setTool` 供其它宿主复用。

### 风险与已知限制
- 后端 `measure_median_gv` 只接受矩形：椭圆/多边形的 GV 取包围盒，非真实形状掩膜，需后续算法支持才能精确。
- 三个删除按钮目前映射同一 `erase`（点选删除任意形状）；按形状减选（mask 布尔）语义留待后续。
- 已用一次性 Vite 预览页目检 rail（默认全禁用 / GV 全启用两态），验收后已删除临时文件。

### 追加（同日）：一键清空 + GV 选框不残留
- 垃圾桶按钮：左键删除选中框（无选中则清空）；**右键一键清空全部**，并抑制 WebView2 右键菜单；rail 内右键同样抑制默认菜单。
- GV 模式（`measureMode`）为「临时选框」：模式结束（Esc、切换 Tab、Metal、换模型）即清空框，下次进入重新画，避免**测量框与教学/配准框混用同一 imageKey**。
- 离开 TEACH（`interactive=false`）时自动结束 GV 模式，从而触发上述清空。
- 画布右键：有绘制工具激活时不再弹出浏览器菜单（原先仅 `scale>1` 时才拦截，导致 1:1 下弹出「将图像另存为」菜单）。
- 验证：一次性预览页确认左键选中、左键垃圾桶=删除动作、右键垃圾桶触发清空且 `defaultPrevented=true`；`npm run check` 0 error / 22 warning，`npm run build` 通过。
