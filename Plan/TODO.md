# TODO

## 阶段 1: 主题基础设施 — done
- [x] styles.css: 变量扩展（--bg-elev/--tint-*/--row-*），dark 默认 + light 调色板
- [x] lib/theme.ts: 双调色板 + 生成 <style> 注入 + localStorage 持久化
- [x] main.ts: 挂载前 applyTheme（防闪暗）

## 阶段 2: 组件配色变量化 — done
- [x] 两轮 PowerShell 脚本 (plan/themize.ps1, themize2.ps1) 批量映射 style 块
- [x] 手工修正: Settings color:white、ParameterConfig .host/.status-line/.legacy-warning/.reload-confirm、DataCollection/DatabaseSettings tint-info、ModelCopier .warning、行名 JS 色

## 阶段 3: 启动目检 + 交互优化 — done
- [x] 亮色逐页目检: TEACH/CALIBRATE/COPIER/SETTINGS 全部正常（浏览器 + 真实窗口）
- [x] WebView2 原地换肤不重呈现 → 切换 = 持久化 + reload；activeTab 跨重载持久化
- [x] "黑框"排查: 与 AFVI 应用无关（后端零外部进程调用），系机器后台工具控制台窗口

## 阶段 4: 收尾 — done
- [x] tauri build release（AFVI_Parse_0.1.0_x64-setup.exe / msi）
- [x] svelte-check 0 错误（30 警告均为既有 a11y 提示）
- [x] CDP 回归: dark→light→dark 三态计算样式全对，持久化正确

## 阶段 5: 黑框根因修复 + 删除 Model-Copy — done
- [x] credentials.rs: net.exe 加 CREATE_NO_WINDOW（黑框根因：GUI 进程 spawn net use 每次闪一个控制台，启动恢复选区加载 median 时连发十几个）
- [x] 后端: 删 preview_model_copy/copy_model_between_hosts/agent_ping/agent_scan_models/agent_copy_model/agent_copy_cross_site + 相关 import/注册
- [x] 前端: 删 COPIER 导航/页签/ModelCopier.svelte、service.ts 复制 API（CopyEndpoint/CopyPlan/CopyReport/AgentProgress/MachineAgent/endpointFor/testAgentConnection/copyModel*）、stores AppTab、MachineManagement agent 配置块
- [x] dmt-copy-core 保留（credentials/scan_hosts/find_model_dir 被 median/XML/align 加载复用）
- [x] cargo test 67 通过 / svelte-check 0 错误 / release 重建 / 冒烟: 启动+median 加载期间 conhost 零增长，导航无 COPIER
