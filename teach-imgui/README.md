# Color AFVI Master Teach（原生版）

## 简介

本目录是 Color AFVI Master Teach 的原生实现：Go + Dear ImGui（cimgui-go v1.6.1 / ImGui 1.93 WIP，GLFW + OpenGL3 后端），取代 teach-app 的 WebView2 外壳。teach-app 与 teach-core 仍保留在仓库中，作为规格说明与对照实现。

## 构建

前提：

- Go 1.27
- MinGW-w64：`scoop install mingw`（scoop 不会创建 gcc shim，`build.ps1` 会自动把 `%USERPROFILE%\scoop\apps\mingw\current\bin` 加到 PATH 前面）

常用命令：

```powershell
.\build.ps1              # gofmt + go vet + core 测试 + 构建
.\build.ps1 -Selftest    # 构建后运行自测并解析 native-metrics.json
.\build.ps1 -Offline     # GOPROXY=off，使用已就绪的模块缓存离线构建
```

首次编译约 3 分钟（cgo 包装层），之后增量编译约 2 秒。静态链接后 exe 约 7 MB，只依赖系统 DLL（含 Win10+ 自带的 UCRT）。模块缓存就绪后可用 `GOPROXY=off` 离线构建。

## 运行参数

| 参数 | 说明 |
| --- | --- |
| `-ref <目录>` | reference 目录（包含 FM1/FM2/BM） |
| `-theme dark\|light` | 界面主题 |
| `-lang zh\|en\|ko` | 界面语言 |
| `-model FM1/25fbo015-15` | 启动时打开的型号 |
| `-selftest` | 自测模式：遍历所有页签、主题与语言，保存截图与指标后退出 |
| `-out <目录>` | 自测输出目录 |
| `-exitafter 12s` | 指定时长后自动关闭窗口 |

reference 查找顺序：`-ref` → 环境变量 `AFVI_REFERENCE_DIR` → exe 目录及向上 5 级的 `reference/` → 工作目录及向上 5 级的 `reference/`。

## 操作

- 滚轮：以光标为中心缩放
- 中键 / 右键拖动：平移
- 双击：适应窗口
- 左键：当前页工具
  - 光照页：拖框测量 GV
  - 对齐页：新建 ROI / 遮挡，选择移动，Delete 删除选中 ROI
  - 缺陷页：画点 / 线 / 块 / 异物 / 污染，探查
- 顶栏：切换型号、页签、深浅主题、中英韩语言，切换均不重载

## 目录结构

- `core/`：teach-core 的 Go 移植（gray、rng、light、warp、align、defect）
- `main.go`：入口、字体、窗口
- `app.go`：Panel 接口、共享状态、布局
- `jobs.go`：后台任务（每个 key 最多 1 个在途 + 最新待办替换，结果在 UI 线程应用）
- `viewer.go`：图像视图与叠加 API
- `models.go`：型号扫描、AlignSpec 解析、并行加载
- `pack.go`：RGBA 缓冲池与并行打包
- `widgets.go`：控件库
- `theme.go`：主题
- `i18n.go`：多语言
- `panel_light.go`：光照页
- `panel_align.go`：对齐页
- `panel_defect.go`：缺陷页
- `selftest.go`：自测
- `capture_windows.go`：Windows 截图

新增页面：实现 Panel 接口并在 `init()` 调用 `registerPanel`。

## 验证

- `go test ./core/...`：58 个测试（逐个移植 TS 单测 + RNG/颗粒哈希逐位对照 + 并行与串行一致）。
- 跨语言一致性（在 reference 25fbo015-15 上，Go 与 TS 各输出摘要后比对）：16 个检查段 0 差异；扭曲图（含弯曲、模糊、噪声、遮挡）与加噪缺陷测试图与 TS 逐字节相同；对齐结果与 Web 版一致（tx −0.59、ty −0.33、真值误差均值 0.532 px）。
- `-selftest`：加载型号后依次走三页 × 深浅主题 × 三语截图，并注入合成鼠标输入断言：滚轮缩放 ×1.2、中键平移 (80, −40) px、拖框测量尺寸、对齐页新建 ROI 并重跑、缺陷页画亮块后重新渲染检出、探查得到结果；输出 `native-metrics.json` 与 6 张截图。
- 实测（16 线程、reference 25fbo015-15）：加载约 300 ms；光照渲染约 29 ms；GV 测量 15–25 ms；对齐（1/2 工作分辨率）约 150 ms；缺陷渲染 + 检出约 200 ms；UI 每帧 < 1 ms。

## 已知限制

- 纹理固定线性过滤，高倍放大像素会被插值。
- 60 fps 持续重绘（原型实测空闲约单核 3.4%）。
- 字体取自 `C:\Windows\Fonts`（tahoma / msyh / malgun），仅 Windows。
- 未做高 DPI 缩放适配。
- 相对阈值与成像噪声仍是教学近似，Margine、Offset1/2、Pad Offset、Block Offset 等机台参数未模拟。
- 自测的鼠标交互在视图层注入，不经过 GLFW 真实输入。
