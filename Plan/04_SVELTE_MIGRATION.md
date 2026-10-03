# UI 技术迁移评估与计划 — Angular 18 → Svelte 5 + Tauri

> 状态:**已执行**(2026-10-03,分支 `refactor-svelte-5`,3 个提交;未合并 main)。
> 结果:svelte-check 0 错误;cargo test 全绿;vite build 通过;`build_app.bat build`
> 打包成功(MSI + NSIS)。JS bundle 431 kB → **174 kB**(gzip 58 kB)。
> 待办:按 §5 第 4 步清单人工回归(TEACH/REVIEW/CALIBRATE/COPIER/Settings +
> Tailscale),确认后合并 main。
> 与计划的差异:前端实际位于 `tauri-app/` 子目录;index.html 移至 `tauri-app/`
> 根(Vite 入口);TypeScript 锁 ~5.9(svelte-check 尚不支持 TS7);剩余 ~27 条
> svelte-check 无障碍警告为既有标记模式,予以保留。

---

## 1. 背景与动机

- 当前前端为 Angular 18(standalone + **zoneless 变更检测**)+ Tauri 2,功能刚稳定:
  TEACH 参数配置、REVIEW 采集/导出、CALIBRATE 标定、Model Copier、Settings。
- 后续计划引入 **OpenCV 做 Align 模拟**(像素级对齐计算),UI 交互复杂度将上升
  (canvas 叠加层、实时滑杆、图像缩放)。
- 动机:在沉没成本扩大前评估技术转型;同时 Angular zoneless 下 20+ 处手动
  `cdr.markForCheck()` 的迭代摩擦是真实痛点。

## 2. 现状量化(2026-10-03 实测)

| 维度 | 数据 | 含义 |
|---|---|---|
| 前端总规模 | 22 个文件、约 2,964 行 | 重写是"天"级不是"周"级 |
| 框架强耦合面 | 10 个组件、约 470 行内联模板、30 处 `ngModel`、2 处 router | 迁移工作量集中于此 |
| 框架无关逻辑 | `app.service.ts` 约 180 行纯逻辑 + 150 行类型;18 处 `invoke()` 全部收敛在 app.service.ts / document-store.ts 两个 seam | 业务逻辑与 Rust 命令层**原样平移** |
| Angular 深度特性 | **零**:无 Material/CDK、无 HttpClient(HTTP 用原生 fetch)、无 animations、无 NgModules、无路由守卫;RxJS 仅 1 个 Subject | 没有难拆的锚点 |
| 现有痛点 | zoneless 下 20+ 处手动 `markForCheck()` | Svelte/Solid 信号模型可直接消灭 |

组件规模:data-collection 372 行、parameter-config 340+112(html)、
model-copier 301、app 294、database-settings 239、machine-management 168、
calibration-light 136、param-table 120、search-select 78、settings 63。

## 3. 关键判断

1. **迁移可行性高**:Angular 在本项目里本质是"模板引擎 + ngModel + router"。
   Svelte 5 runes(`$state/$derived/$effect`)直接对应现有响应式需求,
   `bind:value` 对应 ngModel,`{#each}/{#if}` 对应 `*ngFor/*ngIf`。
   Tauri 官方提供 Svelte 模板,Rust 侧零改动。
2. **OpenCV Align 与 UI 框架选择解耦**:对齐计算的正确归宿是 **Rust 侧**
   (`opencv` crate,异步 Tauri 命令返回对齐结果/叠加层坐标,前端只画 canvas)。
   放前端跑 opencv.js WASM(8–10 MB、内存拷贝多)是下策。
   → 既然计算在 Rust,**现在迁移 UI 框架不影响 OpenCV 计划**。
3. **Bundle 收益**:Angular main bundle 431 kB → Svelte 预计 <120 kB,启动更快。
4. **为什么是 Svelte 5 而非 SolidJS**:两者信号模型同级;Svelte 生态/文档/表单类
   示例更多,对单人维护的内部工具更稳。SolidJS 是合格的备选。
5. **反方论点(维持现状的合理性)**:功能刚稳定有回归风险;Angular 对超大型复杂
   UI 的结构性优势本项目暂用不上;团队 Angular 熟练度若远高于 Svelte,熟悉度
   差异可能抵消 boilerplate 优势。经权衡:**现在迁移**——代码量小、痛点真实、
   OpenCV 扩 UI 前是最后的时间窗。

## 4. 决策记录

| 决策项 | 结论 | 备注 |
|---|---|---|
| UI 框架 | **迁移到 Svelte 5** | 分支 `refactor-svelte-5`,git 历史保底回滚 |
| Align 计算层 | **Rust 侧 opencv crate** | 异步命令 + 前端 canvas 叠加;接口设计约定见 §7 |
| 导航方案 | 不引 router 库 | 现 5 个"路由"实为 tab 切换,`$state` + `{#if}` 等价实现 |
| 回归策略 | 逐页验收清单(§5 第 4 步) | 主分支不受影响 |

## 5. 执行计划(3–5 个工作日)

### 第 1 步:工程脚手架(约 0.5 天)
- `package.json`:移除全部 `@angular/*`、`rxjs`、`tslib` 及 devDependencies 中的
  Angular 工具链;新增 `svelte@^5`、`@sveltejs/vite-plugin-svelte`、`vite`、
  `svelte-check`。保留 `@tauri-apps/api`、`@tauri-apps/plugin-opener`、`fast-xml-parser`。
- 新建 `vite.config.ts`(svelte 插件,端口固定 **1420** + `strictPort`)。
- `src-tauri/tauri.conf.json` 改动:
  `beforeDevCommand: "npm run dev"`;devUrl 保持 `http://localhost:1420`;
  `beforeBuildCommand: "npm run build"`;`frontendDist: "../dist"`(Vite 输出,
  原值 `../dist/afvi-parse/browser`)。
- scripts:`dev: vite`、`build: vite build`、`check: svelte-check`、`tauri: tauri`
  (build_app.bat 的调用方式不变)。
- 删除 `angular.json`、Angular 版 `src/main.ts`、`app.config.ts`、`app.routes.ts`;
  新入口 `src/main.ts` = `mount(App, { target })`。

### 第 2 步:逻辑层平移(约 0.5 天,风险最低)
- `document-store.ts`、`spec-model.ts` 原样保留;`app.service.ts` → `src/lib/service.ts`
  (类型 + 纯函数 + invoke 封装全部不动)。
- **顺手清理**:删除 5+1 处临时调试埋点(`fetch('http://127.0.0.1:7777/event')`
  的 debug-point 块,app.service.ts 4 处 + data-collection.component.ts 1 处)。
- 全局状态:`src/lib/stores.svelte.ts` 用 `$state` 承载 machines / activeSelection /
  teachSelection,替代原 Subject + `activeSelectionChanged$`;组件侧 `$derived`
  自动跟随,**不再需要 markForCheck**。

### 第 3 步:组件移植(约 2 天,按依赖顺序)

| Angular | Svelte | 注意点 |
|---|---|---|
| app.component(壳 + top-nav + info-bar) | `App.svelte` | tab 切换用 `{#if}`;info-bar 读 activeSelection |
| settings.component | `Settings.svelte` | 子页切换 |
| machine-management | `MachineManagement.svelte` | 主 PC IP 推导 + manuallyEdited 覆盖集合逻辑原样 |
| data-collection(扫描/采集/导出 + 模型弹窗过滤) | `DataCollection.svelte` | 弹窗 `{#if}` + backdrop;过滤用 `$derived` |
| model-copier(双联动 + 预览 + 输模型名确认) | `ModelCopier.svelte` | BM/FM 互禁、确认对话框交互逐项保持 |
| parameter-config + param-table | `ParameterConfig.svelte` + `ParamTable.svelte` | 最复杂页,放最后 |
| calibration-light | `CalibrationLight.svelte` | 滑杆 `bind:value` |
| search-select | `SearchSelect.svelte` | props + `bind:value`,options/value/placeholder/disabled |
| database-settings | `DatabaseSettings.svelte` | Mongo/Firestore 配置与迁移 |

样式:CSS 变量(`--bg-panel` 等)留全局 `styles.css`;组件内联样式迁入各
`.svelte` 的 `<style>`(Svelte 自动 scope)。

### 第 4 步:验收(约 1 天)
- `npm run check`(svelte-check 0 错误)、`npm run build`、`npm run tauri build`;
  `cargo test` 应保持全绿(Rust 侧未动)。
- 功能回归清单:
  - [ ] TEACH:选模型 → 参数树展示 → 参数编辑
  - [ ] REVIEW:扫描 3 机 → 弹窗搜索/过滤 → 采集 → Excel 导出
  - [ ] CALIBRATE:滑杆实时响应(无变更检测负担)
  - [ ] COPIER:源/目标联动 → FM/BM 互禁 → 模型搜索 → 预览清单 → 输入模型名确认 → 拷贝结果逐项展示
  - [ ] Settings:机器管理(主 PC IP 自动推导 + 手动覆盖)、Mongo/Firestore 配置与迁移
  - [ ] Tailscale 环境:扫描/采集期间 UI 保持可交互

### 第 5 步(可选收尾)
- 记录 bundle 体积对比(Angular 431 kB → 预计 <120 kB)。
- 移除 Angular 后跑一次 `build_app.bat build` 产出安装包确认脚本兼容。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 功能回归 | 分支隔离;按 §5 验收清单逐页核对 |
| Svelte 5 生态坑(编辑器插件、svelte-check 版本) | 锁 svelte ^5 + 官方 vite-plugin 最新稳定版 |
| `tauri dev` 端口漂移 | Vite `strictPort` 固定 1420,与 tauri.conf.json 严格一致 |
| zoneless 心智差异(手动 markForCheck 惯性) | runes 下禁止混用手动 CD;code review 对照 |

## 7. OpenCV Align 接口设计约定(本次不实现)

- Rust 侧 `src-tauri` 新增异步命令 `align_simulate(...)`:`spawn_blocking` 执行
  opencv 模板匹配/特征对齐,返回结构化结果(偏移矩阵、匹配分数、叠加层坐标点集)。
- 前端只消费结果画 canvas 叠加层,不做任何像素计算。
- 本次迁移中 COPIER 的「preview → confirmed 执行 → 逐项报告」命令封装模式,
  即为该接口的交互模板(含耗时任务的后台执行与进度展示)。
