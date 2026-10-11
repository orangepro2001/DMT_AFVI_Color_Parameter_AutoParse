# fts — 고속 파일 전송 도구 (Windows + QUIC)

[简体中文](README.md) | [English](README.en.md) | [한국어](README.kr.md)

GB급 대용량 파일의 종단 간 전송: QUIC 멀티 스트림 병렬화 + 청크별 BLAKE3 검증 +
이어받기(재개) + TCP 자동 폴백 + inbox 사전 등록 + 단일 연결 다중 파일 + 동시 세션 +
daemon/REST/gRPC/C-DLL 통합.

> **통합 담당자는 [API.md](API.md)를 읽어 주세요** — 표준화된 인터페이스 문서
> (gRPC/REST/CLI/C ABI 전체 필드 표, 오류 코드, 이벤트 모델, 대표적인 통합 흐름).

## 현재 상태 (P5 완료)

| 기능 | 상태 |
|---|---|
| 단일/다중 파일 send/recv (QUIC, N 스트림 병렬, 단일 연결 다중 파일) | ✅ |
| 청크별 BLAKE3 검증 + 단일 레벨 Merkle 루트 (비활성화 불가) | ✅ |
| 이어받기 (주기적 체크포인트, 크래시 복구 가능, per-file) | ✅ |
| TCP 폴백 (QUIC 접근 불가 시 자동 강등 / `--transport`로 강제) | ✅ |
| 인증서 고정 (TOFU: 지문 검증) | ✅ |
| 종료 코드 계약 + `--json` NDJSON 이벤트 | ✅ |
| daemon + REST API + SSE 이벤트 스트림 | ✅ |
| **inbox 사전 등록** (per-task 수신 디렉터리, 파일/디렉터리 두 가지 바인딩) | ✅ |
| **수신 측 동시 세션** (`--max-sessions`, QUIC 동시 / TCP 상호 배제) | ✅ |
| **gRPC (tonic)**: Capabilities/ReserveInbox/PurgeInbox/Submit/Observe/Status/Cancel | ✅ |
| **오케스트레이션 server** (Python, `orch/`): gRPC로 양단 제어 + 다중 작업 병렬 + 진행률 표시 + 최소 웹 UI | ✅ [plan/fts-server-demo.md](plan/fts-server-demo.md) 참고 |
| C ABI DLL (Python ctypes로 검증 완료) | ✅ |
| Tailscale 링크 탐지 (관측) | ✅ 관측 전용 |
| FEC / BBR / Nack 재전송 / 다중 호스트 relay | ❌ plan/fts-design.md 9절 참고 |

## 빌드

```
cargo build --release
# 산출물: target\release\fts.exe (CLI/daemon), target\release\fts.dll (C ABI)
```

## 원클릭 시작 (설정 파일)

`config.json` (저장소에 기본값이 포함되어 있으니 그대로 수정):

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
.\build.ps1                  # 빌드 + dist\ 에 모든 런타임 산출물 수집(exe/dll/설정/스크립트/문서)
# dist\ 폴더 전체를 대상 머신에 복사하기만 하면 됩니다(스크립트 불필요, PowerShell 실행 정책 제약 없음):
fts start                    # 백그라운드 시작(config.json 자동 로드, 헬스 체크 통과 후에만 반환)
fts status                   # running (pid=..., healthy)
fts stop                     # 중지
fts daemon                   # 포그라운드 실행(디버깅용)
fts daemon -c config.json --rest 127.0.0.1:6000   # CLI 인자가 설정 파일을 덮어씀
```

스크립트가 편한 경우: `fts-daemon.cmd`(cmd 래퍼, `-ExecutionPolicy Bypass` 내장이라 실행 정책
제약을 받지 않음) 또는 `fts-daemon.ps1`(`Set-ExecutionPolicy` 또는 -Bypass 필요).

우선순위: **CLI 명시 인자 > 설정 파일 > 내장 기본값**. 수신 디렉터리는 UNC/SMB 네트워크
경로를 지원하며(자격증명 요건은 API.md §11.1), daemon 시작과 inbox 등록 시 쓰기 가능 여부를
자동으로 사전 점검합니다.

## 빠른 시작

```powershell
# 1. 수신 측 (인증서 지문 출력)
.\target\release\fts.exe recv --listen 0.0.0.0:4433 --out .\downloads

# 2. 송신 측 (TOFU: 최초 1회 지문을 적어 둠)
.\target\release\fts.exe send .\bigfile.bin --to <상대IP>:4433 --fingerprint <지문> --streams 4

# 폴더 전체 (재귀: 하위 디렉터리를 모두 함께 전송, 수신 측에서 원래 구조로 재구성)
.\target\release\fts.exe send .\myfolder --to <상대IP>:4433 --fingerprint <지문>

# UDP가 차단된 환경: 자동으로 TCP 폴백(또는 --transport tcp로 강제)
.\target\release\fts.exe send .\bigfile.bin --to <상대IP>:4433 --fingerprint <지문> --transport tcp

# 스크립트 통합: NDJSON 이벤트 + 종료 코드
.\target\release\fts.exe send .\bigfile.bin --to <IP>:4433 --fingerprint <지문> --json
if ($LASTEXITCODE -ne 0) { throw "전송 실패: $LASTEXITCODE" }  # 4 = 검증 실패, 데이터를 신뢰할 수 없음
```

### CLI 한눈에 보기

```
fts send <PATH>... --to <ADDR> [--fingerprint <HEX> | --insecure] [--streams N]
              [--chunk-size B] [--transport auto|quic|tcp] [--ticket <T>] [--json]
              # 다중 경로/디렉터리 (디렉터리는 재귀 확장, 하위 구조는 수신 측에서 그대로 재구성;
              # 상대 경로 중복 → 종료 코드 2; 빈 디렉터리는 재생성하지 않음; 디렉터리 심볼릭 링크는 재귀하지 않음)
fts recv --listen <ADDR> [--out DIR] [--transport auto|quic|tcp] [--cert-cache DIR] [--json]
fts daemon [--rest 127.0.0.1:5050] [--listen 0.0.0.0:4433] [--out DIR]
           [--cert-cache DIR] [--max-sessions 3] [--grpc 127.0.0.1:50051]
fts start|stop|status [-c CONFIG]     # 백그라운드 daemon 라이프사이클(pid 파일 + REST 헬스 체크)
fts push-update --to <ADDR> --dist <DIR> [--overwrite-config] [--force]
                                      # 새 dist를 원격으로 푸시, 대상 daemon이 스스로 교체·재시작(W9)
```

종료 코드: 0 성공 / 1 일반 / 2 인자 / 3 연결·버전 / **4 검증 실패(데이터 신뢰 불가)** /
5 중단(이어받기 가능) / 6 취소 / 7 인증.

## daemon + REST + gRPC (주요 통합 경로)

```powershell
.\fts-daemon.ps1 start          # 또는 수동으로 fts daemon ... (위 인자 참고)
```

대표적인 통합 흐름(per-client 디렉터리 + 배치 다중 파일):

```
1. POST /v1/inbox {out_dir: "D:\\fromA"}            → {token}     (디렉터리 모드, TTL 10분 내 재사용 가능)
2. POST /v1/transfers {paths: [...파일 12개], dst_addr, ticket: token} → {task_id}
3. GET  /v1/transfers/{id}/events                    → SSE 이벤트 스트림(file/progress/file_done/result)
4. (선택) POST /v1/transfers/{id}/cancel
```

gRPC 대응 엔드포인트(proto/fts.proto): `Capabilities / ReserveInbox / PurgeInbox /
Submit / Observe(stream) / Status / Cancel`, 기본 `127.0.0.1:50051`.
Python 종단 간 예제: `python tests\grpc_smoke.py <지문>`.

`Capabilities`는 자기 서술형입니다(이번 버전 신규): `fingerprint`(인증서 BLAKE3 hex)와
`listen_addr`(데이터 수신 주소)를 반환하므로, **오케스트레이터는 gRPC 주소만으로 전 과정을
완전 자동화**할 수 있습니다 — 지문을 사람이 옮겨 적을 필요가 없습니다.

### REST 엔드포인트

```
GET  /v1/capabilities
POST /v1/inbox {out_dir, file_name?}     → {token, expires_in}   # file_name 비어 있으면 디렉터리 모드
DELETE /v1/inbox/{token}
POST /v1/transfers {paths|src_path, dst_addr, fingerprint, ticket?, ...}
GET  /v1/transfers   |  GET /v1/transfers/{id}
POST /v1/transfers/{id}/cancel
GET  /v1/transfers/{id}/events           → SSE
```

### C ABI (Python 예제, tests/ffi_smoke.py 참고)

```python
import ctypes
lib = ctypes.CDLL("fts.dll")
lib.fts_send_file.argtypes = [ctypes.c_char_p]*2 + [ctypes.c_char_p, ctypes.c_int32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_char_p]
rc = lib.fts_send_file(b"C:\\data\\big.bin", b"100.64.0.5:4433", b"<64hex 지문>", 0, 4, 0, b"auto")
if rc: print(lib.fts_last_error().decode())   # rc: 3 연결 / 4 검증 / 7 인증 …
```

## 오케스트레이션 server (다중 호스트 오케스트레이션 + 최소 웹 UI)

`orch/`는 독립 실행형 Python 오케스트레이션 서비스입니다. 양단의 호스트와 경로를 입력하면
**gRPC**로 양단을 각각 지휘해 전송을 완료합니다(소스 측 push, server는 데이터를 옮기지 않음).
다중 작업 병렬, 진행률 표시, 오류 보고, 브라우저 UI를 지원합니다. 자세한 사례는
[plan/fts-server-demo.md](plan/fts-server-demo.md), 사용법은
[orch/README.md](orch/README.md)를 참고하세요.

```powershell
python -m pip install -r orch\requirements.txt
python orch\gen_proto.py                                        # gRPC stub 생성
python orch\cli.py --config orch\config.json --check            # 양단 활성 확인
python orch\cli.py --config orch\config.json --pairs "A1:B1,A2:B2,A3:B3" `
    --src-path C:\data\payload.bin --dst-path D:\recv           # 병렬 오케스트레이션
python orch\cli.py --config orch\config.json --serve            # 웹 UI: http://127.0.0.1:8080
powershell -ExecutionPolicy Bypass -File orch\run_local_demo.ps1  # 단일 머신 6-daemon 시뮬레이션, 한 번에 재현
```

호스트 간 오케스트레이션 시 daemon은 `--grpc 0.0.0.0:50051`로 열고 방화벽을 허용해야 합니다.
server는 각 머신의 gRPC 주소만 입력하면 됩니다.

## 원격 업데이터 (IP 입력, 원클릭 버전 교체)

수십 대 머신의 버전 업그레이드가 더 이상 수동 "프로세스 종료 → 파일 복사 → 재시작"이
아닙니다: daemon은 W9 원격 자가 업데이트를 지원합니다(새 빌드 파일을 fts로 대상 머신의
스테이징 디렉터리로 푸시 → 대상 daemon이 자동으로 백업/덮어쓰기/재시작/실패 시 롤백).

```powershell
# 명령줄
target\release\fts.exe push-update --to 192.168.1.60 --dist dist\

# GUI (Tauri 2 + Svelte 5, 개발 머신에서 빌드, IP를 입력해 일괄 업데이트)
.\build.ps1 -Updater
updater\src-tauri\target\release\fts-updater.exe
```

최초 부트스트랩: 대상 머신에 W9가 포함된 dist가 한 번은 배포되어 있어야 합니다(구버전에는
BeginUpdate RPC가 없음). 이후에는 전 과정 원격으로 가능합니다. 기본적으로 대상 머신의
`config.json`은 덮어쓰지 않으며, 업데이트 로그는 대상 머신의 `.fts\update\apply.log`에
남습니다. 설계와 시행착오는
[plan/fts-updater-design.md](plan/fts-updater-design.md)를 참고하세요.

## 와이어 프로토콜 (fts-protocol v1)

```
제어 스트림(양방향): Hello ↔ Hello → Manifest(청크 해시 테이블 + Merkle 루트) → ManifestAck(재개 비트맵 포함 가능)
              → [데이터 스트림 N개 병렬, 청크 프레임 = id:u32|offset:u64|len:u32|payload]
              → Finish → FinishAck → (수신 측이 Ack를 읽어 간 뒤 송신 측이 연결 종료)
```

계약 세부는 [plan/fts-api-spec.md](plan/fts-api-spec.md)(v1.0 동결); 현재 구현은 그 P0–P3
부분집합이며 차이 목록은 [plan/dev-log.md](plan/dev-log.md)에 있습니다.

## 보안 모델

- 전송: QUIC = TLS 1.3(패킷별 암호화 + 무결성) + 청크별 BLAKE3(종단 간).
- 신원: 자체 서명 인증서 + 지문 고정(TOFU). `--insecure`는 테스트 환경에서만 사용해야 합니다.
- REST는 기본적으로 localhost만 수신하며, 제어 평면(REST/gRPC)에는 **원격 인증이 구현되어
  있지 않습니다**. 호스트 간 오케스트레이션 시 gRPC를 `0.0.0.0`에 바인딩하고
  방화벽/ACL로 접근을 제한해야 합니다 — **신뢰할 수 있는 네트워크(LAN/Tailscale) 전용**.
- `Capabilities`는 인증서 지문을 반환합니다(자기 서술에 필요). 이는 전송 보안 모델에 영향을
  주지 않습니다(데이터 평면은 여전히 청크별 BLAKE3 + 지문 pin).

## 알려진 제한 (정직한 목록)

- 루프백 벤치마크 ≠ 실제 네트워크: 1 GB 루프백 QUIC ~340 MB/s, TCP ~1900 MB/s(루프백에는
  RTT/패킷 손실이 없음); **두 물리 머신 / 국가 간 실측은 아직 필요**.
- 청크 하나라도 손상되면 전체가 실패합니다(Nack 수준 재전송 없음); FEC/BBR은 미구현
  (설계는 plan/fts-design.md 9절).
- daemon의 REST/gRPC에는 인증이 없어, 취소 인터페이스는 로컬 프로세스 누구나 호출할 수 있습니다.
- Tailscale 탐지는 관측 전용이며(`path` 이벤트 발행) 강등 결정에 연결되어 있지 않습니다.
- TCP 폴백 세션은 전역 상호 배제입니다(데이터 스트림이 새 세션과 listener를 공유해 구분할 수
  없음); QUIC 세션은 동시 실행 가능(기본 3).
- 다중 파일에서 파일 하나라도 실패하면 전체 작업이 중단됩니다(--keep-going 없음).

## 디렉터리

```
src\          main(CLI) lib(엔트리) send recv protocol tls ui error probe daemon grpc inbox netcred ffi update
include\      fts.h(C 헤더)
proto\        fts.proto(gRPC 계약)
orch\         오케스트레이션 server(Python): gRPC로 양단 제어 + 웹 UI + 단일 머신 데모 스크립트
updater\      원격 업데이터 GUI(Tauri 2 + Svelte 5): IP 입력으로 새 dist 푸시 후 자가 교체·재시작
tests\        ffi_smoke.py(ctypes), grpc_smoke.py(gRPC 종단 간), update_e2e.py(원격 업데이트 종단 간)
plan\         설계 문서, API 계약, 개발 로그, 오케스트레이션 server 사례(AGENTS.md 규율)
```

개발 과정(문제 → 근본 원인 → 해결)은 모두
[plan/dev-log.md](plan/dev-log.md)에 기록되어 있습니다.
