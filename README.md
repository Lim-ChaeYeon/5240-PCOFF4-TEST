# 5240 PcOff Agent (Electron)

MFC 레거시를 Electron + TypeScript로 전환하는 5240 PcOff Agent 프로젝트입니다.  
요건·설계: `PRD_5240_PcOff_Electron.md`, `TRD_5240_PcOff_Electron.md`, `PC_OFF_AGENT_API.md`.

---

## 요구사항

- Node.js 18+
- npm

```bash
npm install
npm run build
npm start
```

- **macOS**: 일부 환경에서 `ELECTRON_RUN_AS_NODE`가 설정되어 있으면 앱이 시작되지 않을 수 있습니다. 터미널에서 `unset ELECTRON_RUN_AS_NODE` 후 `npm start`를 실행하세요.

---

## Windows 설치 파일 빌드

NSIS 기반 Windows 설치 파일(.exe)을 만들 수 있습니다.

```bash
npm run build
npm run dist:win
```

- **출력 위치**: `release/` 폴더  
  - `5240 PcOff Agent Setup x.x.x.exe` — 설치 프로그램 (버전은 `package.json`의 `version`)  
  - `latest.yml` — 자동 업데이트용 메타데이터
- **아키텍처**:  
  - Mac에서 실행 시 **Windows ARM64**용이 생성됩니다 (Windows on ARM 기기용).  
  - 일반 PC(Intel/AMD 64비트)용이 필요하면 **Windows PC**에서 `npm run dist:win:x64`를 실행하거나, CI(예: GitHub Actions, AppVeyor)에서 `electron-builder --win --x64`로 빌드하세요.
- **설치 옵션**: 설치 경로 변경 불가, 바탕화면 바로가기 생성, 설치 후 실행(perMachine 설치).

---

## 사용자별 설치 파일 (배포 시)

태그 푸시 시 CI가 **Windows**와 **Mac** 설치 파일을 모두 빌드해 GitHub Release에 올립니다.

| 사용자 | 받을 파일 | 비고 |
|--------|-----------|------|
| **Windows** | `5240 PcOff Agent Setup x.x.x.exe` | 일반 PC(Intel/AMD 64비트). 더블클릭 후 설치. |
| **Mac** | `5240 PcOff Agent-x.x.x.dmg` (또는 `.zip`) | Apple Silicon·Intel 맥 모두. .dmg 열어서 앱을 Applications로 드래그. **서명·notarization 없으면** 첫 실행 시 Gatekeeper 경고가 나옵니다. → [맥 설치 파일 실행 안 될 때](docs/맥_설치_가이드.md) 참고. |

- 위 파일은 **Releases** 탭에서 해당 버전(태그)을 누르면 내려받을 수 있습니다.
- 설치 후 앱은 GitHub Release를 보고 **업데이트**합니다. (앱 시작 시 백그라운드 검사 + **「업데이트 확인」** 버튼, 다운로드 후 **앱 종료 시** 자동 적용. 자세한 흐름은 [docs/업데이트_가이드_사용자.md](docs/업데이트_가이드_사용자.md) 참고.)
- **Mac**: 현재 CI 빌드는 **Apple 코드 서명·notarization을 하지 않습니다.** 테스트/내부용으로는 아래 가이드대로 "열기" 허용 후 사용하고, 정식 배포 시에는 Apple Developer 계정으로 서명·notarization을 설정해야 합니다.

---

## CI · 릴리스 자동화

**태그를 푸시하면** GitHub Actions가 Windows x64·Mac 설치 파일을 빌드하고 **GitHub Release**에 올립니다.

### 사용 방법

일반적인 흐름: **로컬 LKJ_DEV**에서 작업 → **원격 LKJ_DEV**로 푸시 → **main**으로 PR 머지.

**릴리스(설치 파일 자동 빌드)**를 만들 때:

1. **버전 올리기**  
   `package.json`의 `version`을 수정합니다 (예: `0.1.0` → `0.1.1`).
2. **커밋 후 푸시**
   - LKJ_DEV에서 작업한 경우:
     ```bash
     git add package.json
     git commit -m "chore: bump version to 0.1.1"
     git push origin LKJ_DEV
     ```
   - main으로 PR 머지한 뒤, **릴리스용 태그**는 보통 main에서 붙입니다:
     ```bash
     git checkout main
     git pull origin main
     git tag v0.1.1
     git push origin v0.1.1
     ```
   - LKJ_DEV에서 바로 태그만 푸시해도 됩니다: `git tag v0.1.1` 후 `git push origin v0.1.1`
3. **Actions 탭**에서 `release` 워크플로우가 돌고, 완료되면 **Releases**에 `.exe`, `latest.yml`, `.blockmap`이 올라갑니다.

### 워크플로우 동작

- **트리거**: `v*` 태그 푸시 (예: `v0.1.0`, `v0.1.1`)
- **빌드**: Windows x64(`windows-latest`) + Mac(`macos-latest`) 각각 빌드
- **결과**: 해당 태그로 GitHub Release 생성, `.exe`(Windows)·`.dmg`/`.zip`(Mac)·메타데이터 업로드

설정 파일: [.github/workflows/release.yml](.github/workflows/release.yml)

### 자동 업데이트 연동 (GitHub 기준)

- **설정됨**: `package.json`의 `publish`가 `"provider": "github"`로 되어 있어, 설치된 앱이 **GitHub Release**에서 새 버전을 확인합니다.
- **필수**: `package.json`의 `repository.url`에서 **YOUR_ORG**를 실제 GitHub 조직(또는 사용자명), **PCOFF_TEST**를 실제 저장소 이름으로 바꾸세요.  
  예: `https://github.com/tigris5240/PCOFF_TEST.git`
- **동작**: 태그 푸시 시 CI가 **태그 버전으로 package.json version 갱신 후** 빌드해 Release에 업로드. 사용자 앱은 **시작 시 자동 검사** + 수동 「업데이트 확인」, 다운로드 후 **종료 시** 자동 적용.

---

## 테스트 방법

### 비개발자용 (간단 요약)

1. **명령 창(터미널)**을 열고, 이 프로젝트 폴더로 이동한 뒤 아래를 **한 줄씩** 입력합니다.  
   `npm install` → Enter  
   `npm run build` → Enter  
   `npm start` → Enter  
2. **로그인 화면**이 뜨면: 전화번호 입력 → **다음** → 서비스 영역 선택 → 사용자 ID·비밀번호 입력 → **로그인**.  
3. **잠금(메인) 화면**이 뜨면: 「나의 근태정보 불러오기」, 「임시연장」, 「PC-ON」 등 버튼이 보이고, 눌렀을 때 토스트나 패널이 나오면 정상입니다.  
4. **로그인 화면부터 다시 테스트**하려면: 잠금 화면에서 **Ctrl+Shift+L**(Windows) 또는 **Cmd+Shift+L**(Mac)을 누르면 로그인 화면으로 돌아갑니다.

- **자세한 단계·예상 화면·문제 해결**은 **[docs/테스트_가이드_비개발자.md](docs/테스트_가이드_비개발자.md)** 를 보세요. (코딩 없이 따라 할 수 있도록 적어 두었습니다.)

---

### 개발자용 상세

#### 1. 앱 실행 (Electron)

```bash
npm start
```

- **로그인 정보**(`state.json`의 `userServareaId`·`userStaffId`)가 있으면 **에이전트(작동정보/잠금) 화면**으로, 없으면 **로그인 화면**으로 시작합니다.
- 로그인 후 **메인(잠금) 화면**에서 근태정보 조회, 임시연장/긴급사용/PC-ON/PC-OFF 동작을 확인할 수 있습니다.

#### 2. 로그인 화면부터 테스트하려면

- 프로젝트 루트의 **`state.json`** 삭제(또는 이름 변경) 후 `npm start`. (로그인 정보는 state.json에서만 읽습니다.)
- 설치 앱: userData 폴더의 `state.json` 삭제. (Windows: `%APPDATA%\5240 PcOff Agent\`, Mac: `~/Library/Application Support/5240 PcOff Agent/`)

자세한 절차는 [docs/로그인_테스트.md](docs/로그인_테스트.md) 참고.

#### 3. 시뮬레이터 (CLI)

```bash
npm run simulator          # 단일 시나리오 (기본: update_success)
npm run simulator:all      # Flow-01~08 전체 시나리오 실행
```

결과는 `artifacts/parity-report.json`, `artifacts/parity-summary.md`에 기록됩니다.

#### 4. 전역 단축키 (맥에서 메뉴 막대 아이콘이 안 보여도 사용 가능)

| 동작 | Windows | Mac |
|------|---------|-----|
| 로그아웃 | Ctrl + Shift + L | Cmd + Shift + L |
| PCOFF 작동정보 창 | Ctrl + Shift + I | Cmd + Shift + I |
| 잠금화면 창 | Ctrl + Shift + K | Cmd + Shift + K |

앱이 실행 중이면 **어디서든** 위 조합으로 동작합니다. (상세: [docs/로그인_테스트.md §7](docs/로그인_테스트.md), [docs/테스트_가이드_비개발자.md §4.6](docs/테스트_가이드_비개발자.md))

---

## 테스트 시나리오

PRD Flow 기준 시뮬레이터 시나리오와 매핑입니다.

| Flow | 시나리오 ID | 설명 | 연관 요구사항 |
|------|-------------|------|----------------|
| Flow-01 | `login_success` | 로그인 성공 | FR-01 |
| Flow-02 | `lock_reason_input` | 잠금 + 사유 입력 | FR-01 |
| Flow-03 | `update_success` | 무확인 자동 업데이트 | FR-03 |
| Flow-04 | `update_failure_retry` | 업데이트 실패·재시도 | FR-03 |
| Flow-05 | `password_change_confirm` | 비밀번호 변경 확인(검증 없음) | FR-04 |
| Flow-06 | `tamper_attempt` | Agent 삭제/우회 탐지 | FR-07 |
| Flow-07 | `offline_detected` | 오프라인/충돌 감지 | FR-08 |
| Flow-08 | `installer_registry_sync` | 설치자 레지스트리 동기화 | FR-09 |
| Flow-09 | `leave_seat_idle` | Idle 기반 이석 감지 | FR-11 |
| Flow-09 | `leave_seat_sleep` | 절전 기반 이석 감지 | FR-11 |
| Flow-10 | `leave_seat_event_report` | 이석 이벤트 서버 전송 | FR-12 |
| Flow-11 | `screen_display_logic` | 시업/종업 화면 결정 | FR-13 |
| Flow-12 | `emergency_unlock` | 긴급해제 (비밀번호) | FR-15 |
| Flow-13 | `offline_recovery_lock` | 오프라인 30분 유예·잠금 | FR-17 |
| Flow-14 | `tray_operation_info` | 트레이 작동정보 조회 | FR-16 |

- 전체 결과: `artifacts/parity-report.json`, 요약: `artifacts/parity-summary.md`
- CI에서 시뮬레이터 자동 실행 시 위 아티팩트를 사용합니다.

---

## 이미 구현된 것

- **로그인**: 2단계(전화번호 → 서비스영역 선택 → 계정·비밀번호), **로그인 정보는 state.json에서만** 사용(config.json fallback 없음). 설치 앱 첫 실행 시 apiBaseUrl만 복사·기존 config 로그인 필드 마이그레이션 제거. **Enter 키**로 다음/로그인 가능.
- **단일 창(mainWindow)**: 작동정보·로그인·잠금화면을 **한 창에서 전환** (새 창 없이 동일 창에서 화면만 변경).
- **잠금화면 닫기 방지 (FR-07·FR-18 보완)**: `currentScreen` 상태 기반 분기. 잠금 중 X 버튼 완전 차단(`preventDefault`), 작동정보 창은 트레이로 숨김, 로그인 창은 일반 닫기 허용. ✅
- **로그아웃·작동정보·잠금화면**: 전역 핫키(Cmd+Shift+L/I/K, Ctrl+Shift+L/I/K). 잠금화면 중에도 로그아웃 핫키 동작(close 우회). 로그인 후 잠금 필요 시 같은 창에서 잠금화면으로 전환.
- **메인(잠금) 화면**: 근태정보 조회, 임시연장/긴급사용/PC-ON/PC-OFF 버튼. **PC-ON**·**긴급사용** 성공 시 같은 창에서 **작동정보 화면**으로 전환.
- **설치자 레지스트리 (FR-09)**: `app/core/installer-registry.ts`. deviceId(UUID)·설치 시각·OS·앱 버전 수집, `installer-registry.json` 로컬 저장, 앱 시작 시 서버 동기화(`/registerInstallerInfo.do`). ✅
- **이석 감지·해제 플로우 (FR-11)**: `app/core/leave-seat.ts`. `screenType=empty` 감지 → `leaveSeatReasonYn/ManYn=YES`이면 사유 입력 모달 → `callCmmPcOnOffLogPrc(IN, reason)`. 휴게시간(`breakStartTime~breakEndTime`) 중이면 사유 면제. 시뮬레이터 Flow-02/02b PASS. ✅
- **로컬 이석/절전 감지 (FR-11)**: `app/core/leave-seat-detector.ts`. 유휴(Idle): `powerMonitor.getSystemIdleTime()` 5초 폴링, API 정책(`leaveSeatUseYn`, `leaveSeatTime` 분) 초과 시 잠금화면. 절전: suspend 시각 기록, resume 시 경과 >= leaveSeatTime 이면 이석 잠금(감지시각=절전 시작). `getWorkTime` 응답에 로컬 이석 병합. **API 정규화**: 서버가 `leaveSeatUseYn`을 `"YES"`/`"NO"`로 내려줘도 `normalizeLeaveSeatUseYn()`으로 `"Y"`/`"N"` 변환 후 정책 적용. ✅
- **API 연동**: getPcOffWorkTime, getPcOffServareaInfo, getPcOffLoginUserInfo, callPcOffTempDelay, callPcOffEmergencyUse, callCmmPcOnOffLogPrc
- **시뮬레이터·CI**: Flow-01~08 시나리오, parity-report.json, parity-summary.md, CI 아티팩트
- **로깅**: JSONL, TelemetryLogger. LOG_CODES 상수로 APP_START, LOGIN_SUCCESS/FAIL, LOGOUT, LOCK/UNLOCK_TRIGGERED, UPDATE_*, AGENT_*, INSTALLER_REGISTRY_SYNC/FAIL, TRAY_*, LEAVE_SEAT_* 등 기록 (logcode.md·constants.ts 참고) ✅
- **자동 업데이트 (FR-03)**: `electron-updater` 기반 무확인 자동 업데이트, 재시도 큐, 진행률 UI 표시 ✅
- **비밀번호 변경 확인 (FR-04)**: 서버 `pwdChgYn=Y` 감지 시 확인 전용 모달, 검증/재로그인 없음 ✅
- **Agent Guard (FR-07)**: 무결성 체크(SHA-256), 파일 감시, 탐지 시 로그·복구 트리거, IPC 연동 ✅
- **Ops Observer (FR-08)**: heartbeat·로그 배치 서버 전송(`/reportAgentEvents.do`), 크래시/오프라인 보고 ✅
- **에이전트 UI·잠금화면 분리**: 트레이 작동정보(`main.html`), 잠금화면(`lock.html`), 로그인(`index.html`) — 단일 창에서 전환, 시스템 트레이 메뉴, 운영 모드 관리 ✅
- **트레이 아이콘**: `scripts/create-tray-icon.mjs`로 16×16 PNG 생성(postbuild), macOS `setTemplateImage` 적용. 파일 없을 때 Base64 fallback.
- **CI·릴리스 (패키징)**: 태그 푸시(v*) 시 GitHub Actions로 Windows x64·Mac 빌드 후 GitHub Release 업로드. Windows → .exe, Mac → .dmg/.zip. ✅
- **자동 업데이트 (GitHub)**: `publish.provider: "github"` — 설치된 앱이 GitHub Release에서 새 버전 확인·자동 적용. ✅
- **푸시 용량 초과 해결**: `release/` .gitignore, 히스토리에서 제거 방법은 [docs/깃_푸시_용량초과_해결.md](docs/깃_푸시_용량초과_해결.md) 참고. ✅

---

## 구현 해야 할 것

| 순서 | 항목 | 요약 |
|------|------|------|
| ~~-~~ | ~~설치자 레지스트리~~ | ~~설치자 정보 서버 등록·조회 (FR-09, Flow-08)~~ **완료** ✅ |
| ~~-~~ | ~~잠금화면·에이전트 창 닫기 방지~~ | ~~창 X버튼/닫기 차단 (FR-07·FR-18 보완)~~ **완료** ✅ |
| ~~1~~ | ~~이석 감지·해제 플로우~~ | Idle/절전 기반 이석 감지, 사유 입력, 휴게시간 예외 (FR-11, Flow-09) **완료** ✅ |
| ~~2~~ | ~~로그 코드 전수 반영~~ | logcode.md와 constants.ts 동기화, LOG_CODES 상수 통합 **완료** ✅ |
| 3 | 패키징·플랫폼 검증 | Windows/Mac CI 빌드·Release **완료** ✅. 코드 서명·notarization은 **마지막에 진행** (NFR-01, DoD) |
| 4 | 인스톨/언인스톨 정책 | 설치자 식별, 무결성 기준선, 삭제 방지 (FR-19) |
| 5 | 프로세스 Kill 통제 | 사용자 Kill 차단, OTP 승인 (FR-18) |
| 6 | 오프라인 복구·잠금 | 30분 유예, 오프라인 잠금, 복구 시도 (FR-17, Flow-13) |
| 7 | 다중 디스플레이 | 잠금 강화 alwaysOnTop·포커스, QA 시나리오 |
| 8 | Windows Defender/SmartScreen 대응 | 코드 서명, 평판 관리, 업데이트 무결성 |
| ~~9~~ | ~~이석/절전 감지 구현~~ | Idle·절전 기반 이석 화면, leaveDetectedAt 표시 **완료** ✅ |
| 10 | 이석정보 서버 전송 | LEAVE_SEAT_START/END 세션 매핑, 재시도 큐 (FR-12, Flow-10) |
| ~~11~~ | ~~시업/종업 화면 로직~~ | exCountRenewal 기준 시업/종업 구분, resolveScreenType·캐시 반영 **완료** ✅ |
| 12 | 고객사 설정 반영 | 문구·이미지·로고·긴급해제·이석해제 비밀번호 (FR-14) |
| 13 | 긴급해제 (비밀번호) | 비밀번호 검증, 시도제한, 3시간 만료 (FR-15, Flow-12) |
| ~~-~~ | ~~트레이 작동정보~~ | ~~근태·버전·모드 표시 (FR-16, Flow-14)~~ **완료** ✅ |

상세 내용은 **[docs/다음_개발_진행_사항.md](docs/다음_개발_진행_사항.md)** 참고.

---

## 문서

- **[docs/테스트_가이드_비개발자.md](docs/테스트_가이드_비개발자.md)** — 비개발자용 테스트 방법 (단계별·상세·문제 해결)
- [docs/로그인_테스트.md](docs/로그인_테스트.md) — 로그인 테스트 방법·개발자 로그아웃 핫키
- [PRD_5240_PcOff_Electron.md](PRD_5240_PcOff_Electron.md) — 제품 요구사항
- [TRD_5240_PcOff_Electron.md](TRD_5240_PcOff_Electron.md) — 기술 요구사항·아키텍처·IPC
- [PC_OFF_AGENT_API.md](PC_OFF_AGENT_API.md) — PCOFF API 규격
- [docs/다음_개발_진행_사항.md](docs/다음_개발_진행_사항.md) — 완료 항목·다음 작업 정리
- [docs/개발_이력_리포트.md](docs/개발_이력_리포트.md) — 개발 이력·이슈 해결 기록
- [docs/깃_푸시_용량초과_해결.md](docs/깃_푸시_용량초과_해결.md) — release/ 푸시 거부 시 히스토리 정리 방법
- [docs/윈도우_설치_테스트_가이드.md](docs/윈도우_설치_테스트_가이드.md) — Windows 설치 파일 빌드·설치·실행 테스트 방법
- [docs/맥_설치_가이드.md](docs/맥_설치_가이드.md) — Mac 설치 파일 "열 수 없음" / Gatekeeper 경고 시 실행 방법
- [docs/업데이트_가이드_사용자.md](docs/업데이트_가이드_사용자.md) — 이미 설치한 사용자용 업데이트 확인·적용 방법
- [docs/operations/logcode.md](docs/operations/logcode.md) — 로그 코드 매핑
