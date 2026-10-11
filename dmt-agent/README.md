# dmt-agent — 站点局域网 Agent

一个小型 Windows 守护进程，部署在**每个站点**的一台常驻主机上（通常是主 PC）。
桌面端（AFVI Parse）通过 Tailscale 把「模型扫描 / 模型复制」请求发给它，由它在
站点**真实局域网内**以千兆速度访问各 Vision PC 的 `PxInventory` / `PxRepository`
共享执行——**千兆数据流不出站点，跨广域网的只有控制指令和进度**。

复制的计划构建、删除防护（`assert_deletable`）、模型名规范化等全部领域逻辑
在共享 crate `dmt-copy-core` 中，agent 与桌面端直连回退路径使用**同一份实现**，
行为完全一致。

## 为什么需要它

桌面端所在 PC 往往不在设备局域网内（只经 Tailscale subnet 路由可达）。SMB 是
高往返协议，在高延迟链路上逐文件拷贝极慢。agent 把数据面搬回局域网：
桌面端 → agent 只走 Tailscale（几 KB 控制流量），agent ↔ Vision PC 走千兆 SMB。

## 构建

```bat
build_app.bat agent 我的站点口令
```

（也支持 `--token 口令` 写法；不带口令则只出 exe，不生成配置和脚本。）

产物在 `dmt-agent\target\release\`，共四个文件：

| 文件 | 用途 |
|---|---|
| `dmt-agent.exe` | agent 二进制（单文件、无运行时依赖） |
| `agent.json` | 已写入你的口令，默认端口 3777 |
| `install_service.bat` | 一键注册为系统开机自启任务并立即启动 |
| `uninstall_service.bat` | 一键终止进程并卸载注册 |

## 部署（每个站点一次，全程无需手动编辑配置）

1. 把 `target\release\` 整个文件夹（四个文件）拷到该站点主 PC（或任何能
   访问三台 Vision PC 共享的常驻 Windows 主机），例如 `C:\Tools\dmt-agent\`。
2. **右键"以管理员身份运行" `install_service.bat`** —— 它会：
   - 注册计划任务 `dmt-agent`（SYSTEM 账户、开机自启、无可见窗口）；
   - 立即启动当前实例；
   - 重复运行安全（先停旧实例再覆盖注册）。
3. 卸载/停止：管理员运行 `uninstall_service.bat`。
4. 桌面端 → SETTINGS → Machine Management，在对应机器填入
   **Site LAN Agent address**（如 `192.168.1.60:3777`）与 **Agent token**，
   点 **Test agent** 验证。

> 口令变更：在本机改好口令重新跑 `build_app.bat agent 新口令`，
> 把重新生成的 `agent.json` 覆盖到站点即可（或直接编辑站点上的 agent.json）。
> 手动调试时也可不带配置直接跑：`dmt-agent.exe --port 3777 --token <口令>`。

## 跨站点复制（FTS 数据平面，主路径）

两端主 PC 都部署了 fts daemon（协议 ≥ v4 的 agent）时，跨站复制的文件字节
直接走两端 fts daemon 之间的 QUIC/TCP 通道，agent 只做编排与落盘：

```
桌面端 ──TCP控制──► 源站点agent ──localhost REST──► 源 fts daemon
                      │                              │ QUIC 4433（TCP回退）
                      │ agent协议 v4：               ▼
                      │ FtsPrepare/Reserve/      目标 fts daemon ◄──localhost REST── 目标站点agent
                      │ Finalize                     │ staging
                      ▼ SMB千兆读                    ▼ SMB千兆写
                  源 Vision PC                  目标 Vision PC
```

- **控制面不变**：桌面端仍然只连 agent（NDJSON/3777）。agent 通过
  **localhost REST（5050）** 控制各自的 fts daemon——fts 的 REST/gRPC
  仅监听本机，**绝不暴露到网络**
- **端到端完整性**：fts 全链路 BLAKE3 逐块校验 + Merkle 根，不可关闭；
  传输层 QUIC 优先，4 秒内自动回退 TCP（4433）
- **断点续传**：任务中断后以同一 ticket 重发即自动补缺失块；agent 对
  `INTERRUPTED`（错误码 5）自动重试一次，无需人工干预
- **增量语义变化**：FTS 不做「目标已有文件跳过」——FTS 路径每次全量传输；
  原 size+mtime 增量仍在中继回退路径上生效
- **落盘与删除防护不变**：fts 落到目标 Vision PC 的 staging 目录
  （`.dmt_stage_fts_*`，inventory/repository 根下，2h 清扫），完成后走与
  其他复制路径完全相同的 `assert_deletable` 删除防护 + 原子 rename 换入；
  rename-on-copy 在换入时完成「源名 → 目标模型名」转换
- **指纹**：agent 自动读取本机 fts 证书缓存里的 `fts-cert.der` 计算
  BLAKE3 指纹（与 daemon 启动时打印的一致），无需人工抄录；读不到证书
  即回落中继
- **协议版本**：FTS 数据面要求两端 agent ≥ **v4**；任一端过旧自动回落
  QUIC 中继

### agent.json 可选 `[fts]` 段（全部有默认值，零配置可用）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | `false` 关闭 FTS 数据面（跨站一律走中继） |
| `rest_addr` | `127.0.0.1:5050` | 本机 fts daemon 的 REST 地址（保持 localhost） |
| `data_port` | `4433` | 本机 fts daemon 的数据面端口 |
| `cert_cache` | exe目录`.fts` | fts 证书缓存目录（含 `fts-cert.der`） |

### 部署前提（每个站点一次）

1. **fts daemon 常驻**：`fts daemon --rest 127.0.0.1:5050 --listen 0.0.0.0:4433
   --out <默认接收目录>`（建议与 dmt-agent 相同方式注册开机自启）
2. **fts daemon 的账号必须能读写 Vision PC 共享**：fts 的发送侧不会代建
   SMB 会话。最简单做法：fts daemon 与 dmt-agent 用**同一账号**运行（同为
   SYSTEM 计划任务），或在该账号下 `cmdkey /add:<VisionPC主机> /user:...
   /pass:...` 预存凭据
3. **接收侧凭据**：staging 目录是需要认证的 UNC 共享时，agent 会把机器配置
   里的账号密码经 inbox credential 接口交给 fts daemon 代建会话
   （fts 保证密码不进日志）
4. **防火墙**：站点主 PC 放行 **UDP 4433** 入站（TCP 4433 为回退；
   Tailscale 直连场景流量走 WireGuard 隧道，一般无需额外放行）

### 验收清单（真机）

- [ ] 两端 `fts daemon` 在跑：本机 `curl 127.0.0.1:5050/v1/capabilities` 正常，
      数据面监听 4433
- [ ] 跨站复制成功：两端 agent.log 出现 `[fts] prepared / submitted /
      finalize`，UI 档位显示 `FTS (QUIC, checksummed)`
- [ ] 停掉任一站点 fts daemon 再复制 → agent.log 出现回落日志，UI 档位变为
      `QUIC direct (fast)`（中继路径）
- [ ] 传输中杀掉 fts daemon → 中继兜底；`INTERRUPTED` 场景重发自动续传

### 回退：Agent 中继 + QUIC

FTS 数据平面不可用（未部署 / 证书读不到 / 目标 agent 过旧 / 传输失败）时，
跨站复制自动回落到自研中继路径。源站点与目标站点**都部署了 agent** 时：

```
桌面端 ──TCP控制──► 源站点agent ──QUIC/UDP + zstd──► 目标站点agent
                       │SMB千兆读                   │SMB千兆写
                       ▼                            ▼
                   源 Vision PC                 目标 Vision PC
```

- **QUIC（HTTP/3 传输层）**：UDP 3777 端口（与 TCP 控制端口同号不同协议），
  单连接 6 路并发流、无 TCP 队头阻塞、丢包自动重传、TLS 1.3 加密；
  逐文件 zstd 压缩（Gerber 文本通常省 60-80% 流量）
- **增量传输**（默认开）：目标端已有同名且大小+修改时间一致的文件直接跳过；
  UI 上「Force full transfer」勾选后强制全量
- **四级降级链（全自动，保证成功率）**：
  0. **FTS 数据平面**（两端 fts daemon，QUIC/TCP 4433，BLAKE3 校验）——首选；
  1. **QUIC 直连**（UDP 3777，多流 + zstd）；
  2. **TCP 数据平面**：QUIC 失败（UDP 被防火墙拦/NAT 打不通）时，同样的传输
     协议隧道进普通 TCP 3777 连接——只要 TCP 能到达目标 agent 就能传完；
  3. **直连 SMB**：两级中继都失败才回落，桌面端自动执行并提示慢速。
  进度行实时显示当前档位（`QUIC direct (fast)` / `TCP data plane (UDP blocked - slower)`）
- **协议版本**：跨站复制要求两端 agent ≥ **v3**（旧 agent 自动回落直连）
- **地址规划（关键）**：跨站点时 LAN IP 会撞车——两个站点都用 192.168.1.x 时，
  `192.168.1.60` 在不同站点指向**不同机器**，中继会拨回错误的站点甚至自己。
  agent 地址必须填各站点主 PC 的 **Tailscale IP（100.x.x.x）**；agent 拨号前
  会检测目标地址是否解析到自己，命中时直接报错提示改用 Tailscale IP
- **自动回落**：agent 未部署/不可达/UDP 被防火墙拦 → 桌面端自动回落直连
  SMB 并提示慢速，功能永远可用
- **防火墙**：确保站点 agent 主机放行 **UDP 3777** 入站（Tailscale 直连时
  流量走 WireGuard 隧道，一般无需额外放行）
- 证书：agent 首次启动自签 `relay_cert.der` / `relay_key.der` 存于 exe 目录，
  删除即重新生成；认证仍靠站点 token，证书不作信任锚

## 日志

agent 的所有输出同时写到**两处**：

- 控制台 stderr（手动命令行运行时直接可见）
- **`agent.log`**（exe 同目录，即 agent.json 旁边）——计划任务/SYSTEM 服务
  没有控制台，排查问题**只看这个文件**

超过 5MB 自动轮转为 `agent.log.old`。时间戳为 UTC。内容包括：启动与端口绑定、
QUIC 中继握手与认证结果、复制任务的 panic 位置和原因、连接错误。

> 排查跨站复制中断：看**两端**的 agent.log——源站点（发送方）和目标站点
> （接收方）各一份。`PANIC at ...` 行会给出确切的代码位置，把那一行发出来即可定位。

### 重要：SYSTEM 服务没有你的共享凭据

安装脚本把 agent 注册为 **SYSTEM 账户**运行（session 0）。SMB 登录会话按
Windows 登录会话隔离——命令行窗口手动运行时 agent 复用的是**你的**已缓存
共享会话，而 SYSTEM 是全新身份、什么凭据都没有。所以：

- **机器配置里必须填网络用户名/密码**（设备账号，如 `pixel`，支持空密码），
  agent 才能以 SYSTEM 身份自动 `net use` 登录各 Vision PC 的共享；
- 命令行测试正常但服务下报 `os error 5`（拒绝访问），几乎都是这个原因；
- 改凭据后无需重启 agent，下一次扫描/复制会自动重新登录。

## 工作方式

- 协议：TCP + NDJSON（一行一个 JSON）。首帧认证（token 常数时间比较），
  之后一连接一请求：`ping` / `scan_models` / `copy`。`copy` 执行期间逐文件
  回吐进度行，桌面端进度条实时更新。
- 安全：流量全程在 WireGuard（Tailscale）加密隧道内，token 防同网段未授权
  连接；复制复用桌面端相同的 `net use` 凭据语义（空密码设备账号可用）。
- 回退：源/目标机器的 agent 地址**不一致或未配置**时，桌面端自动回落到
  直连 SMB 路径（跨站点复制本来就无 agent 可用）。

## 开发

```bash
cargo test        # 协议、认证、端到端 scan+copy（含进度流）测试
cargo check
```

结构：`src/main.rs` —— 监听循环、NDJSON 处理、三个 op 的分发；
领域逻辑一律调 `dmt-copy-core`。配置解析支持 `--config / --port / --token`。
