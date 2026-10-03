# 阶段三 — LightAnalyse UI 模块

> 目标：在 `tauri-app`（Angular 18 standalone + Tauri 2）里新增 **LightAnalyse** 页面，
> 提供「正向预测 GV」与「反向推导光强组合」两个能力，并沿用项目既有的存储与 UI 约定。

对应总纲决策：D4 / D5 / D6 / D7 / D8 / Q3 / Q4 / Q5。产出：`light-analyse.component.ts` + 路由/导航接入 + 单元测试。

> **量程标定对本阶段的影响（2026-09-23）**：UI 的一切输入边界（滑条、校验、外推警告、
> 反向网格）都以模型的 **`levels`** 为准，不再使用 0~1024 常量；`levels` 缺失的旧模型
> 回退为 `[0,512,1024]`（兼容期处理，需在 UI 上显示"未量程标定"提示）。

---

## 1. 现有约定（必须遵守，否则会踩坑）

| 约定 | 说明 |
|---|---|
| 组件组织 | standalone + 内联 template 为主；`parameter-config` 是 templateUrl 特例 |
| 变更检测 | `provideExperimentalZonelessChangeDetection` —— **任何异步 Tauri invoke 之后必须 `ChangeDetectorRef.markForCheck()`** |
| tsconfig | `noPropertyAccessFromIndexSignature` 开启 → 索引签名取值用 `values['Val']` 形式 |
| 存储 | 唯一接缝 `DocumentStoreClient`（`document-store.ts`），组件不得直接碰文件/驱动 |
| 路径 | **绝不硬编码路径**；配置进 DB / app-data |
| 导航 | 顶级导航在 `app.component.ts`（HOME/TEACH/REVIEW/CALIBRATE/SETTINGS），路由表 `app.routes.ts` |

---

## 2. 入口与路由（Q5）

新增顶级导航项 **`LIGHT ANALYSE`**（放在 `CALIBRATE` 之后），路由：

```ts
{ path: 'light-analyse', component: LightAnalyseComponent }
```

**为什么不做成 CALIBRATE 的子页签**：CALIBRATE 是"录入实机测量值"的页面（每页只有
AU/OSP/SR/Space 数行），而 LightAnalyse 是"计算/建模"页面，交互密度和心智模型都不同；
挂在顶级更利于操作员分辨"我在录数据"还是"我在算数据"。

（若最终仍希望并入，改动只在 `app.routes.ts` + `app.component.ts` 两处，组件本身不受影响。）

---

## 3. 数据源：模型从哪来（Q4）

```
启动时:
  1. 读内置默认  src/assets/light-models.json      (随包出厂)
  2. 读 DB 覆盖  ui/light-models.json              (现场标定后可写)
  3. 按 id 合并，DB 覆盖 assets；都没有 → 页面显示"未标定"空态
```

- 模型选择器：`machineId + modelName + channel` 三级下拉（数据来自合并后的模型清单）。
- 当前选中的设备/型号**跟随既有活动选择**（`AppService.getActiveSelection()` +
  `activeSelectionChanged$`），与 TEACH/CALIBRATE 保持一致，避免操作员重复选。
- 页面顶部显示该模型的 `quality`（R² / 验证误差 / 拟合时间）——**让用户知道这个预测可不可信**。

**TS 类型**（与阶段二 §4 的 JSON 一一对应，字段名不得改名）：

```ts
export interface LightModel {
  schemaVersion: number;
  id: string;
  machineId: string;
  modelName: string;
  channel: string;
  lightLabel: { x1: string; x2: string; x3: string };
  inputRange: { min: number; max: number };
  /** 参与模型的轴；不在其中 = 禁用轴（固定值，不可调） */
  activeAxes: ('x1' | 'x2' | 'x3')[];
  fixedAxes: Partial<Record<'x1' | 'x2' | 'x3', number>>;
  /** 每轴标定档位 [low, mid, high]；禁用轴 = null。UI 输入边界以此为准（Plan/01 §2） */
  levels: Partial<Record<'x1' | 'x2' | 'x3', [number, number, number]>>;
  coding: Partial<Record<'x1' | 'x2' | 'x3', { center: number; half: number }>>;
  responseUnit: string;
  coefficients: {
    b0: number;
    b1: number; b2: number; b3: number;
    b11: number; b22: number; b33: number;
    b12: number; b13: number; b23: number;
  };
  quality: { r2: number; r2Adj: number; rmse: number; verifyMaxRelErr: number; nPoints: number; doF: number };
  fittedAt: string;
}
```

---

## 4. 正向预测

### 计算
```
编码:   xᵢ = (vᵢ − centerᵢ) / halfᵢ
GV:     y = b0 + Σbᵢxᵢ + Σbᵢᵢxᵢ² + Σbᵢⱼxᵢxⱼ
```

10 次乘加（按 `activeAxes` 裁剪后的项数），纯函数，放 `light-analyse.math.ts`（便于单测，不进组件）。
**禁用轴**（不在 `activeAxes` 中）不渲染输入控件，只显示"固定 N"标签，并提示
"预测仅在 X 轴 = N 时有效"。

### UI
- 三行输入：`0°` / `30°` / `60°`，每行 **滑块 + 数字输入框**（双向同步）。
- **滑块与校验范围 = 该轴的 `levels[x][0] ~ levels[x][2]`，不是 0~1024**：
  模型只在标定窗口内有效，窗口外驱动值要么饱和、要么无响应——允许操作员拖进去
  等于鼓励产生"预测明显错误"的体验。滑块旁以小字标注档位（low/mid/high），
  窄量程轴（如 0~2）改用步进按钮而非滑块（1 像素滑块没有可用精度）。
- 输入非法（越界/非数字）时红框并禁用输出。
- 一个大号结果区显示 **预测 GV**，附 `±` 不确定度（= RMSE，或更好是预测区间半宽）。
- **外推警告**：如果三路输入落在**档位立方体**之外（编码 |u|>1 的组合，尤其角点区——
  BBD 没有角点数据），显示黄色提示"该组合未被实验覆盖，预测可信度较低"。
  这是 BBD 设计的固有代价，必须让用户看到。判断基准同样是 `levels`，不是 0~1024。
- 可选增强：把三路输入映射到实机 CALIBRATE 的通道上，提供 **`Send to Calibrate`** 按钮，
  一键把这三个值写进对应 Page 的 Channel `Value`（需确认是否要回写快照——见 §7 待确认）。

---

## 5. 反向推导

### 难点
**3 个输入 → 1 个目标，是欠定方程，解有无穷多。** 比如 GV 恒定可以通过"多开 60° 少开 0°"维持。
所以算法不是"求解"，而是"**在可行域内枚举 + 按偏好排序**"。

### 算法：网格搜索 + 去重 + 偏好排序（D5）

```
1. 粗网格: 每路在其档位区间 [levels[x][0], levels[x][2]] 内取 N 档
          （N=33 → 区间宽 1024 时步长 32；窄量程轴如 0~2 直接用整数全枚举，仅 3 档）
2. 过滤:   只保留 |y_pred − y_target| ≤ tolerance 的格点      // 默认 tolerance = RMSE
3. 去重:   按偏好排序后做非极大值抑制（欧氏距离 < 阈值则视为同一解）
4. 排序:   按 Q3 的偏好打分
5. 输出:   Top-N（默认 5 组）候选表
6. 精修:   对每个候选做局部细化（在 ±步长 内二分/黄金分割，把 GV 误差压到最小）
```

> **网格必须限制在档位区间内**：搜索空间由 `levels` 定义而非 0~1024。
> 原因与正向输入一致——窗口外的解物理上不成立（饱和），给操作员推一个
> "强度 800"的候选（该轴 8 就饱和）会直接摧毁对工具的信任。
> 窄量程轴全枚举后总网格通常远小于 33³，实时性更好。

- 性能：33³ = 35,937 次求值 ≈ 数毫秒，可在输入变化时**实时**重算（debounce 150ms）。
  若开 65³ = 274,625 次，也仅几十毫秒，可用 `requestIdleCallback` 或 `setTimeout` 让出主线程。
- 若偏好是"某一路固定"（如 60° 作为主光固定在中档），则降为 2 维网格，更快。
- **候选不足时的提示**：若过滤后候选 < 3 组，说明目标 GV 在当前档位窗口内不可达
  （或太靠近窗口边缘）→ 明确提示"目标超出该色窗口能力，请调整目标或重新标定"，
  **不要**放宽容差硬凑候选。

### 偏好打分（Q3）

| 偏好 | 打分函数（越小越优） | 适用场景 |
|---|---|---|
| **A 三路均匀** | `Σ(xᵢ − x̄)²`（方差） | 希望照明均匀、减少阴影 |
| **B 总光量最小** | `Σxᵢ` | 节能 / 延长光源寿命（**默认主序**） |
| **C 指定主光源** | 固定某一路为给定值，其余自由；或 `Σxᵢ` + 对主光源偏离的惩罚 | 工艺已定某个角度的光 |

多偏好时给**权重**，UI 提供单选（简单）而非多选（先不做复合权重，避免解释成本）。平手时用 A 裁决。

### UI
- 一个输入框：目标 GV（0~255）+ 容差（默认 RMSE，可改）。
- 偏好单选：`Balanced` / `Lowest total light`（默认）/ `Fix a channel`（选中后出现该通道的固定值输入）。
- 候选表：`# | 0° | 30° | 60° | 预测 GV | 误差 | 评分`，点击某行可 **`Load to Forward`**
  回填到正向区继续微调（正向/反向互相联动的闭环体验）。

---

## 6. 持久化与状态

| 键 | 内容 | 时机 |
|---|---|---|
| `ui/light-models.json` | 现场覆盖用的模型（Q4 方案 B） | 导入/标定后 |
| `ui/light-analyse.json` | 上次的目标 GV、偏好、三路输入、Top-N 结果 | 防抖 500ms 自动保存 |

- 沿用 `document-store.ts` 的 `read/write`，与 GV 值同样的"失败必须可见"原则：
  **不允许静默 `.catch(() => {})`**（项目已有先例：操作员的保存曾被静默吞掉）。
- 页面重开时恢复上次状态，与 SETTINGS/TEACH 的行为一致。

---

## 7. 待确认

| # | 问题 | 影响 |
|---|---|---|
| A | 是否需要 `Send to Calibrate`（把推荐值回写到光源/快照）？ | 涉及是否改动生产数据，原则见 README §5 已知限制 |
| B | GV 量程与单位（0~255？0~1023？）确认 | 影响输入校验与容差默认值 |
| C | 是否要在 UI 里画响应面 3D 图（`plotly` / 手写 canvas）？ | 体积与依赖；建议先不做，仅出等高线图（纯 canvas，无依赖） |
| D | White 光是否永远不做？ | 现状（2026-09-23）：用户明确倾向不用 White（混合比例不可控）；若未来要加，White 作为第 4 个 channel 走同一套"标定→BBD→拟合"流程即可，UI 无需特判 |

---

## 8. 测试（无需 Rust 改动）

- **Golden test**：阶段二脚本额外导出一组 `(输入, 期望 GV)` 采样点（例如 20 组随机组合），
  写成 TS 测试的 fixture；断言 UI 的纯函数输出与 Python 一致（误差 < 1e-6）。
  这是**唯一能证明两端公式等价**的手段，必做。
  fixture 必须包含**窄量程模型**（如档位 0/1/2）的用例——验证 coding 反推与
  levels 边界在全量程/窄量程两种模型下都正确。
- 边界用例：档位下限/上限/中档组合、越界输入（低于 low、高于 high）、非法字符、
  模型缺失、`levels` 缺失的旧格式模型（回退 [0,512,1024] 并提示）。
- 反向测试：给定目标 GV → 取输出第 1 候选 → 回代正向 → 误差 ≤ 容差；
  且候选全部落在档位区间内（不允许窗口外解）。
- 运行：项目既有 `npm run build`；测试用 Angular 既有测试配置（若无，先确认测试框架再动手）。

---

## 9. 验收标准

- [ ] 顶级导航出现 `LIGHT ANALYSE`，路由可直达，刷新后仍停留在该页。
- [ ] 正向：拖动滑块实时刷新 GV，无卡顿；与 Python golden 值误差 < 1e-6。
- [ ] 正向：**滑块范围 = 模型档位区间**；窄量程轴用步进按钮；越界输入被拒绝。
- [ ] 正向：超出档位立方体（|u|>1 组合）时显示外推警告。
- [ ] 反向：输入目标 GV 后给出 ≥ 3 组候选，每组回代误差 ≤ 容差、落在档位区间内，
  按选定偏好排序；候选不足时给出明确的目标不可达提示。
- [ ] 模型未标定 / `levels` 缺失时显示清晰空态与指引，而不是空白或报错。
- [ ] 无硬编码路径；持久化失败可见。
- [ ] `npm run build` 通过。
