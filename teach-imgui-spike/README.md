# teach-imgui-spike

原生迁移的可行性原型：Dear ImGui（cimgui-go v1.6.1，ImGui 1.93 WIP）+ GLFW/OpenGL3，替代 WebView2 方案。只验证技术路线，不是完整功能。

## 构建

需要 MinGW-w64（`scoop install mingw`，scoop 不建 gcc shim，需手动加入 PATH）。

```powershell
$env:PATH = "$env:USERPROFILE\scoop\apps\mingw\current\bin;" + $env:PATH
$env:CGO_ENABLED = '1'
go build -ldflags "-s -w -extldflags=-static" -o teach-imgui-spike.exe .
```

- 首次编译约 195 s（cgo 包装层），之后增量约 2 s。
- `-extldflags=-static` 把 libstdc++ / libgcc / winpthread 静态链接，exe 约 12.9 MB，只依赖系统 DLL（含 Win10+ 自带 UCRT）。
- 模块已在本机缓存，`GOPROXY=off` 可离线构建。

## 运行

```powershell
.\teach-imgui-spike.exe                      # 默认读取 ..\reference\FM1\PxRepository\25fbo015-15
.\teach-imgui-spike.exe -ref <型号目录>
.\teach-imgui-spike.exe -selftest -out <目录>   # 跑脚本化阶段、截图、写 spike-metrics.json 后退出
.\teach-imgui-spike.exe -exitafter 12s         # 定时退出（测空闲 CPU）
```

鼠标滚轮以光标为中心缩放，左键拖动平移；左侧调光滑块实时重算整张 5860×4020 图。

## 实测（16 线程 CPU，reference 25fbo015-15）

| 项目 | 结果 |
|---|---|
| 加载 4 张 TIFF（并行） | 171–186 ms；首张图出现 205–269 ms |
| 调光全分辨率重算（LUT + RGBA，多核） | 平均 6.4–8.6 ms |
| 纹理重新上传（94 MB RGBA） | 平均 5–11 ms |
| 不限帧空闲 | 约 1380 fps（0.72 ms/帧） |
| 1 万个 ROI 框叠加 | 约 610 fps（1.64 ms/帧） |
| 1 万行表格滚动（ListClipper） | 约 615 fps |
| 8 倍放大 + 叠加 | 约 1320 fps |
| 常规模式（60 fps + 垂直同步）空闲 CPU | 单核 3.4%（总计 0.21%） |
| 工作集 | 约 420 MB |

中文（微软雅黑）、韩文（Malgun Gothic）、英文（Tahoma）合并字体正常显示；深 / 浅主题与语言运行时切换，无需重载。

## 已知要点

- GLFW 后端在 AfterCreateContext 钩子之后强制开启多视口；固定布局必须在首帧关闭 `ConfigFlagsViewportsEnable`，否则贴边面板会被拆成独立系统窗口。
- 后端默认 30 fps 目标帧率并持续重绘；正式版设 60 fps，若要空闲零重绘需自定义主循环（`glfwWaitEvents`）。
- 纹理接口只有创建 / 删除（`glTexImage2D` RGBA），没有局部更新；调光走 CPU LUT 已足够快。若改用 GPU 着色器需额外引入 OpenGL 绑定。
- 后端纹理固定 `GL_LINEAR` 过滤，高倍放大时像素会被插值，像素级检查需要自定义纹理参数。
- `PrintWindow` 会重入 GLFW 刷新回调，截图只能放在 AfterRender 钩子里执行。
