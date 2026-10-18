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
- 笔刷：亮点、暗点、亮线、暗线、异物（材料 metal / sr / open）、污染（纹理系数）；可撤销、清空。
- 检出参数：Bright / Dark TH、Bright / Dark Size、Min Size；检查区域可限定材料。
- 工具：拖框探查，右面板给出中文解释（差值不足 / 面积不足）。
- 视图：测试图 / 标准图 / 差异图；叠加层显示检出框、被拒框、笔画轮廓与探查框。
- 右面板：检出数 / 被拒数、缺陷表、探查解释、已模拟与未模拟参数列表。

## 如实说明

- 光照为**线性教学模型**：`GV = clamp(gain · E · R · t' · 255 + offset)`，其中 `t' = 1 + s·(t−1)`，`t = clamp(MEDIAN/mean, 0, 4)`。它用于教学演示，不代表真实光学系统。
- 缺陷检出只模拟 **TH + Size** 两类规则；`DefectReport` 中列出的其它参数（Margine、Offset、Pad Offset、Block Offset 等）未模拟。
- 对齐使用 NCC + RANSAC 的通用方法，**不代表实机内部算法**；机台定位点仅作为 ROI 初值。

## 后续嵌入 Wails

`public/` 目录与剥离类型后的 JS 可静态嵌入 Wails 前端；`/api/*` 两个接口（`/api/models`、`/api/file`）可由 Go 薄后端等价实现，其余逻辑（Worker、WebGL、面板）无需改动。
