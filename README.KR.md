# AFVI 컬러 검사기 교육 소프트웨어

Color AFVI Master Teach는 Tauri 2, Svelte 5, Rust 기반의 Windows 데스크톱 교육 소프트웨어입니다. FM1 / FM2(TOP)와 BM(BOTTOM)의 PxInventory에서 XML을 실시간으로 읽어 메모리에서 광원, 검사 노드, 파라미터를 파싱하며, 생산 장비 파일을 수정하지 않습니다.

## 기능

- **TEACH**: Unit / Dummy, Light, Align/ROI 노드와 Master / Submaster / Inspection 파라미터를 표시합니다. 중앙 스테이지에서 MEDIAN 또는 Pattern을 확인할 수 있으며, 확대, 이동, ROI, 계측, 그레이스케일 통계, Metal 오버레이, 정렬 교육을 지원합니다.
- **REVIEW**: 결함 목록과 미리보기 영역을 표시합니다. 현재 검사 결과가 연결되어 있지 않아 목록은 비어 있습니다.
- **CALIBRATE**: Light와 RGB 채널 전환, 교육 광원 조정, 밝기 미리보기, GV 실측값 입력 및 저장을 지원합니다. 광원 조정은 교육 표시에만 영향을 줍니다.
- **SETTINGS**: 모델 선택, 장비 공유 경로 설정, 이미지 및 정렬 설정, 교육 파라미터 편집. 모델 선택 시 XML을 실시간으로 읽으며, Reload는 소스 XML을 다시 읽습니다. 파라미터 값, NodeCheck, Load XML의 변경은 이번 세션에서만 유효하며, 세션 변경이 있을 때 Reload는 폐기 확인을 요청합니다.

좌측 Connector에서 현재 장비와 Vision(FM1 / FM2 / BM)을 선택하고, Model에서 모델 목록을 엽니다. 렌치 아이콘은 실장비 구성 교육 패널을 열며, 해당 구성은 로컬에서만 표시됩니다. 정렬 케이스 생성, 위상 상관, ECC, 기준점 검증, 단계 보기는 이미지 및 정렬 설정에 있으며 별도의 최상위 정렬 탭은 없습니다.

## 오프라인 reference

장비 네트워크에 접근할 수 없을 때 다음 로컬 데이터를 준비하면 파라미터를 읽을 수 있습니다.

```text
reference/
  FM1/PxInventory/
    LIGHT_SPEC/<model>/LightSpec.xml
    INSPECT_SPEC/<model>-00/TOP/LIGHT0/InspectionSpec.xml
    INSPECT_SPEC/<model>-00/TOP/LIGHT1/InspectionSpec.xml
    INSPECT_SPEC/<model>-00/TOP/LIGHT2/InspectionSpec.xml
    SpecParameter.xml
    SpecTreeNode.xml
  FM2/PxInventory/  （구조는 FM1과 동일）
  BM/PxInventory/   （검사면 디렉터리는 BOTTOM）
```

탐색 순서는 환경 변수 **AFVI_REFERENCE_DIR**, 실행 파일 옆의 **reference/**, 컴파일 시 프로젝트 루트의 **reference/** 입니다. 각 후보는 FM1/PxInventory를 포함해야 하며, 발견 시 읽기 전용 장비 **Reference (offline)** 가 장비 목록 맨 앞에 추가되고 machines.json에 기록되지 않습니다. 시작 시 현재 선택이 없거나 로드할 수 없으면 reference에서 스캔한 첫 번째 모델을 자동으로 선택합니다.

```powershell
$env:AFVI_REFERENCE_DIR = 'D:\AFVI\reference'
npm run tauri dev
```

세 Vision의 동일 모델 XML이 모두 읽을 수 있어야 합니다. 사전은 PxInventory 루트에서 읽습니다. reference에 PxRepository가 없을 수 있으며, 이 경우 이미지는 명확한 missing 안내 또는 회색 Pattern 대체를 표시하고 TEACH 파라미터에는 영향을 주지 않습니다. 실제 이미지 교육이 필요하면 해당 PxRepository의 MEDIAN, GB / L01 또는 AlignData TIFF를 별도로 준비할 수 있습니다.

**reference/** 와 **firebase.store.txt** 는 로컬에만 보관되며 Git에 포함되지 않습니다. 시작에 필수적인 원격 서비스 구성이 아닙니다.

## 로컬 파일과 이미지 캐시

구성은 여전히 Tauri의 app-data 루트 디렉터리에 있으며, Windows 기본 경로는 `%APPDATA%\com.afvi.parse`로 기존 로컬 JSON 경로와 동일합니다.

| 파일 | 용도 |
|---|---|
| machines.json | 사용자 장비 경로 및 선택적 UNC 자격 증명, reference 미포함 |
| ui/roi-boxes.json | 장비, 모델, 이미지 식별자별로 저장된 ROI |
| ui/gv/<machineId>/<model>.json | GV 실측값 |
| ui/teach-selection.json | TEACH Host / Light / 노드 / 색상 위치 |
| ui/active-selection.json | 현재 장비와 모델 |

JSON은 read_app_file / write_app_file로 읽고 쓰며, 쓰기 시 상위 디렉터리를 자동 생성하고 같은 디렉터리의 임시 파일을 사용한 뒤 rename합니다. 모델 XML은 로드할 때마다 PxInventory에서 직접 읽고, 파싱 후에는 세션 메모리에만 보관합니다. 탭 전환과 이미 로드한 모델로 돌아가기는 세션 변경을 유지하며, 프로그램 종료 시 사라집니다.

MEDIAN TIFF 로컬 사본, 미리보기 JPEG, composite, 정렬 case는 기존 app-cache 디렉터리를 계속 사용합니다. 이들은 이미지 캐시이며 경로와 정리 로직은 변경되지 않습니다. 테마, 현재 탭, Connector Vision, 렌치 패널 등 표시 환경설정은 WebView localStorage에 보관됩니다.

## 디렉터리 구조

| 경로 | 내용 |
|---|---|
| src/app/ | Svelte 상주 탭과 컴포넌트 |
| src/lib/ | IPC, XML 파싱, 전역 상태, 광원 시뮬레이션, ROI 도구 |
| src/styles.css | 전역 테마와 스타일 |
| src-tauri/src/lib.rs | XML, 이미지, GV, 정렬 명령 |
| src-tauri/src/machine.rs | 장비 경로, 스캔, UNC 자격 증명, reference 탐색 |
| src-tauri/src/app_files.rs | 소형 JSON 파일 읽기와 원자적 쓰기 |
| src-tauri/src/align/ | 합성 케이스, 위상 상관, ECC, 기준점, 레이어 합성 |
| src-tauri/examples/ | 이미지 및 정렬 진단 프로그램 |
| tests/light-simulation.test.mjs | 광원 시뮬레이션 테스트 |
| docs/ | 사양, 설계, TODO 단계 기록 |
| package.json, vite.config.ts | 루트 프런트엔드 구성 |

## 툴체인과 명령

vfox로 프로젝트 .vfox.toml에 따라 **Node 24.11.1 / Rust 1.91.1**을 사용하며, Windows에는 Tauri의 MSVC와 WebView2 개발 환경이 필요합니다. node_modules가 이미 있으면 의존성을 다시 설치할 필요가 없으며, 최초 환경 준비 시 npm ci를 실행할 수 있습니다. build_app.bat은 고정 버전을 확인합니다.

프로젝트 루트에서:

```powershell
npm run check
npm run build
npm run test:light
npm run tauri dev
npm run tauri build
.\build_app.bat check
.\build_app.bat dev
.\build_app.bat
```

Rust 오프라인 검사 및 테스트(새 패키지를 내려받지 않으며, 로컬에 의존성 캐시가 있어야 함):

```powershell
cd src-tauri
# 현재 환경에서 sccache를 사용할 수 없는 경우:
$env:RUSTC_WRAPPER = ''
cargo check --offline
cargo test --lib --offline
cargo run --offline --example aligndata_identity
```

진단 프로그램에는 사용 가능한 TIFF가 필요하며, 입력 요구 사항은 해당 소스를 참고하십시오. 릴리스 산출물은 src-tauri/target/release에 있고, 설치 패키지는 그 bundle 하위 디렉터리에 있습니다. 개발 단계, 검수 결과, 원본 데이터 제약은 [docs/TODO.md](docs/TODO.md)에 기록되어 있습니다.
