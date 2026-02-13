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

#### 4. 개발자용 로그아웃 핫키

- **macOS**: `Cmd + Shift + L`
- **Windows**: `Ctrl + Shift + L`  

메인 화면에서 위 조합 입력 시 로그인 정보 삭제 후 로그인 화면으로 전환됩니다. (상세: [docs/로그인_테스트.md §7](docs/로그인_테스트.md))

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

- 전체 결과: `artifacts/parity-report.json`, 요약: `artifacts/parity-summary.md`
- CI에서 시뮬레이터 자동 실행 시 위 아티팩트를 사용합니다.

---

## 이미 구현된 것

- **로그인**: 2단계(전화번호 → 서비스영역 선택 → 계정·비밀번호), `state.json` 저장, 에러 메시지 디코딩
- **로그아웃**: 개발자용 핫키(Cmd+Shift+L / Ctrl+Shift+L)
- **메인(잠금) 화면**: 근태정보 조회, 임시연장/긴급사용/PC-ON/PC-OFF 버튼, screenType·pcOnYn·긴급사용 정책 반영
- **API 연동**: getPcOffWorkTime, getPcOffServareaInfo, getPcOffLoginUserInfo, callPcOffTempDelay, callPcOffEmergencyUse, callCmmPcOnOffLogPrc
- **시뮬레이터·CI**: Flow-01~08 시나리오, parity-report.json, parity-summary.md, CI 아티팩트
- **로깅**: JSONL, TelemetryLogger, APP_START, LOGIN_SUCCESS/FAIL 등 일부 이벤트
- **업데이트·Guard·Auth**: 스캐폴드(모의 다운로드/검증, 해시 기반 무결성, 비밀번호 변경 로그만)

---

## 구현 해야 할 것

| 순서 | 항목 | 요약 |
|------|------|------|
| 1 | 자동 업데이트 실구현 | 실제 다운로드/무결성 검증/무확인 적용, 실패 시 재시도·롤백 (FR-03, Flow-03/04) |
| 2 | 비밀번호 변경 이벤트 + 확인 UI | 서버 감지 → 확인 UI만, 비밀번호 검증·재로그인 없음 (FR-04, Flow-05) |
| 3 | Agent Guard 실구현 | Windows/macOS 삭제·우회 탐지, 무결성 체크, 자동 복구 (FR-07, Flow-06) |
| 4 | Ops Observer 실구현 | 비정상 종료·통신 두절 시 서버 로그 전송 (FR-08, Flow-07) |
| 5 | 설치자 레지스트리 | 설치자 정보 서버 등록·조회 (FR-09, Flow-08) |
| 6 | 이석 해제 플로우 | 이석 화면 사유 입력 후 PC-ON (Flow-02 연계) |
| 7 | 로그 코드 전수 반영 | logcode.md와 필수 이벤트 매핑 (PRD §7) |
| 8 | 패키징·플랫폼 검증 | Windows installer, macOS pkg/dmg, 코드 서명 (NFR-01, DoD) |

상세 내용은 ** [docs/다음_개발_진행_사항.md](docs/다음_개발_진행_사항.md)** 참고.

---

## 문서

- **[docs/테스트_가이드_비개발자.md](docs/테스트_가이드_비개발자.md)** — 비개발자용 테스트 방법 (단계별·상세·문제 해결)
- [docs/로그인_테스트.md](docs/로그인_테스트.md) — 로그인 테스트 방법·개발자 로그아웃 핫키
- [PRD_5240_PcOff_Electron.md](PRD_5240_PcOff_Electron.md) — 제품 요구사항
- [TRD_5240_PcOff_Electron.md](TRD_5240_PcOff_Electron.md) — 기술 요구사항·아키텍처
- [PC_OFF_AGENT_API.md](PC_OFF_AGENT_API.md) — PCOFF API 규격
- [docs/다음_개발_진행_사항.md](docs/다음_개발_진행_사항.md) — 완료 항목·다음 작업 정리
- [docs/operations/logcode.md](docs/operations/logcode.md) — 로그 코드 매핑
