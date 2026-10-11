# fts — High-speed file transfer tool (Windows + QUIC)

[简体中文](README.md) | [English](README.en.md) | [한국어](README.kr.md)

End-to-end transfer of GB-scale files: QUIC multi-stream parallelism + per-chunk BLAKE3
verification + resumable transfers + automatic TCP fallback + inbox pre-registration +
many files over a single connection + concurrent sessions + daemon/REST/gRPC/C-DLL
integration.

> **Integrators: read [API.md](API.md)** — the standardized interface documentation
> (complete field tables for gRPC/REST/CLI/C ABI, error codes, event model, typical
> integration flows).

## Current status (P5 complete)

| Capability | Status |
|---|---|
| Single/multi-file send/recv (QUIC, N parallel streams, many files per connection) | ✅ |
| Per-chunk BLAKE3 verification + single-level Merkle root (cannot be disabled) | ✅ |
| Resumable transfer (periodic checkpoints, crash-recoverable, per-file) | ✅ |
| TCP fallback (auto-degrade when QUIC is unreachable / force with `--transport`) | ✅ |
| Certificate pinning (TOFU: fingerprint verification) | ✅ |
| Exit-code contract + `--json` NDJSON events | ✅ |
| daemon + REST API + SSE event stream | ✅ |
| **inbox pre-registration** (per-task receive directory; file/directory binding modes) | ✅ |
| **Concurrent sessions on the receiver** (`--max-sessions`; concurrent for QUIC, mutually exclusive for TCP) | ✅ |
| **gRPC (tonic)**: Capabilities/ReserveInbox/PurgeInbox/Submit/Observe/Status/Cancel | ✅ |
| **Orchestration server** (Python, `orch/`): gRPC control of both ends + parallel tasks + progress bars + minimal web UI | ✅ see [plan/fts-server-demo.md](plan/fts-server-demo.md) |
| C ABI DLL (verified with Python ctypes) | ✅ |
| Tailscale link probing (observability) | ✅ observation only |
| FEC / BBR / Nack retransmission / multi-host relay | ❌ see plan/fts-design.md §9 |

## Build

```
cargo build --release
# artifacts: target\release\fts.exe (CLI/daemon), target\release\fts.dll (C ABI)
```

## One-click start (config file)

`config.json` (defaults ship with the repo; just edit it):

```json
{
  "rest_addr": "127.0.0.1:5050",
  "grpc_addr": "127.0.0.1:50051",
  "listen_addr": "0.0.0.0:4433",
  "out_dir": "downloads",
  "cert_cache": ".fts",
  "max_sessions": 3
}
```

```powershell
.\build.ps1                  # build + collect every runtime artifact into dist\ (exe/dll/config/scripts/docs)
# copy the whole dist\ folder to the target machine (no scripts, no PowerShell execution-policy restrictions):
fts start                    # start in the background (reads config.json automatically; returns only once the health check passes)
fts status                   # running (pid=..., healthy)
fts stop                     # stop
fts daemon                   # run in the foreground (for debugging)
fts daemon -c config.json --rest 127.0.0.1:6000   # CLI args override the config file
```

If you prefer scripts: `fts-daemon.cmd` (a cmd wrapper with `-ExecutionPolicy Bypass`
embedded, unaffected by execution-policy restrictions) or `fts-daemon.ps1` (needs
`Set-ExecutionPolicy` or `-Bypass`).

Precedence: **explicit CLI args > config file > built-in defaults**. The receive
directory supports UNC/SMB network paths (credential requirements in API.md §11.1);
writability is pre-checked at daemon start and at inbox registration.

## Quick start

```powershell
# 1. Receiver (prints the certificate fingerprint)
.\target\release\fts.exe recv --listen 0.0.0.0:4433 --out .\downloads

# 2. Sender (TOFU: copy down the fingerprint the first time)
.\target\release\fts.exe send .\bigfile.bin --to <peer-IP>:4433 --fingerprint <fingerprint> --streams 4

# Whole folder (recursive: all subdirectories transferred together, rebuilt as-is on the receiver)
.\target\release\fts.exe send .\myfolder --to <peer-IP>:4433 --fingerprint <fingerprint>

# UDP blocked: falls back to TCP automatically (or force it with --transport tcp)
.\target\release\fts.exe send .\bigfile.bin --to <peer-IP>:4433 --fingerprint <fingerprint> --transport tcp

# Script integration: NDJSON events + exit codes
.\target\release\fts.exe send .\bigfile.bin --to <IP>:4433 --fingerprint <fingerprint> --json
if ($LASTEXITCODE -ne 0) { throw "transfer failed: $LASTEXITCODE" }  # 4 = verification failed, data untrusted
```

### CLI at a glance

```
fts send <PATH>... --to <ADDR> [--fingerprint <HEX> | --insecure] [--streams N]
              [--chunk-size B] [--transport auto|quic|tcp] [--ticket <T>] [--json]
              # multi-path/directory (directories are expanded recursively; the subtree is rebuilt
              # identically on the receiver; duplicate relative paths -> exit code 2;
              # empty directories are not recreated; directory symlinks are not followed)
fts recv --listen <ADDR> [--out DIR] [--transport auto|quic|tcp] [--cert-cache DIR] [--json]
fts daemon [--rest 127.0.0.1:5050] [--listen 0.0.0.0:4433] [--out DIR]
           [--cert-cache DIR] [--max-sessions 3] [--grpc 127.0.0.1:50051]
fts start|stop|status [-c CONFIG]     # background daemon lifecycle (pid file + REST health check)
fts push-update --to <ADDR> --dist <DIR> [--overwrite-config] [--force]
                                      # push a new dist to a remote host; the target daemon self-replaces and restarts (W9)
```

Exit codes: 0 success / 1 generic / 2 arguments / 3 connection·version /
**4 verification failed (data untrusted)** / 5 interrupted (resumable) / 6 cancelled / 7 auth.

## daemon + REST + gRPC (the main integration path)

```powershell
.\fts-daemon.ps1 start          # or run fts daemon ... manually (see the args above)
```

Typical integration flow (per-client directory + batched multi-file):

```
1. POST /v1/inbox {out_dir: "D:\\fromA"}            → {token}     (directory mode, reusable within the 10-min TTL)
2. POST /v1/transfers {paths: [...12 files], dst_addr, ticket: token} → {task_id}
3. GET  /v1/transfers/{id}/events                    → SSE event stream (file/progress/file_done/result)
4. (optional) POST /v1/transfers/{id}/cancel
```

gRPC equivalent endpoints (proto/fts.proto): `Capabilities / ReserveInbox / PurgeInbox /
Submit / Observe(stream) / Status / Cancel`, default `127.0.0.1:50051`.
Python end-to-end example: `python tests\grpc_smoke.py <fingerprint>`.

`Capabilities` is self-describing (new in this version): it returns `fingerprint` (the
certificate's BLAKE3 hex) and `listen_addr` (the data listen address), so an
**orchestrator needs only the gRPC address to automate everything** — no manually copying
fingerprints.

### REST endpoints

```
GET  /v1/capabilities
POST /v1/inbox {out_dir, file_name?}     → {token, expires_in}   # empty file_name = directory mode
DELETE /v1/inbox/{token}
POST /v1/transfers {paths|src_path, dst_addr, fingerprint, ticket?, ...}
GET  /v1/transfers   |  GET /v1/transfers/{id}
POST /v1/transfers/{id}/cancel
GET  /v1/transfers/{id}/events           → SSE
```

### C ABI (Python example, see tests/ffi_smoke.py)

```python
import ctypes
lib = ctypes.CDLL("fts.dll")
lib.fts_send_file.argtypes = [ctypes.c_char_p]*2 + [ctypes.c_char_p, ctypes.c_int32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_char_p]
rc = lib.fts_send_file(b"C:\\data\\big.bin", b"100.64.0.5:4433", b"<64-hex fingerprint>", 0, 4, 0, b"auto")
if rc: print(lib.fts_last_error().decode())   # rc: 3 connection / 4 verification / 7 auth …
```

## Orchestration server (multi-host orchestration + minimal web UI)

`orch/` is a standalone Python orchestration service: you give it the hosts and paths at
both ends, and it drives both ends over **gRPC** to complete the transfer (the source
pushes; the server never moves data), supporting parallel tasks, progress bars, error
reporting and a browser UI. Full walkthrough in
[plan/fts-server-demo.md](plan/fts-server-demo.md); usage in
[orch/README.md](orch/README.md).

```powershell
python -m pip install -r orch\requirements.txt
python orch\gen_proto.py                                        # generate the gRPC stub
python orch\cli.py --config orch\config.json --check            # probe both ends
python orch\cli.py --config orch\config.json --pairs "A1:B1,A2:B2,A3:B3" `
    --src-path C:\data\payload.bin --dst-path D:\recv           # parallel orchestration
python orch\cli.py --config orch\config.json --serve            # web UI: http://127.0.0.1:8080
powershell -ExecutionPolicy Bypass -File orch\run_local_demo.ps1  # 6-daemon single-machine simulation, reproducible in one command
```

For cross-host orchestration the daemons need `--grpc 0.0.0.0:50051` and a firewall
allowance; the server only needs each host's gRPC address.

## Remote updater (fill in an IP, one-click version switch)

Upgrading a version across dozens of machines is no longer a manual "kill process → copy
files → restart": the daemon supports W9 remote self-update (the new build is pushed to a
staging directory on the target over fts, then the target daemon backs up / overwrites /
restarts / rolls back on failure, automatically).

```powershell
# Command line
target\release\fts.exe push-update --to 192.168.1.60 --dist dist\

# GUI (Tauri 2 + Svelte 5, built on the dev machine; fill in IPs to bulk-update)
.\build.ps1 -Updater
updater\src-tauri\target\release\fts-updater.exe
```

First bootstrap: the target must already have run a dist that includes W9 (older builds
lack the BeginUpdate RPC); after that everything is remote. The target's `config.json` is
not overwritten by default; update logs live at `.fts\update\apply.log` on the target.
Design and lessons learned in
[plan/fts-updater-design.md](plan/fts-updater-design.md).

## Wire protocol (fts-protocol v1)

```
control stream (bidirectional): Hello ↔ Hello → Manifest (chunk hash table + Merkle root) → ManifestAck (may carry a resume bitmap)
              → [data streams: N in parallel; chunk frame = id:u32|offset:u64|len:u32|payload]
              → Finish → FinishAck → (the sender closes the connection after the receiver has read the Ack)
```

Contract details in [plan/fts-api-spec.md](plan/fts-api-spec.md) (v1.0 frozen); the current
implementation is a P0–P3 subset of it — see [plan/dev-log.md](plan/dev-log.md) for the
diff list.

## Security model

- Transport: QUIC = TLS 1.3 (per-packet encryption + integrity) + per-chunk BLAKE3 (end-to-end).
- Identity: self-signed certificate + fingerprint pinning (TOFU). `--insecure` should only
  appear in test environments.
- REST listens on localhost only by default; the control plane (REST/gRPC) has **no remote
  authentication**. Cross-host orchestration requires binding gRPC to `0.0.0.0` and
  restricting access with a firewall/ACL — **trusted networks only (LAN/Tailscale)**.
- `Capabilities` returns the certificate fingerprint (needed for self-description); this does
  not affect the transfer security model (the data plane still uses per-chunk BLAKE3 + fingerprint pinning).

## Known limitations (honest list)

- Loopback benchmarks ≠ real networks: 1 GB over loopback is ~340 MB/s on QUIC and
  ~1900 MB/s on TCP (loopback has no RTT/packet loss); **two physical machines / cross-region
  numbers are still unmeasured**.
- One corrupt chunk fails the whole transfer (no Nack-level retransmission); FEC/BBR are not
  implemented (design in plan/fts-design.md §9).
- The daemon's REST/gRPC have no authentication; any local process can call the cancel endpoint.
- Tailscale probing is observation-only (emits `path` events) and is not wired into fallback decisions.
- TCP fallback sessions are globally mutually exclusive (data streams share the listener with
  new sessions, so they cannot be told apart); QUIC sessions can run concurrently (default 3).
- Multi-file: any single file failing aborts the whole task (no --keep-going).

## Directory layout

```
src\          main(CLI) lib(entry) send recv protocol tls ui error probe daemon grpc inbox netcred ffi update
include\      fts.h (C header)
proto\        fts.proto (gRPC contract)
orch\         orchestration server (Python): gRPC control of both ends + web UI + single-machine demo script
updater\      remote updater GUI (Tauri 2 + Svelte 5): fill in an IP to push a new dist and self-replace/restart
tests\        ffi_smoke.py (ctypes), grpc_smoke.py (gRPC end-to-end), update_e2e.py (remote update end-to-end)
plan\         design documents, API contract, dev log, orchestration-server case study (AGENTS.md discipline)
```

The whole development process (problem → root cause → solution) is recorded in
[plan/dev-log.md](plan/dev-log.md).
