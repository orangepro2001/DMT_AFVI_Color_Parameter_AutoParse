# DMT AFVI Color Parameter AutoParse

[English](README.md) | [简体中文](README_CN.md) | [한국어](README_KR.md)

AFVI 색상 검사 장비용 오프라인 툴체인입니다. 장비의 3대 호스트 PC(**FM1 / FM2 / BM**)에서
검사 스펙 XML을 수집하고, 실기(AFVI Inspect) 소프트웨어와 동일한 레이아웃의 UI에서
열람·편집하며, 검사기술파라미터 시트를 Excel로 내보내고, Vision PC 간에 모델을 복사합니다 —
같은 사이트 내는 물론 사이트 간에도 가능합니다.

모든 동작은 Windows 로컬에서 이루어집니다. 클라우드 데이터베이스 백엔드를 명시적으로
켜지 않는 한 스펙 파일은 장비 네트워크 밖으로 나가지 않습니다.

## 저장소 지도

| 경로 | 내용 |
|---|---|
| `tauri-app/` | **AFVI_Parse** — 데스크톱 앱(Tauri 2 + Svelte 5 + Rust). 현재의 주력 제품. |
| `dmt-agent/` | 사이트별 LAN 에이전트 데몬 — 모델 스캔/복사 가속(단일 exe, 부팅 예약 작업으로 상주). |
| `dmt-copy-core/` | 공유 Rust 크레이트: 모델 복사 도메인 로직(계획 / 스캔 / 자격증명 / 프로토콜 / 릴레이). 앱과 에이전트가 동일 구현을 공유. |
| `index.html`, `src/`, `SpecParamTool.html` | 구버전 단일 파일 웹 도구 — 프로젝트의 출발점, 현재도 동작. |
| `reference/` | 샘플 `PxInventory` 트리(FM1 / FM2 / BM)와 `Parameter_Template.xlsx`. |
| `Plan/`, `tools/` | 설계 노트; 독립 실행형 Python 광원 분석 보조 스크립트. |

---

# 데스크톱 앱: AFVI_Parse

`tauri-app/` — 실제 장비 공유와 직접 통신하는 Tauri 2 데스크톱 앱입니다. 각 Vision PC의
`PxInventory` 디렉터리 아래 스펙 파일(`LightSpec.xml`, `InspectionSpec.xml`,
`SpecParameter.xml`, `SpecTreeNode.xml`)을 읽어 로컬 모델 스냅샷으로 파싱하고, **AFVI
Inspect 실기 소프트웨어** 레이아웃을 그대로 재현해 작업자가 두 소프트웨어를 번갈아
사용해도 어색하지 않게 합니다.

기술 스택: 프런트엔드 **Svelte 5 runes**(라우터 라이브러리 없음, 탭 패널은 상시
마운트) + **TypeScript** + **Vite**; 백엔드 **Rust**(tokio, mongodb, reqwest, image);
웹뷰 안에서는 `fast-xml-parser`로 XML을 파싱하고, 복사 로직은 Rust에서 공유합니다.
툴체인 고정(Node 24, Rust 1.91 — `build_app.bat`가 검증).

## 메인 윈도우

상단 내비게이션: `HOME` / `TEACH` / `REVIEW` / `CALIBRATE` / `COPIER` / `SETTINGS`.
`HOME`과 `REVIEW`는 플레이스홀더이고 나머지 넷이 실제 기능입니다. 창 중앙은 **중앙
스테이지**: 모델 정보, 실시간 MEDIAN 스트립 이미지, 상태 바, 로그 패널. 오른쪽 패널에
현재 탭이 표시됩니다. 탭을 전환해도 페이지는 **언마운트되지 않습니다**(진행 중인 복사
큐와 TEACH 선택 상태가 유지됨).

### 중앙 스테이지 — MEDIAN 스트립 이미지

* 장비 + 모델을 선택하면 공유에서 실시간 MEDIAN 스트립 이미지를 바로 불러옵니다 — 수집
  선행 불필요: **TOP = FM1**(버전 폴더 `2.0`), **BTM = BM**(버전 `3.5`), FM2는 제외.
* 버전 폴더 폴백: 계획한 버전 폴더가 없으면 같은 상대 경로를 포함한 형제 버전을 사용.
  모델/파일 부재는 *missing*으로 표시(탐색한 경로를 함께 표시)하고, 공유 루트 자체가
  접근 불가일 때만 오류로 처리.
* 기가픽셀급 TIFF는 worker pool에서 디코딩(양쪽이 동시에 거대 비트맵을 갖지 않도록
  뮤텍스 직렬화), 긴 변을 4096 px로 축소해 JPEG로 반환.
* 확대 1×–10×: 휠 줌(앵커 인식), Ctrl+클릭 확대/축소, 확대 상태에서 드래그 팬, 더블
  클릭 리셋; TOP/BTM 전환; 측당 LRU 캐시 6개.

### TEACH — 파라미터 트리(실기 재현)

* 호스트 선택(FM1/TOP-1, FM2/TOP-2, BM/BOTTOM) + 장비/모델 표시; 툴바
  **Load XML / Save Local / Reload**.
* `Unit` / `Dummy` 그룹 탭 + `Light-1 / 2 / 3` 탭, Global Align / SR Align 정보 블록,
  Overlay 체크박스(MK / A_C / I_C / SK).
* **컬러 노드 트리**: 노드 이름과 색상은 `SpecTreeNode.xml`에서, 체크 상태는
  `NodeCheck`에서 가져옵니다; Align / ROI 하위 트리에는 체크박스가 없습니다(실기와
  동일); 선택된 노드는 주홍색으로 표시.
* 세 개의 파라미터 테이블: **Master**(`ControlType=1`은 글자 없는 파란 토글로 렌더링),
  **Submaster**(게이팅 Master 키 — Chain Align / Chain Inspection — 이 켜져 있을 때만
  표시), **검사 테이블**(Red/Green/Blue 탭으로 `ValR/ValG/ValB` 전환, Min 열 포함).
  파라미터명은 `SpecParameter.xml` 사전으로 해석합니다(다국어 팩 병합, 영어 우선).
  숫자 입력은 검증됩니다(잘못된 값은 빨간 표시, 포커스 이탈 시 복원).
* `Load XML`은 `InspectionSpec.xml` 한 파일을 현재 Host/Light 페이지에 넣거나,
  `LightSpec.xml`을 불러 호스트 전체를 새로 고칠 수 있습니다. **편집은 로컬 스냅샷에만
  반영됩니다**(Save Local로 저장, Reload는 더티 상태 확인 후 재판독) — 장비의 운영
  XML은 절대 기록하지 않습니다.
* 구버전 평면 형식 스냅샷(schemaVersion 1)은 자동 감지되어 재수집을 안내합니다.

### CALIBRATE — 광원 캘리브레이션

* 20채널 광원 테이블(Value / Angle / Color / ON-OFF), 선택한 `LightSpec.xml` 페이지에서
  가져오며 Page 1/2/3 전환과 전체 ON/OFF 제공.
* **GV 밝기 입력**: GV 밝기 목표는 사람이 측정해 입력하는 값으로 어떤 XML에도 없습니다.
  Page 1/2에서는 `AU`·`OSP` 두 행, Page 3에서는 `SR`·`Space` 두 행을 보여주며 각 행마다
  RED / GREEN / BLUE 입력칸이 있습니다. 값은 자유 텍스트(`180`, `60 : 50~70`, `X` 등)
  이며 호스트 + Page 단위로 키가 잡히고 500 ms 디바운스로 자동 저장(실패 시 빨간 글자
  알림).

### COPIER — Vision PC 간 모델 복사

* 단일 페어 복사(소스/타깃 각각 장비 + Vision PC 선택)와 **원클릭 전체 장비 복사**
  (FM1→FM1, FM2→FM2, BM→BM을 하나의 작업으로; 서로 다른 장비 필요).
* **FM↔BM 격리**: FM1/FM2와 BM은 어떤 방향으로도 모델을 교환하지 않습니다; 충돌 시
  반대쪽을 자동으로 뒤집고 안내합니다.
* 선택한 소스 PC의 모델 스캔 → 검색 가능한 선택기; 선택적 **Rename to**(복제/이름 변경 —
  폴더명이 모델의 유일한 식별자; 에이전트 프로토콜 ≥ v2 필요); 사이트 간 **Force full
  transfer** 토글.
* **Preview Copy**가 계획 테이블을 만들고(LIGHT_SPEC / INSPECT_SPEC / PxRepository 항목,
  소스→타깃 경로, 기존 폴더는 "교체 예정" 표시), 이어서 위험 확인 대화상자에서 **모델명을
  직접 입력**해야 파일 삭제/복사가 진행됩니다.
* 순차 작업 큐(한 번에 하나의 작업, 대기/제거/정리), 작업별 진행률(파일 수, 바이트, 현재
  파일, 릴레이 모드 라벨); 사이트 간 작업은 실패 시 증분으로 한 번 자동 재시도하고, 그래도
  실패하면 직접 SMB(저속 경로)로 폴백합니다.

### SETTINGS — 장비, 수집, 데이터베이스, 내보내기

* **Machine Configuration**: Main PC IP로 장비를 등록하면 3대 Vision PC의
  `PxInventory`/`PxRepository` UNC 경로가 자동 파생됩니다(플랫 네트워크 규칙: FM1 = IP+1,
  FM2 = +2, BM = +3; 직접 수정한 필드는 유지). 선택적 **네트워크 자격증명**(사용자
  이름/비밀번호) — 스캔/수집 전에 Rust 측이 서버마다 `net use …\IPC$`로 로그인합니다(빈
  비밀번호 계정 지원; 오류 1219는 기존 연결 삭제 후 재시도). 선택적 **사이트 LAN
  에이전트**(주소는 `<main_ip>:3777`로 자동 제안 + token), 장비별 **Test agent** 버튼.
  `machines.json`에 저장.
* **Data Collection**: 장비 + 모델 선택(모델 선택기는 3대 호스트를 모두 스캔, 필터
  지원) 후 **Collect & Save**. 호스트별 수집 항목: `LIGHT_SPEC/<model>/LightSpec.xml`,
  `INSPECT_SPEC/<model>/{TOP|BOTTOM}/LIGHT0..2/InspectionSpec.xml`, 그리고 선택적
  `SpecParameter.xml` / `SpecTreeNode.xml`; 3대 호스트가 병렬로 수집되며 세 대 모두
  성공해야 합니다. 스냅샷이 이미 있으면 즉시 로드해 TEACH/CALIBRATE에 적용하고 버튼은
  *Re-collect (optional)*로 격하되며 *Open TEACH* 바로가기가 나타납니다. 모델 선택은
  중앙 스테이지의 이미지 대상으로도 전달됩니다.
* **Database**: 백엔드를 `local`(JSON 파일, 기본값), `mongodb`(Atlas 호환),
  `firestore`(Firebase) 사이에서 전환 — 연결 정보를 그 자리에서 편집,
  **Test Connection**, **Migrate Local Data → …**(멱등 upsert + 마이그레이션 리포트),
  **Save & Apply**. 설정은 app-data의 `storage.json`에 저장. 원격 백엔드 읽기가 실패하면
  자동으로 로컬 JSON 백업으로 폴백하므로 네트워크 흔들림에도 화면이 하얘지지 않습니다.
  Firestore의 1 MiB 초과 문서는 자동 샤딩(700 KB 청크, 읽을 때 투명 재조립). 모든 저장소
  명령은 async + `spawn_blocking` — 느린 데이터베이스 때문에 UI가 멈추는 일이 없습니다.
* **Export Parameter Excel(검사기술파라미터)**: 내보내기 경로와 템플릿 워크북 경로를 한
  번만 설정(`ui/export-config.json`에 저장; 미설정 시 명확한 안내와 함께 내보내기 거부).

## 데이터 모델 및 로컬 파일

수집이 끝난 모델은 **스냅샷**(`StoredModelRecord`, schemaVersion 2)이 됩니다:
`machine / modelName / collectedAt`와 `hosts {FM1, FM2, BM}` 맵, 호스트마다 루트 경로,
side, 파싱된 `lightSpec`, 정렬 정보, `ParamKey → 이름` 파라미터 사전, GP/P/C 노드 트리
사전, 그리고 MASTER / SUBMASTER / INSPECTION 리프(`Val/ValR/ValG/ValB/Min`)를 갖는 완전한
`GPNODE → PNODE → CNODE` 검사 트리.

로컬 데이터베이스 레이아웃(Tauri app-data 디렉터리; local 백엔드는 이 폴더 자체):

```
storage.json                       저장소 백엔드 설정
machines.json                      장비 목록(선택적 자격증명 + 에이전트 설정 포함)
models/<machineId>/<model>.json    모델 스냅샷(schemaVersion 2)
ui/active-selection.json           현재 선택된 장비/모델
ui/teach-selection.json            TEACH 페이지 선택 경로
ui/gv/<machineId>/<model>.json     수동 측정한 GV 값
ui/export-config.json              Excel 내보내기 경로 / 템플릿 경로
```

양쪽이 각자 **단 하나의 저장소 이음선**에서 만납니다 — `DocumentStoreClient`(TS,
`src/lib/document-store.ts`)와 `DocumentStore` 트레이트(Rust, `storage.rs`) — 새 백엔드를
추가해도 기능 코드와 UI는 건드리지 않습니다.

## Excel 내보내기(검사기술파라미터)

`export_parameter_excel`은 템플릿 워크시트 XML 안의 **값 셀만** 다시 씁니다 — 스타일,
병합 셀, 인쇄 설정, 나머지 시트는 바이트 단위로 그대로 유지됩니다. 산출 파일은 업로드
서버가 자동 파싱하기 때문입니다. 출력: `<장비명>_<모델>.xlsx`(예: `AFVI14_6ST2001Q01.xlsx`).

채움 규칙(장비 지식, 구버전 도구의 `LIGHT_AREA_RULES`와 동일):

* 워크북 명명(2026-09부터 FM1/FM2 분리 관리): `Top1-Light2/3`(FM1), `Top2-Light2/3`(FM2),
  `Bottom-Light2/3`(BM), `DMG 조명 1번`; 구한글 명명(`Top 조명 2번` 등)도 호환(FM1 우선).
* **GV 페이지 정렬**: 각 조명 시트는 자기 광원 페이지의 GV를 읽습니다(light N → Calibrate
  N 페이지). 이전에 Light2가 1페이지를 잘못 읽던 결함을 수정한 것입니다.
* `DMG 조명 1번`(LIGHT0): INSPECTION 파라미터 없음 — GV만(Top-RED / Bottom-RED) 기입하고,
  LightSpec 채널에서 계산한 **백색광 축 비율**을 채웁니다(활성 채널을 각도별로 그룹화,
  같은 각도는 피크값, GCD로 약분 — 예: `White 0 : 30 = 3 : 1`).
* `Light2`(LIGHT1): AU(PNODE 2)와 OSP(PNODE 3) 영역 블록만 채우고 Laser Marking 블록은
  규칙대로 비웁니다. `Light3`(LIGHT2): NonMetal(PNODE 5) 블록만 채웁니다.
* `조명 축` 행은 축 비율로 자동 채움; B/D/F 열에는 같은 색 광원을 넣고(해당 색이 없으면
  B열은 White로 폴백); 비활성 채널은 제외.
* **노드 트리 보완**: 데이터에는 있는데 템플릿에 없는 영역 블록은 시트 끝에 추가합니다
  (시트 첫 블록의 스타일 복제, 값은 ParamKey 매칭); 패밀리를 넘는 파라미터는 끝 행으로
  추가.
* 라벨 매칭은 별칭 테이블 + 사전의 양방향 해석으로 템플릿의 철자 변형(Offest/Offset,
  (Size)/(Pixel) 등)을 허용합니다.
* 내보내기는 리포트를 반환합니다: filled / blanked / GV / axis 셀 수, 추가된 블록, 미해석
  라벨. GV/경로 저장 실패는 조용히 무시되지 않고 명시적으로 알립니다(Firestore 쓰기가
  실패하면 데이터는 로컬 파일에 남고 다음 마이그레이션 때 밀어넣어짐 — 입력이
  유실되지 않음).

## 사이트 LAN 에이전트(모델 복사/스캔 가속)

데스크톱이 사이트 LAN 밖에 있고 Tailscale 서브넷 라우팅으로만 접근 가능하면 SMB의 높은
왕복 지연 때문에 모델 복사와 스캔이 매우 느려집니다. 사이트마다 **`dmt-agent`**를 하나씩
배치하세요(사이트 Main PC): 데스크톱은 제어 요청을 Tailscale로 에이전트에 보내고,
에이전트가 실제 사이트 LAN 안에서 기가비트 속도로 스캔과 장비 간 직접 복사를
실행합니다 — **데이터는 사이트 밖으로 나가지 않습니다** — 파일별 진행률이 Model Copier
진행 바로 실시간 스트리밍됩니다.

* 도메인 로직(복사 계획, 삭제 가드, 스캔, `net use` 자격증명, 와이어 프로토콜)은 공유
  크레이트 `dmt-copy-core`에 있습니다; 에이전트와 데스크톱의 직접 SMB 폴백 경로가 같은
  구현을 씁니다.
* 와이어 프로토콜: TCP + NDJSON, 포트 **3777**, 첫 프레임은 공유 token으로 인증해야
  합니다(상수 시간 비교). 프로토콜 **v3** — v2는 이름 변경 복사, v3는 사이트 간 릴레이를
  추가; 데스크톱은 오래된 에이전트에 새 기능을 보내는 것을 거부합니다.
* 연산: `ping`(Test agent 버튼), `scan_models`, `copy`(같은 사이트), `copy_cross_site`
  (소스 사이트 에이전트가 타깃 사이트 에이전트로 푸시), `tcp_relay_push`(UDP가 막혔을 때의
  TCP 데이터 평면).
* **채널 자동 선택**: 두 장비가 **같은** 에이전트 주소 → 같은 사이트 에이전트; 주소가
  **다르면** → 사이트 간 QUIC 릴레이(증분으로 한 번 자동 재시도, 그 후 직접 SMB 폴백);
  한쪽이라도 미설정이면 → 직접 SMB, 이전과 완전히 동일하게 동작.
* 사이트 간 전송: QUIC(quinn/rustls, UDP 3777, 연결당 6 스트림, 파일별 zstd, size+mtime
  기준 증분 건너뛰기, 스테이징 디렉터리 2시간 청소) → TCP 데이터 평면 → 데스크톱 직접
  SMB. same-address 가드가 두 사이트의 LAN 계획 충돌을 감지하고 Tailscale IP 사용을
  안내합니다.
* 설치: `build_app.bat agent <token>`이 `dmt-agent.exe`, `agent.json`,
  `install_service.bat` / `uninstall_service.bat`를 생성합니다(`schtasks`로 부팅 시 SYSTEM
  예약 작업 등록). SYSTEM 세션에는 사용자 자격증명이 없으므로 장비 설정에 네트워크
  사용자 이름/비밀번호를 **반드시** 입력해야 에이전트가 `net use`로 공유에 로그인할 수
  있습니다. 로그는 exe 옆 `agent.log`(5 MB 로테이션). 자세한 내용은
  `dmt-agent/README.md`.

## 빌드 및 테스트

```bash
cd tauri-app
npm install
npm run dev             # vite 개발 서버(포트 1420, tauri.conf.json devUrl과 일치)
npm run check           # svelte-check 타입 검사
npm run tauri dev       # 데스크톱 앱 개발 모드
cargo test              # src-tauri/ 안에서: 저장소 / 내보내기 / MEDIAN 단위 테스트
```

저장소 루트에서:

```bash
build_app.bat           # 원스톱 패키징(npm ci + tauri build → exe + MSI + NSIS)
build_app.bat agent <token>   # dmt-agent + agent.json + 설치 스크립트 빌드
build_app.bat check     # 프런트엔드 빌드 + 3개 크레이트의 cargo check
```

* `cargo test`는 완전히 오프라인으로 실행됩니다: MEDIAN 경로 해석(8개), Firestore 샤딩을
  포함한 저장소 백엔드(5개), Excel 내보내기 규칙(3개), 그리고 copy-core / agent 전체
  스위트(계획/이름변경/삭제 가드, 프로토콜, 릴레이 증분, 자격증명 오류 코드, 에이전트
  엔드투엔드). 실제 템플릿 / 실제 Atlas / Firestore 통합 테스트는 입력 또는 환경 변수
  게이트 뒤에 있습니다(`export_real`, `MIGRATE_REAL=1`, `FIRESTORE_E2E=1`).
* 프런트엔드에는 자동화된 UI 테스트가 없습니다 — `npm run check`가 관문입니다; 구버전
  웹 도구의 회귀 테스트는 루트 `tests/`에 있습니다.

## 알려진 제한(데스크톱)

* `HOME`과 `REVIEW`는 플레이스홀더입니다.
* TEACH 편집(`NodeCheck`, 불러온 XML)과 GV 값은 로컬 스냅샷에만 존재합니다 — 운영 XML로는
  절대 쓰기 돌려보내지 않습니다(설계상 그렇습니다).
* Global Align / SR Align의 광원과 채널은 고정 규칙(전체 광원 + 마지막 광원, Red 채널)을
  따릅니다; `AlignSpec.xml`을 수집해야 하는지는 미정입니다.
* 네트워크 자격증명은 `machines.json`에 평문으로 저장됩니다(장비 로컬 파일); Atlas 연결
  문자열은 로컬 `storage.json`에만 존재합니다 — 둘 다 저장소에 커밋되지 않습니다.
  Firestore 프로젝트/API 키는 `storage.rs`의 컴파일 타임 상수이며, 접근 제어는 Firestore
  보안 규칙에 맡깁니다.
* 프런트엔드에는 아직 자동화된 컴포넌트 테스트가 없습니다.

---

# 구버전 웹 도구: SpecParamTool.html

프로젝트는 의존성 없는 단일 파일 브라우저 도구로 시작했습니다: `LightSpec.xml`과
`INSPECT_SPEC` 폴더의 `InspectionSpec.xml` 파일들(선택적으로 `SpecParameter.xml` /
`SpecTreeNode.xml`, `Parameter_Template.xlsx`)을 읽어 **검사기술 파라미터 시트**, 분석
목록, 두 개의 Excel 워크북을 만듭니다 — `SpecParamTool.html`을 열고 파일을 끌어다 놓고
*Parse Specs*를 누르면 됩니다. 지금도 동작하며 `python build.py`가 `src/01…08-*.js`에서
재생성합니다.

* 탭: Summary, 템플릿 레이아웃 파라미터 시트(`채널 / 조명 축 / GV 밝기 / 영역 / 검출
  불량 / 파라미터`), 광원별 채널 목록(LED 색상 그룹핑), InspectionSpec 전사 테이블,
  LightSpec 원본 + 그룹 목록, 다중 파일 Comparison(노드 × ParamKey × 채널별 `Same`/`Diff`),
  내장 사전(ParamKey 82개 + 노드 트리, XML을 끌어다 놓아 교체 가능).
* 내보내기: `<Model>_<SIDE>_LIGHT<n>_LightSpec.xlsx`(템플릿을 셀 단위로 채움),
  `..._InspectSpec.xlsx`(목록 + 비교), 선택적 참조 워크북, 탭별 CSV.
* **광원 → 파라미터 영역 규칙**(장비 지식, 데스크톱 익스포터로 이어짐): Light 1 =
  `LIGHT0` = AI 모델 검사 → 파라미터 없음; Light 2 = `LIGHT1` → 금속만(`PNODE 2` AU +
  `PNODE 3` OSP); Light 3 = `LIGHT2` → SR/비금속만(`PNODE 5` NonMetal).
* 채널 번호: `LightSpec`은 0 시작 `@Index`를 저장하지만 도구는 장비 UI 기준의 1 시작
  번호를 표시합니다(`CH1` = `@Index 0`).
* 테스트: `tests/run-model-tests.js`(파싱 → 뷰 → xlsx), `validate_export.py`(openpyxl
  재판독), `run-browser-tests.js`(헤드리스 Chrome).

심화 문서: [`TOOL_ARCHITECTURE.md`](TOOL_ARCHITECTURE.md) ·
[`SPEC_REFERENCE.md`](SPEC_REFERENCE.md) ·
[`PARAMETER_TEMPLATE_NOTES.md`](PARAMETER_TEMPLATE_NOTES.md) ·
[`tests/README.md`](tests/README.md).

---

## 문서 색인

| 파일 | 내용 |
|---|---|
| [`tauri-app/README.md`](tauri-app/README.md) | 데스크톱 앱 상세: UI, 데이터 모델, 저장소 백엔드, Excel 규칙(중국어) |
| [`dmt-agent/README.md`](dmt-agent/README.md) | 에이전트 배치, 프로토콜, 사이트 간 릴레이, 로그(중국어) |
| [`Plan/`](Plan/) | 설계 노트(DOE 샘플링, RSM 피팅, 광원 분석 UI, Svelte 5 마이그레이션) |
| [`TOOL_ARCHITECTURE.md`](TOOL_ARCHITECTURE.md) | 웹 도구 모듈 지도와 파이프라인 |
| [`SPEC_REFERENCE.md`](SPEC_REFERENCE.md) | 스펙 파일 용도, 전체 키-값 사전, XML 스키마 |
| [`PARAMETER_TEMPLATE_NOTES.md`](PARAMETER_TEMPLATE_NOTES.md) | `Parameter_Template.xlsx` 레이아웃과 미결 사항 |
| [`tests/README.md`](tests/README.md) | 웹 도구 회귀 테스트 안내 |
