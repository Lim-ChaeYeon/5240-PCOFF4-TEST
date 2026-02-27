# PRD - 5240.PcOff 신규 제작 (Electron 전환)

## 0. Document Meta

| 항목 | 내용 |
|---|---|
| **Product** | 5240.PcOff Agent |
| **Project Type** | Legacy Migration (MFC → Electron) |
| **Target Platforms** | Windows, macOS |
| **Goal** | Feature parity with existing PcOff client and updated operational policies |
| **Source References** | `purpose.md` (legacy), `usage.md` (legacy), `api.md` (legacy), `logcode.md` (legacy) |
| **Last Updated** | 2026-02-16 |

이 문서는 MFC 기반으로 개발돼 Windows에만 대응하던 5240.PcOff Agent를 Electron 기반으로 재구축하는 프로젝트의 Product Requirements Document(PRD)다. 기존 기능을 유지하면서 macOS 지원과 운영 효율 강화를 목표로 한다.

---

## 1. Problem Statement

기존 5240.PcOff는 MFC 기반으로 Windows 환경에 종속되어 있으며 macOS를 지원하지 못한다. 업데이트 및 인증 정책 또한 운영 편의성과 보안 요구 사항에 부합하지 않는다.

---

## 1.5 프로그램 목적

### 근무시간 제어

- PC OFF는 근태정보(출근, 시업, 종업, 퇴근, 휴일, 휴가, 연장근무)에 따라 **허용된 근무시간에만** PC 사용을 가능하게 한다.
- 근무시간 외에는 화면을 자동으로 잠궈 사용을 제한한다.

### PCON / PCOFF 동작

- **PCON**: 시업시간 이전, 정해진 시간 전에 PC를 켤 수 있다.
- **PCOFF**: 종업 또는 연장근무 종료 이후, 정해진 시각에 화면을 잠근다.

### 화면별 기능

| 화면 | 제공 기능 |
|------|-----------|
| **시업 화면** | 임시연장, PCON 가능 |
| **이석 화면** | PCON 가능 |
| **종업 화면** | 임시사용, 긴급사용, PCON 가능 |
| **공통** | 모든 화면에서 PC 종료, 긴급해제 사용 가능 |

### PCOFF된 상태에서 PC 사용

- **임시연장**: PC OFF 시각 도래 시, 규칙에 따라 사용 가능.
- **긴급사용**: 근무시간 외 제한된 시간대에, 규칙에 따라 사용 가능.
- **긴급해제**: PC가 잠긴 상황에서 비밀번호를 입력하여 잠금 해제.

---

## 1.6 잠금화면 문구

### 잠금화면 종류

잠금화면은 **시업 화면**, **이석 화면**, **종업 화면** 3종이다.

### 잠금화면 문구 1 (고객사 문구)

- 시업 화면, 이석 화면, 종업 화면 각각에 **고객사별로 정해진 문구**가 표시된다.
- 문구 내용은 고객사 설정/운영 정책에 따라 서버 또는 설정값으로 제공된다.

### 잠금화면 문구 2 (시스템 문구)

- **시스템에서 정한 문구**가 표시된다.
- 문구 내용은 추후 정한다.

---

## 2. Product Goals (What Success Means)

### G‑01 Feature Parity

기존 MFC 기반 PcOff의 기능과 사용자 시나리오를 동일하게 제공한다.

### G‑02 Cross Platform

Windows와 macOS에서 동일 수준으로 동작해야 한다.

### G‑03 Auto Update (No Confirmation)

업데이트가 감지되면 사용자 확인 없이 자동으로 다운로드 및 적용해야 한다.

### G‑04 Auth Policy Change

비밀번호 변경 이벤트 발생 시 사용자 확인은 유지하되 비밀번호 검증은 수행하지 않는다.

### G‑05 Simulator + CI

QA/개발팀이 재현 가능한 시뮬레이터를 제공하며 CI에서 자동 실행 가능해야 한다.

### G‑06 Agent Protection + Observability

사용자가 임의로 삭제할 수 없도록 보호하고, 이상 상황을 서버에 보고해야 한다.

### G‑07 Git‑based Traceability

요건, 설계, 테스트, 릴리즈 산출물을 Git 기반으로 추적 가능하게 관리한다.

---

## 3. In Scope / Out of Scope

### 3.1 In Scope (Must Have)

* 기존 UI 플로우 유지
* 잠금, 해제, 로그인, 사유 입력, 타이머, 알림 기능
* 자동 업데이트 무확인 적용
* 비밀번호 변경 정책 변경(비밀번호 검증 제외)
* 시뮬레이터 및 CI 자동 실행
* Agent 삭제 방지, 무결성 감시, 자동 복구 트리거
* 이상 상황 중앙 서버 로그 전송
* 설치자 목록 기록 및 서버 조회 가능

### 3.2 Out of Scope (Not Now)

* UI/UX 리디자인(기능 동등성 확보가 우선)
* 신규 기능 추가(레거시 확장)
* 서버 기능 전면 재설계(`api.md` 범위 내에서만 동작)

---

## 4. Functional Requirements (FR)

### FR‑01 Feature Parity

기존 동작 방식과 업무 규칙을 보존한다. 동등성 판단 기준은 코드 동일성이 아니라 시나리오 결과 동일성이다.

### FR‑02 Cross Platform Support

Windows 및 macOS에서 동일 수준의 기능을 제공하며 OS 차이로 인해 UI나 동작이 달라지면 안 된다.

### FR‑03 Auto Update (Silent)

업데이트 감지 시 사용자 확인 없이 다운로드 및 적용한다. 업데이트 완료 후 정책에 따라 자동 재시작 또는 적용한다.

### FR‑04 Password Change Policy (Confirm Only)

비밀번호 변경 이벤트 감지 시 사용자에게 확인 UI를 제공하되 비밀번호 일치 검증(재로그인/패스워드 체크)은 수행하지 않는다.

### FR‑05 Simulator for QA/Dev

로그인, 잠금, 업데이트, 비밀번호 변경, 네트워크 장애 등 주요 이벤트를 재현 가능한 시뮬레이터를 제공하며 로컬 CLI로 실행 가능해야 한다.

### FR‑06 Git‑based Artifacts

제품 요구사항, 기술 요구사항, 아키텍처 결정 기록, 테스트 결과, 릴리즈 노트를 모두 Git에 저장한다.

### FR‑07 Agent Guard

사용자가 Agent를 임의로 삭제할 수 없도록 보호하며, 파일과 서비스 무결성을 확인하고 삭제나 손상 감지 시 자동 복구 또는 관리자 승인 플로우를 제공한다.

### FR‑08 Observer Logging

에이전트 이상 상황(중지, 충돌, 통신두절, 무결성 오류)을 중앙 서버로 전송한다.

### FR‑09 Installer Registry

설치 수행자의 계정, 사번, 기기 정보, 설치 시간을 서버에 적재하고 조회/필터 기능을 제공한다.

### FR‑10 Server Configuration API

서버 설정값은 `api.md`에 정의된 인터페이스로 수신/적용하며, PCOFF Agent 통신 규격은 `docs/integration/PC_OFF_AGENT_API.md`를 단일 소스로 삼는다.

### FR‑11 Leave Seat Detection (이석 감지)

마우스/키보드 미사용 기준 시간(API 이석시간) 초과 또는 절전모드 복귀 시 절전 경과시간이 이석시간 이상이면 이석 화면을 표시한다. 이석 화면에는 이석감지시각을 표시하며, 절전 초과 시 절전 시작시각으로 표기한다.

**이석 적용 조건 (로컬 이석 감지 시 잠금 표시 여부):**
* 이미 잠금화면(종업/시업 전)인 경우 → 이석 감지를 적용하지 않음(종업/시업 전 화면 유지).
* 긴급해제(EMERGENCY_RELEASE) 중인 경우만 → 이석 감지를 적용하지 않음(유휴/절전 시에도 이석 잠금 미표시). 임시연장·긴급사용 중에는 이석 체크 적용.
* 그 외(일반 해제 상태)에서만 유휴/절전 기준 초과 시 이석 잠금 화면을 표시한다.

### FR‑12 Leave Seat Event Reporting (이석정보 서버 전송)

일반모드/임시연장/긴급사용 중 이석 발생 시 `LEAVE_SEAT_START`, 복귀 시 `LEAVE_SEAT_END`를 서버에 전송한다. 세션 기반(leaveSeatSessionId, workSessionId)으로 매핑하며, 전송 실패 시 로컬 큐(JSONL)에 적재 후 지수 백오프로 재시도한다. 재시도 초과 시 Ops Observer에 경고한다. reason 필드는 200자 제한, 제어문자 제거, 로그 마스킹을 적용한다.

### FR‑13 Screen Display Logic (시업/종업 화면 로직)

종업시각/임시연장 허용시간 조합에 따라 종업화면과 시업화면을 일관된 규칙으로 표시한다. PC-ON 허용시간에 PC를 켠 경우 시업화면 없이 즉시 사용 가능하다. 자율출근(시업시각 없음) 시 시업화면에서 PC-ON으로 출근처리할 수 있다.

### FR‑14 Tenant Lock Policy (고객사 설정 반영)

고객사 관리자 콘솔에서 시업/종업/이석 화면 문구·이미지, 잠금화면 로고, 긴급해제 사용/비밀번호(minLength, requireComplexity, maxFailures, lockoutSeconds, expiresInDays), 이석해제 비밀번호 옵션을 설정할 수 있다. 설정은 서버에서 배포(Push + Periodic Polling 하이브리드)되며, 에이전트는 캐시 후 동적 렌더링한다. 관리자 콘솔은 Draft/Publish/Rollback 워크플로우와 권한 모델(VIEWER/EDITOR/APPROVER/ADMIN)을 지원한다.

### FR‑15 Emergency Unlock (긴급해제)

긴급사용과 별개로, 비밀번호 검증 후 잠금을 해제하는 긴급해제 기능을 제공한다. 5회 초과 실패 시 5분 차단하며, 긴급해제 성공 후 3시간 경과 시 조건 기반 잠금화면으로 자동 복귀한다.

### FR‑16 Tray Operation Info (트레이 작동정보 조회)

시스템 트레이에서 PCOFF 작동정보(현재 반영 근태정보, 버전정보, 현재 모드)를 즉시 조회할 수 있다. 모드 전환 시 실시간 UI 갱신을 제공한다.

### FR‑17 Offline Recovery Lock (오프라인 복구·잠금)

오프라인 시 전용 안내 화면을 표시하고, 30분 유예 후 미복구 시 화면 잠금(PC 사용 불가) 상태로 전환한다. 전 과정을 heartbeat 및 이벤트 로그로 보고한다.

### FR‑18 Process Kill Control (프로세스 Kill 통제)

사용자 임의 종료를 차단하며(표준 권한에서 kill/taskkill 불가), Kill은 관리자 OTP 검증 후에만 허용한다. 감사 로그 100% 기록, Windows/Linux/macOS 동일 모델 적용. Process Fingerprint(pid, createdAt, exePath, cmdLine, hash)로 PID 재사용 공격을 방지하며, KillToken은 JWT/PASETO 기반 TTL 2분으로 발급한다. OTP 재시도 제한 3회, 초과 시 30분 차단.

### FR‑19 Install/Uninstall Policy (인스톨/언인스톨 정책)

설치 시 환경 점검(OS/디스크/네트워크/권한), 중복 설치 탐지, 설치자 인증(사번·계정·기기)을 수행하고 무결성 기준선(SHA-256)을 생성한다. 최소 권한 설치기로 불필요한 시스템 변경을 최소화한다. 일반 사용자 임의 삭제를 금지하며, 삭제는 관리자 승인 또는 정책 토큰(1회용)으로만 허용한다. 삭제 시도 탐지 시 자동 복구를 트리거하고, 복구 실패 시 격리 모드로 전환한다.

---

## 5. Non‑Functional Requirements (NFR)

### NFR‑01 Packaging

* Windows: Installer 패키지 제공
* macOS: pkg 또는 dmg 패키지 제공

### NFR‑02 Update Rollback/Retry

업데이트 실패 시 재시도 또는 롤백 전략이 필요하다.

### NFR‑03 Security Auditability

비밀번호 검증 제외 정책에 대한 감사 로그를 남기며 모든 이벤트를 전수 기록하고 조회할 수 있어야 한다.

### NFR‑04 Simulator in CI

시뮬레이터는 CI 환경에서 실행 가능해야 한다.

### NFR‑05 OS Security Model Consideration

Windows와 macOS의 권한 모델 차이를 고려해 우회 시도를 탐지하고 기록한다.

### NFR‑06 Central Log Retention/Search

서버는 기간과 단말별 로그를 검색하고 지정 기간 동안 보관할 수 있어야 한다.

---

## 6. Key User Flows (Acceptance Oriented)

### Flow‑01 Login

1. 사용자가 로그인 화면에 전화번호와 계정/비밀번호를 입력한다.
2. 서버 인증에 성공하면 메인 상태로 진입한다.
3. 인증 실패 시 오류 메시지와 함께 로그를 기록한다.

**Acceptance:** 기존 MFC 시나리오와 동일한 성공/실패 분기를 보여야 한다.

### Flow‑02 Lock and Reason Input

1. 사용자가 잠금을 실행하면 사유 입력 UI가 표시된다.
2. 타이머가 동작하고 알림 분기가 실행된다.

**Acceptance:** 사유 입력 필수 여부와 타이머 규칙이 기존과 동일해야 한다.

### Flow‑03 Auto Update (Silent)

1. 앱 실행 시 업데이트를 확인한다.
2. 새 버전을 발견하면 백그라운드 다운로드를 수행한다.
3. 다운로드가 완료되면 사용자 입력 없이 자동 적용한다.

**Acceptance:** 사용자 Yes/No 입력을 요구하는 UI가 나타나면 실패이다.

### Flow‑04 Update Failure Handling

1. 다운로드 실패 시 재시도 큐에 등록한다.
2. 패키지 무결성 실패 시 업데이트를 취소하고 기존 버전을 유지한다.
3. 반복 실패 시 로컬 로그에 기록하고 원격 이벤트를 전송한다.

**Acceptance:** 업데이트 실패가 앱 기능 중단으로 이어지면 실패이다.

### Flow‑05 Password Change Event

1. 서버 또는 설정에서 비밀번호 변경 이벤트를 감지한다.
2. 사용자 확인 UI를 표시한다.
3. 사용자가 확인하면 정책을 적용한다.
4. 비밀번호 검증은 수행하지 않는다.

**Acceptance:** 비밀번호 입력 요구나 재로그인 요구가 있다면 실패이다.

### Flow‑06 Agent Delete Attempt

1. 사용자가 파일 삭제나 서비스 종료를 시도한다.
2. agent‑guard가 이를 탐지한다.
3. 차단하거나 자동 복구 트리거를 실행한다.
4. 서버에 이상 상황을 전송한다.

**Acceptance:** 삭제가 가능하면 실패이고 탐지 및 로그 전송이 누락되면 실패이다.

### Flow‑07 Crash / Stop / Offline

1. 에이전트 비정상 종료가 발생한다.
2. 자동 재시작하거나 상태를 보고한다.
3. 중앙 서버에 로그를 전송한다.

**Acceptance:** 서버에 “중지/충돌/통신단절” 상태 기록이 남아야 한다.

### Flow‑08 Installer Registry

1. 설치 수행자를 식별한다.
2. 서버로 등록한다.
3. 서버에서 조회할 수 있다.

**Acceptance:** 설치자 정보가 누락되면 실패이다.

### Flow‑09 Leave Seat Detection

1. 마우스/키보드 미사용 시간이 API 이석시간(leaveSeatTime)을 초과한다.
2. 또는 절전모드 복귀 시 절전 경과시간이 이석시간 이상이다.
3. 이석 화면을 표시하고 이석감지시각을 표기한다.
4. 이석 해제 시 사유 정책에 따라 사유를 입력한다. (단, 휴게시간 중에는 사유입력 면제)

**Acceptance:** 이석 감지·표시·해제가 정책대로 동작해야 하며, 휴게시간 사유 면제가 적용되어야 한다.

### Flow‑10 Leave Seat Event Reporting

1. 일반모드/임시연장/긴급사용 중 이석 발생 시 `LEAVE_SEAT_START`를 서버에 전송한다.
2. 복귀(해제) 시 `LEAVE_SEAT_END`를 서버에 전송한다.
3. 전송 실패 시 로컬 큐에 적재 후 온라인 복구 시 재전송한다.

**Acceptance:** START/END가 동일 세션ID로 매핑되고, 전송 실패 시 재시도가 동작해야 한다.

### Flow‑11 Screen Display Logic

1. 종업시각과 임시연장 허용시간에 따라 종업화면/시업화면을 결정한다.
2. PC-ON 허용시간에 PC를 켠 경우 시업화면 없이 즉시 사용 가능하다.
3. 자율출근(시업시각 없음) 시 시업화면에서 PC-ON으로 출근처리할 수 있다.

**Acceptance:** 시나리오별 화면 전환이 설계서와 일치해야 한다.

### Flow‑12 Emergency Unlock

1. 잠금 상태에서 긴급해제 버튼을 누른다.
2. 비밀번호를 입력하고 서버 검증을 수행한다.
3. 검증 성공 시 잠금을 해제하고, 3시간 후 조건 기반 잠금화면으로 복귀한다.
4. 5회 초과 실패 시 5분간 재시도를 차단한다.

**Acceptance:** 비밀번호 검증, 시도 제한, 3시간 만료가 동작해야 한다.

### Flow‑13 Offline Recovery Lock

1. 오프라인을 감지하고 전용 안내 화면을 표시한다.
2. 30분간 복구를 시도하며 경과 시간을 표시한다.
3. 30분 내 미복구 시 화면 잠금(PC 사용 불가) 상태로 전환한다.
4. 온라인 복구 시 재인증 후 해제 가능하다.

**Acceptance:** 30분 유예, 잠금 전환, 복구 후 해제가 동작해야 한다.

### Flow‑14 Tray Operation Info

1. 트레이에서 PCOFF 작동정보를 선택한다.
2. 현재 반영 근태정보, 버전정보, 현재 모드를 표시한다.
3. 모드 전환 시 UI가 실시간 갱신된다.

**Acceptance:** 트레이 진입 → 정보 표시 → 모드 전환 갱신이 동작해야 한다.

---

## 7. Logging Requirements (Product Level)

로그는 운영 감사 및 장애 재현을 가능하게 해야 한다.

필수 이벤트:
* `APP_START`
* `LOGIN_SUCCESS` / `LOGIN_FAIL` / `LOGOUT`
* `LOCK_TRIGGERED` / `UNLOCK_TRIGGERED`
* `UPDATE_FOUND` / `UPDATE_DOWNLOADED` / `UPDATE_APPLIED` / `UPDATE_FAILED`
* `PASSWORD_CHANGE_DETECTED` / `PASSWORD_CONFIRM_DONE`
* `AGENT_TAMPER_DETECTED` / `AGENT_TAMPER_ATTEMPT` / `AGENT_RECOVERED` / `AGENT_RECOVERY_FAILED` / `AGENT_STOP_ATTEMPT`
* `CRASH_DETECTED` / `OFFLINE_DETECTED` / `OFFLINE_TIMEOUT_LOCK` / `OFFLINE_RECOVERED`
* `HEARTBEAT`
* `LEAVE_SEAT_IDLE_DETECTED` / `LEAVE_SEAT_SLEEP_DETECTED` / `LEAVE_SEAT_RELEASED`
* `LEAVE_SEAT_START` / `LEAVE_SEAT_END`
* `SLEEP_ENTERED` / `SLEEP_RESUMED`
* `EMERGENCY_UNLOCK_ATTEMPT` / `EMERGENCY_UNLOCK_SUCCESS` / `EMERGENCY_UNLOCK_FAILED` / `EMERGENCY_UNLOCK_LOCKED` / `EMERGENCY_UNLOCK_EXPIRED`
* `INSTALL_START` / `INSTALL_SUCCESS` / `INSTALL_FAIL` / `INSTALL_ROLLBACK` / `INSTALLER_REGISTRY_SYNC`
* `UNINSTALL_REQUEST` / `UNINSTALL_ATTEMPT` / `UNINSTALL_SUCCESS` / `UNINSTALL_FAIL`
* `KILL_REQUEST_CREATED` / `KILL_OTP_SENT` / `KILL_OTP_VERIFIED` / `KILL_OTP_FAILED` / `KILL_TOKEN_ISSUED` / `KILL_EXECUTED` / `KILL_REJECTED` / `KILL_ATTEMPT_BLOCKED`
* `SELF_HEAL_SUCCESS` / `SELF_HEAL_FAIL` / `ISOLATION_MODE_ENTERED`
* `LOCK_POLICY_DRAFT_SAVED` / `LOCK_POLICY_PUBLISHED` / `LOCK_POLICY_ROLLBACK`
* `TRAY_INFO_OPENED` / `TRAY_ATTENDANCE_REFRESHED` / `TRAY_MODE_CHANGED`
* `SCREEN_TYPE_BEFORE` / `SCREEN_TYPE_OFF` / `SCREEN_TYPE_USABLE` / `SCREEN_TRANSITION`
* `OFFLINE_GRACE_STARTED` / `OFFLINE_RETRY`
* `EMERGENCY_UNLOCK_EXPIRY_WARNING`

로그 코드 매핑은 `docs/operations/logcode.md`를 기준으로 한다.

---

## 8. Risks & Mitigation

| 리스크 | 설명 | 대응 |
|---|---|---|
| **R‑01** | 무확인 업데이트에 대한 사용자 반발 | 공지 및 채널 분리 배포 |
| **R‑02** | 비밀번호 검증 제외로 인한 보안 우려 | 감사 로그 강화, 이상행동 탐지 룰 추가 |
| **R‑03** | OS별 동작 차이 | 공통 인터페이스 계층 설계, OS별 회귀 테스트 세트 유지 |
| **R‑04** | 기능 누락 | As‑Is vs To‑Be 매트릭스 기반 추적, 시뮬레이터 회귀 테스트 |
| **R‑05** | Guard 우회 시도 | 무결성 체크, 탐지 로그, 관제 강화 |

---

## 9. Definition of Done (Product DoD)

* 핵심 기능 동등성 검증 완료 (MFC 시나리오와 결과 동일)
* Windows와 macOS 설치 및 실행 검증 완료
* 무확인 자동 업데이트 정책 검증 완료
* 비밀번호 변경 확인‑only 정책 검증 완료
* 시뮬레이터 기반 CI 리포트 확보
* Agent 삭제 방지, 무결성 확인, 자동 복구 트리거 검증 완료
* 중앙 서버 이상 상황 로그 수집 검증 완료
* 설치자 목록 등록 및 조회 기능 검증 완료
* 이석 감지·해제 플로우 (Idle/절전 기반) 검증 완료
* 이석정보 서버 전송 (START/END 세션 매핑) 검증 완료
* 시업/종업 화면 표시 로직 검증 완료
* 고객사 설정 반영 (문구·이미지·로고·긴급해제·이석해제 비밀번호) 검증 완료
* 긴급해제 (비밀번호 검증·시도제한·3시간 만료) 검증 완료
* 오프라인 복구·잠금 (30분 유예) 검증 완료
* 프로세스 Kill 통제·OTP 승인 플로우 검증 완료
* 트레이 작동정보 조회 기능 검증 완료
* 모든 문서와 코드 산출물이 Git에서 추적 가능