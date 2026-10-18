# teach-core —— AFVI 教学核心算法包

`teach-core/` 是一个**零依赖**的纯 TypeScript 算法包，实现 AFVI 教学场景下的三大核心算法：

1. **光照 → GV**：按材料反射率、串扰、纹理与光照强度渲染灰度值（GV）。
2. **图像扭曲 + ROI 特征匹配对齐**：NCC 粗/精搜索 + 相似变换 + RANSAC + 判定 + 真值误差。
3. **缺陷绘制 + GV 参数检出**：按 TH + Size 规则检出亮/暗缺陷。

## 定位

- 纯 TypeScript，**零运行时依赖**：`src/` 下不 import 任何 `node:` 模块、不依赖 DOM、不依赖任何 npm 包。
- 同一份代码可在**浏览器 Web Worker** 与 **Node 24**（`--experimental-strip-types`）中直接运行。
- 只使用可擦除的 TS 语法（无 `enum`、无 `namespace`、无构造函数参数属性、无装饰器），相对导入带 `.ts` 扩展名。
- 函数纯净：除明确标注 “in place” 的函数外，不修改输入图像，返回新对象。

## 数据约定

```ts
export interface GrayImage { width: number; height: number; data: Uint8Array } // row-major, 1 byte/pixel
export interface Rect { x: number; y: number; w: number; h: number }          // 像素坐标，x/y 为左上角
export type Point = [number, number];
```

## 模块与模型

### `src/gray.ts`

基础灰度图操作：`createGray`、`cloneGray`、`getPixel`、`sampleBilinear`（像素中心坐标系，越界返回 `null`）、`gaussianBlur`（可分离高斯，半径 `ceil(3σ)`，边界钳制）、`downsampleArea`（整数因子面积平均）、`cropGray`（先取整再钳制）、`clampByte`。

### `src/tiff.ts`

`readTiffGray(bytes)`：只读经典 TIFF（magic 42）的第一个 IFD，支持 `II`/`MM` 字节序、SHORT/LONG 字段、多 strip、`Photometric=0` 取反。不支持的情况（BigTIFF、平铺、压缩、多通道等）抛出带 tag 值的 `Error`。

### `src/rng.ts`

`createRng(seed)`：splitmix32 扩展种子 + sfc32 生成器 + Box-Muller 高斯。同一 seed 结果完全确定。

### `src/light.ts` —— 光照 → GV

- 材料：`base` / `sr` / `open` / `metal`。
- 反射率 `Reflectance` 可调（0..2），默认值见 `DEFAULT_REFLECTANCE`。
- 串扰 `Crosstalk` 默认 `DEFAULT_CROSSTALK`（Red/Green/Blue 各自独立，White 三通道全 1）。
- 光照强度 `irradiance(setting, channel) = Σ enable 通道 clamp(value,0,1024)/1024 * crosstalk[color][channel]`。
- 渲染公式：

  ```
  t' = 1 + s * (texture - 1)                       // s = textureStrength
  GV = clampByte(gain * irradiance * reflectance[material][channel] * t' * 255 + offset)
  ```

- `createLightScene(median, material)`：`texture[i] = median[i] / mean(该像素所属材料的 median 均值)`，钳制到 `[0, 4]`。
- `estimateReflectance(median, scene, setting, channel)`：由真实图反推反射率初值 `R = (mean_median(material) - offset) / (gain * E * 255)`。
- `measureGv(img, roi)`：钳制规则严格一致（`x0 = min(floor(max(x,0)), width-1)` 等），`std` 为总体标准差，`histogram` 长度 256。

### `src/warp.ts` —— 扭曲实物图

- 几何正向映射 `warpPoint`：先剪切、再缩放旋转（绕图像中心）、再平移，最后可选 y 方向正弦弯曲。
- `unwarpPoint` 为精确逆映射（先去弯曲，再解 2×2 仿射逆）。
- `applyWarp(template, params, seed)` 顺序：几何 → 光照（含水平梯度）→ 遮挡 → 模糊 → 噪声 → `clampByte`。同一 template + params + seed 输出逐字节相同。
- `warpToSimilarity` 只取刚性部分（忽略剪切与弯曲），换算为绕原点的形式。

### `src/align.ts` —— ROI 匹配对齐

- `ncc(a, b)`：零均值归一化互相关（Pearson），任一方差为 0 返回 0。
- `matchRoi`：模板 ROI 中心 → 先验预测位置 → 粗搜索（降采样 `pyramidFactor`）→ 第二峰 → 原分辨率精修 + 三点抛物线亚像素修正。
- `fitSimilarity`：二维 Umeyama 闭式解（复数形式）。
- `ransacSimilarity`：n ≤ 12 枚举全部点对，否则随机抽 `iterations` 对；以内点数最多（并列取残差和最小）为准，最后用全部内点重拟合。
- `alignWithRois`：逐 ROI 匹配 → RANSAC → 残差/均值 → 判定（`ok` / `manual` / `ng`，reasons 全部列出）。
- `compareToTruth`：与真值 `warpPoint` 的欧氏距离。

### `src/defect.ts` —— 缺陷绘制与检出

- 形状：`spot`（到点距离）、`line`（到线段距离）、`rect`（到矩形边界的深度）。spot/line 权重 `inner = radius*(1-softness)`，`d <= inner → 1`，`d >= radius → 0`，其间线性下降；rect 权重 `feather = softness * max(0.5, min(w,h)/2)`，`depth >= feather → 1`，否则 `depth/feather`。
- 轮廓：`linear` 直接用线性权重；`gaussian` 用 `exp(-4.5*(1-lw)²)` 平滑过渡带。颗粒 `grain` 用 `(x,y,seed)` 整数哈希得到 [-1,1] 的确定性扰动。
- 幅度：`absolute` 加 `±deltaGv*w`；`relative` 加 `±max(v,0)*(relativePct/100)*w`；`target` 把 v 拉向 `targetGv`（bright 取 max，dark 取 min）。
- `paintDefects`：在 8 位图上按上述规则叠加，最后统一 `clampByte`。
- `paintScene`：`material` 模式改材料，`texture` 模式乘 `factor`（钳制到 `[0, 4]`）。
- `renderDefectPair`：在**截断前**的线性值上叠加 GV 笔画，再统一 `clampByte`；可选 `SensorNoise`（`σ² = readSigma² + shotGain*max(v,0)`）只加到测试图，标准图无噪声。
- `defectParamsFromInspection`：ParamKey 映射 `'1000'→brightTh`、`'1002'→brightMinSize`、`'1009'→darkTh`、`'1011'→darkMinSize`、`'1024'→minDefectSize`。
- `effectiveThreshold`：`brightTh + golden*brightRelPct/100`（dark 同理）。
- `detectDefects`：`diff = test - golden`，bright 像素 `diff >= effectiveThreshold('bright', golden, params)`，dark 像素 `-diff >= effectiveThreshold('dark', golden, params)`，8 连通域，`detected = area >= max(kind MinSize, minDefectSize)`；`DefectBlob` 附带 `goldenMean`、`thresholdMean`、`saturatedPixels`；`DefectReport` 附带 `regionStats`。
- `probeArea`：返回 `ProbeReport`，含框内像素数、Golden 统计、有效阈值范围、超阈像素数、最大连通超阈面积、饱和计数与 `wouldDetect*`。
- `generateRandomDefects`：确定性随机批量生成，支持材料约束。

## 如实标注

- **反射率默认值是教学估计值**，不是实机标定结果；可用 `withReflectance` 调整，或用 `estimateReflectance` 由真实图反推初值。
- **光照为线性模型**：`GV = gain * E * R * t' * 255 + offset`，未建模非线性响应、暗电流、镜头渐晕等。
- **缺陷检出只模拟 TH + Size 与相对阈值**：`simulatedParams` 列出已模拟参数（含 `Bright/Dark Relative TH (% of Golden) [teaching]`）；`unsimulatedParams` 列出未模拟参数（Margine、Offset1/2、Pad Offset、Block Offset 等）。相对阈值与噪声模型都是教学近似，不代表实机标定结果。
- **对齐不代表实机内部算法**：本包使用 NCC + 相似变换 + RANSAC 的教学实现，实机可能使用不同的匹配与拟合策略。

## 运行

```bash
npm run test:teach       # node --experimental-strip-types --test teach-core/tests/*.test.ts
npm run validate:teach   # node --experimental-strip-types teach-core/scripts/validate-reference.ts
```

`validate-reference.ts` 只读 `reference/`，不写任何文件。交叉验证的期望值来自**独立的 Go 实现**（`x/image/tiff` 与自研 GV 统计），用于跨语言对照。
