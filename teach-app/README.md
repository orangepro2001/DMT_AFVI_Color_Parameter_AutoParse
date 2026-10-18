# AFVI 教学前端（teach-app）

基于 `teach-core/`（只读）的桌面级 Web 教学前端，零依赖：不使用任何 npm 包、框架或 CDN。浏览器端为原生 TypeScript（由开发服务器剥离类型后下发）、DOM、WebGL2 与 Web Worker。

## 启动

```bash
npm run teach
```

启动后终端会打印 `AFVI teach app: http://127.0.0.1:5178/`，用浏览器打开该地址即可。端口可用环境变量 `TEACH_PORT` 覆盖。

## 冒烟测试

```bash
npm run teach:smoke
```

冒烟测试会启动服务器（端口 0，系统分配），检查首页与样式、递归抓取全部相对模块并逐个做 `node --check` 语法检查、验证 `/api/models` 与 MEDIAN 下载、验证越界访问被拒。任一失败时退出码为 1。

## 架构

- **服务器（`server.ts`）**：零依赖 Node HTTP 服务，只读 `reference/`。提供静态页面、按需剥离类型的 TS 模块（`/teach-app/src/*.ts`、`/teach-core/src/*.ts`）、型号列表 `/api/models` 与原始文件 `/api/file`。路径规范化后必须落在允许目录内，否则 403。
- **Worker（`src/worker.ts`）**：所有重计算（TIFF 解码、材料图构建、光照渲染、扭曲、对齐、检出、测量）都在 Web Worker 中执行，主线程不阻塞；大数组通过 Transferable 传递。
- **WebGL2 视图（`src/viewer.ts`）**：大图（如 5860×4020 灰度）只上传一次 GPU 纹理；光照调节完全在片元着色器中实时完成，与 `teach-core` 的公式逐像素一致。
- **主线程（`src/main.ts`）**：应用外壳、共享状态、页签切换、状态栏读数与 `window.__teach` 自动化接口。

### 界面与主题

- 传统工控 / Windows 2000 经典风格：斜面按钮、凹陷输入、分组框标题条、零圆角、无动画过渡、Tahoma + 宋体 12px、等宽状态栏。叠加层使用经典机器视觉纯色：绿=检出/定位成功、红=NG、黄=被拒/ROI、青=笔画/拖框。
- 两套主题：深色（夜间，默认）与浅色（经典灰）。顶栏“主题”切换，不重载页面；记忆在 localStorage `teach.theme`，也可用 URL `?theme=light|dark`。
- 性能取向：无过渡/动画/滤镜，面板 `contain`，视图区 `contain: strict`，缺陷表最多渲染 300 行。

## 三个模式

### 光照与 GV

- 光源：Red / Green / Blue / White 四路，各自启用与强度（0–1024）。
- 相机通道：Red / Green / Blue / RGB；可切换显示材料伪彩图。
- 渲染：增益、偏移、纹理强度。
- 反射率：4 材料 × 3 通道可直接编辑，可“恢复默认”，也可“由 MEDIAN 反推当前通道”（假设 MEDIAN 在当前光照下拍摄，仅作初值）。
- 工具：在视图上左键拖框进行 GV 测量；右面板显示所选 ROI 的均值 / 标准差 / 极值 / 像素数 / 饱和与截断计数，以及所选通道直方图。调光后 GV 实时变化。

### 对齐

- 源图可选 MEDIAN 原图或当前光照渲染图；工作分辨率 1/1、1/2（默认）、1/4。
- 扭曲参数：平移、旋转、缩放、剪切、弯曲、模糊、噪声、增益、偏移、光照梯度、随机种子；像素量按全分辨率输入，发送给 Worker 时按工作分辨率换算。
- 遮挡：在模板视图拖框添加，可逐个删除。
- 匹配参数：搜索半径、金字塔因子、最小 NCC、最小唯一性、RANSAC 阈值、OK / NG 残差阈值。
- ROI：可恢复机台定位点（来自 AlignSpec.xml 中 `Type="0"` 的 `<Param>`），也可拖框新建、拖动移动、Delete 删除。
- 视图：模板 / 输入 / 差异；叠加层显示 ROI、预测位置、找到位置与连线。
- 右面板：判定徽章与原因、拟合结果、真值误差、内点残差 RMS、每 ROI 表格与 NCC 曲面热力图。

### 缺陷检出

- 渲染通道 Red / Green / Blue，使用共享光照设置，体现光照对检出的影响。
- 笔刷：亮点、暗点、亮线、暗线、亮块、暗块、异物（材料 metal / sr / open）、污染（纹理系数）；可撤销、清空，每个笔画可单独启用/禁用（禁用的笔画不参与渲染，叠加层画成灰色虚线）。
- 幅度模式：绝对 ΔGV、相对 %（随光照缩放）、目标 GV（把缺陷拉到指定灰度，不会把更亮的像素压暗）。三组滑块只显示当前模式。
- 边缘轮廓：线性 / 高斯；颗粒滑块（0..1）为缺陷内部加入确定性不均匀。
- 拖拽半径：点类工具拖动距离 ≥ 2 px 时用拖动距离作半径，否则用半径滑块；块类工具拖框生成矩形缺陷。
- 随机批量：按数量、种子、类型、形状、半径范围、幅度范围、放置材料生成确定性随机缺陷。
- 成像噪声：读出噪声 σ、散粒噪声系数、种子；噪声只加到测试图，标准图视为多板中值无噪声，σ² = 读出² + 散粒系数×GV。
- 检出参数：Bright / Dark TH、Bright / Dark Size、Min Size、Bright / Dark Rel %（有效阈值 = TH + Golden×%）；检查区域可限定材料（含 base）。
- 工具：拖框探查，右面板给出中文解释（差值不足 / 最大连通超阈面积不足 / 会检出），并给出亮/暗余量诊断。
- 视图：测试图 / 标准图 / 差异图；叠加层显示检出框、被拒框、笔画轮廓（点画圆、块画矩形、线画线）与探查框。
- 右面板：检出数 / 被拒数、区域 Golden 均值与饱和占比、测试图饱和像素数、缺陷表（含背景 GV、有效 TH、饱和像素）、探查解释、已模拟与未模拟参数列表。

## 如实说明

- 光照为**线性教学模型**：`GV = clamp(gain · E · R · t' · 255 + offset)`，其中 `t' = 1 + s·(t−1)`，`t = clamp(MEDIAN/mean, 0, 4)`。它用于教学演示，不代表真实光学系统。
- 缺陷在**截断前**的线性值上叠加，再统一 `clampByte`；因此暗点画在饱和 255 区不会产生虚假的可检出暗对比。
- 相对阈值（`TH + Golden×%`）与成像噪声模型都是**教学近似**，不代表实机标定结果。
- 缺陷检出只模拟 **TH + Size** 两类规则；`DefectReport` 中列出的其它参数（Margine、Offset1/2、Pad Offset、Block Offset 等）未模拟。
- 对齐使用 NCC + RANSAC 的通用方法，**不代表实机内部算法**；机台定位点仅作为 ROI 初值。

## Windows 原生版

把 teach-app 打包成单个轻量 Windows exe（约 3–5 MB），运行时**不需要 Node**，使用系统自带的 WebView2 运行时。

### 前提

- 已安装 Go（1.25+）。
- Go 模块缓存中已有 `github.com/jchv/go-webview2`、`github.com/jchv/go-winloader`、`golang.org/x/sys`（构建时 `GOPROXY=off`，不会联网下载）。
- 系统已安装 Microsoft Edge WebView2 Runtime（Windows 11 通常自带）。

### 构建

```bash
npm run teach:native
```

脚本会：

1. 清空并重建 `teach-app/native/web/`：从 `teach-app/public/` 复制 `index.html`、`styles.css`；把 `teach-app/src/*.ts` 与 `teach-core/src/*.ts` 剥离类型后写入 `web/teach-app/src/`、`web/teach-core/src/`（**保留 `.ts` 文件名**，因为模块间 import 写的就是 `.ts` 路径）。
2. 在 `teach-app/native/` 下执行 `go build -trimpath -ldflags "-s -w -H windowsgui" -o dist/ColorAfviTeach.exe .`。

只生成 web 目录、不跑 go build：

```bash
node teach-app/scripts/build-native.ts --web-only
```

### 产物

`teach-app/native/dist/ColorAfviTeach.exe`（单文件，内嵌 web 资源）。

### reference 查找顺序

1. 环境变量 `AFVI_REFERENCE_DIR`（该目录本身即包含 `FM1/FM2/BM` 的 reference 目录）。
2. exe 所在目录下的 `reference/`。
3. 从 exe 目录逐级向上最多 5 层查找 `reference/`。
4. 当前工作目录下的 `reference/`。

找不到时 `/api/models` 返回 `[]`，界面会显示无型号说明。

### `--serve` 用法

```bash
ColorAfviTeach.exe --serve --port 0
```

只启动 HTTP 服务、不开窗口，向 stdout 打印一行 `AFVI teach app: http://127.0.0.1:<port>/`，直到进程被终止。`--port N` 可覆盖端口（`0` 表示随机）。由于 exe 以 `-H windowsgui` 构建，`--serve` 模式会尝试 `AttachConsole(ATTACH_PARENT_PROCESS)` 并把 stdout/stderr 重定向到 `CONOUT$`，使父控制台能看到输出；附加失败则静默继续。

### 语言记忆与固定端口

默认监听 `127.0.0.1:51780`（固定端口使 WebView2 的 localStorage 在多次启动间保持，语言选择依赖它）；若该端口被占用则回退到随机端口。只能监听 `127.0.0.1`。

## 后续嵌入 Wails

`public/` 目录与剥离类型后的 JS 可静态嵌入 Wails 前端；`/api/*` 两个接口（`/api/models`、`/api/file`）可由 Go 薄后端等价实现，其余逻辑（Worker、WebGL、面板）无需改动。
