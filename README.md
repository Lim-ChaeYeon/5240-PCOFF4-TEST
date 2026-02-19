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

- 로그인 정보가 없으면 **로그인 화면**이 먼저 표시됩니다.
- 로그인 후 **메인(잠금) 화면**에서 근태정보 조회, 임시연장/긴급사용/PC-ON/PC-OFF 동작을 확인할 수 있습니다.

#### 2. 로그인 화면부터 테스트하려면

- `config.json`에서 `userServareaId`, `userStaffId`를 제거하거나, `config.login-test.json` 내용으로 덮어쓴 뒤 실행.
- 또는 프로젝트 루트의 `state.json` 삭제(또는 이름 변경) 후 `npm start`.

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

- **로그인**: 2단계(전화번호 → 서비스영역 선택 → 계정·비밀번호), `state.json` 저장, 에러 메시지 디코딩. **Enter 키**로 다음/로그인 가능.
- **단일 창(mainWindow)**: 작동정보·로그인·잠금화면을 **한 창에서 전환** (새 창 없이 동일 창에서 화면만 변경).
- **로그아웃·작동정보·잠금화면**: 전역 핫키(Cmd+Shift+L/I/K, Ctrl+Shift+L/I/K). 로그인 후 잠금 필요 시 같은 창에서 잠금화면으로 전환.
- **메인(잠금) 화면**: 근태정보 조회, 임시연장/긴급사용/PC-ON/PC-OFF 버튼. **PC-ON**·**긴급사용** 성공 시 같은 창에서 **작동정보 화면**으로 전환.
- **API 연동**: getPcOffWorkTime, getPcOffServareaInfo, getPcOffLoginUserInfo, callPcOffTempDelay, callPcOffEmergencyUse, callCmmPcOnOffLogPrc
- **시뮬레이터·CI**: Flow-01~08 시나리오, parity-report.json, parity-summary.md, CI 아티팩트
- **로깅**: JSONL, TelemetryLogger, APP_START, LOGIN_SUCCESS/FAIL, UPDATE_*, AGENT_* 등 이벤트 (logcode.md 참고)
- **자동 업데이트 (FR-03)**: `electron-updater` 기반 무확인 자동 업데이트, 재시도 큐, 진행률 UI 표시 ✅
- **비밀번호 변경 확인 (FR-04)**: 서버 `pwdChgYn=Y` 감지 시 확인 전용 모달, 검증/재로그인 없음 ✅
- **Agent Guard (FR-07)**: 무결성 체크(SHA-256), 파일 감시, 탐지 시 로그·복구 트리거, IPC 연동 ✅
- **Ops Observer (FR-08)**: heartbeat·로그 배치 서버 전송(`/reportAgentEvents.do`), 크래시/오프라인 보고 ✅
- **에이전트 UI·잠금화면 분리**: 트레이 작동정보(`main.html`), 잠금화면(`lock.html`), 로그인(`index.html`) — 단일 창에서 전환, 시스템 트레이 메뉴, 운영 모드 관리 ✅
- **트레이 아이콘**: `scripts/create-tray-icon.mjs`로 16×16 PNG 생성(postbuild), macOS `setTemplateImage` 적용. 파일 없을 때 Base64 fallback.

---

## 구현 해야 할 것

| 순서 | 항목 | 요약 |
|------|------|------|
| 1 | 설치자 레지스트리 | 설치자 정보 서버 등록·조회 (FR-09, Flow-08) |
| 2 | 이석 감지·해제 플로우 | Idle/절전 기반 이석 감지, 사유 입력, 휴게시간 예외 (FR-11, Flow-09) |
| 3 | 이석정보 서버 전송 | LEAVE_SEAT_START/END 세션 매핑, 재시도 큐 (FR-12, Flow-10) |
| 4 | 오프라인 복구·잠금 | 30분 유예, 오프라인 잠금, 복구 시도 (FR-17, Flow-13) |
| 5 | 긴급해제 (비밀번호) | 비밀번호 검증, 시도제한, 3시간 만료 (FR-15, Flow-12) |
| 6 | 시업/종업 화면 로직 | 종업화면/시업화면 결정, PC-ON 예외, 자율출근 (FR-13, Flow-11) |
| 7 | 고객사 설정 반영 | 문구·이미지·로고·긴급해제·이석해제 비밀번호 (FR-14) |
| ~~8~~ | ~~트레이 작동정보~~ | ~~근태·버전·모드 표시, 실시간 갱신 (FR-16, Flow-14)~~ **완료** |
| 9 | 프로세스 Kill 통제 | 사용자 Kill 차단, OTP 승인 (FR-18) |
| 10 | 인스톨/언인스톨 정책 | 설치자 식별, 무결성 기준선, 삭제 방지 (FR-19) |
| 11 | 로그 코드 전수 반영 | logcode.md와 필수 이벤트 매핑 (PRD §7) |
| 12 | Windows Defender/SmartScreen 대응 | 코드 서명, 평판 관리, 업데이트 무결성 |
| 13 | 패키징·플랫폼 검증 | Windows installer, macOS pkg/dmg, 코드 서명 (NFR-01, DoD) |

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
- [docs/operations/logcode.md](docs/operations/logcode.md) — 로그 코드 매핑
