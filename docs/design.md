# 教学软件界面与数据流

## 当前结构（2026-10-17）

应用保持 TEACH / REVIEW / CALIBRATE / SETTINGS 四个常驻标签，中心 MEDIAN / Pattern 舞台始终挂载。保留现有工具栏、Align/ROI 分支、ROI 工具条、颜色与明暗主题。

- TEACH：Unit / Dummy、Light、检测节点与参数；Align/ROI 的 Metal 节点切换 Pattern，其他节点回到 MEDIAN。
- REVIEW：缺陷列表与预览结构，当前未接入检测结果。
- CALIBRATE：光源页、通道、GV 实测值与教学显示。
- SETTINGS：型号选择、机台配置、图像与对齐、教学参数四个折叠分区。

左侧 Connector 同时只选择一台机台和一个 Vision。切换 Connector 保留当前型号名，并从新机台解析数据；缺失源需显示具体错误。Model 弹窗读取 PxInventory 型号列表，因此仅有 XML 的 reference 也能选择型号。

## 参数数据流

1. 启动时读取本地 machines.json，并把发现的 reference 机台放在首位。
2. 读取 ui/active-selection.json。选择无效或不可读时，回退 reference 的首个型号。
3. service.ts 调用 read_model_sources，后端读取三个 Vision 的 LightSpec、InspectionSpec 及字典，不写文件。
4. 参数树按完整 Host / Light / GPNODE / PNODE / CNODE 路径构建，显示数据只存在内存中。
5. 标签切换与返回已加载型号保留会话修改；Reload 确认后重新读 XML，并同步常驻面板。读取失败保留当前修改。

NodeCheck、数值输入和 Load XML 仅改变会话数据。输入保留 Enter 确认、Escape 恢复与有限数字校验。ROI、GV、TEACH 位置及当前选择分别保存到原 app-data JSON 路径。reference 不可编辑或删除，也不写入用户机台列表。

## 图像与对齐

图像链路、app-cache 目录与淘汰策略保持原样：大图解码通过串行闸，前端只接收下采样 JPEG 和元数据。缩放/平移、矩形/椭圆/多边形 ROI、量尺、GV 读数和工具互斥沿用已有行为。

AlignData 的 SR / Metal 为同网格时走 identity 合成：SR 涂绿，Metal 后涂黄。旧 GB / L01 来源按 overlay 管线处理，不能把跨层配准强套在 AlignData 同网格上。详见 07_ALIGNDATA_OVERLAY_PLAN.md 与 ALIGN_OVERLAY_DEV_NOTES.md。

reference 仅提供 XML 时，不具备 MEDIAN、AlignData 或 GB/L01 TIFF。灰色 Pattern 或 missing 信息属于源数据边界；彩色叠加验收需额外提供真实图像。历史诊断图已不随仓库保留。

## 教学光源与 GV

- 各 Light 页的通道独立叠加，Page Index 与工具栏灯泡共用 selectedPage。
- RGB 通道与灰度显示使用同一份模拟状态，切换入口保持同步。
- 教学亮度增益、对比度仅改变显示。GV 测量按当前选中的源图、ROI 和坐标比例计算，不能把显示增益后的像素当作原始 TIFF 测量值。
- 预览与原 TIFF 尺寸必须区分；ROI 从预览映射回原始像素后测量。
- GV 数值保存在 ui/gv/<machineId>/<model>.json，不保存光源配方到设备。

## 交互边界与验证

常驻面板不可因切换标签而重新初始化。异步型号读取需去重并防止过期响应覆盖新选择。Reload 应更新所有使用同一型号的面板；有修改时确认丢弃。机台扫描与 XML 文件读取在工作线程运行，本地路径不触发 net use。

左侧扳手展示独立实机配置教学面板，其值仅为本地 UI 偏好。保持面板展开、搜索、排序与现有样式；应用配置入口以 SETTINGS_HIDDEN_ENTRIES.md 为准。

本轮实际验收见 TODO.md 顶部，不把历史构建结果视为当前验收。
