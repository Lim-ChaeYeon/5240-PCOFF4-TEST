# TRD - 5240.PcOff 신규 제작 (Electron 전환)

## 0. Document Meta

| 항목 | 내용 |
|---|---|
| **Related PRD** | `docs/requirements/PRD_5240_PcOff_Electron.md` |
| **Stack** | Electron + TypeScript |
| **Target OS** | Windows, macOS |
| **Key Constraints** | Feature parity with legacy client, silent auto-update, simulator support in CI, Agent Guard mandatory |

본 문서는 PRD에 정의된 요구사항을 충족하기 위한 기술적 구현 방안을 제시한다. 아키텍처, 모듈 책임, IPC, 데이터 모델, 로그, 업데이트 전략, 보안, CI/CD 설계를 포함한다.

---

## 1. Architecture Overview

Electron 앱은 Main Process와 Renderer Process의 분리된 프로세스 모델을 사용한다. Preload Bridge를 통해 보안 경계를 유지하며 Service Layer는 도메인 로직을 담당한다.

### 1.1 Process Model

#### Main Process

* 애플리케이션 lifecycle 제어
* update-manager 실행 및 업데이트 적용
* OS 통합 처리 (트레이, 알림, 서비스/권한 관리)
* 로컬 저장소 및 파일 무결성 확인

#### Renderer Process

* UI 및 사용자 흐름 구현
* 상태 머신 기반 화면 전환 처리

#### Preload Bridge

* `contextIsolation`을 유지하며 Renderer에서 필요한 최소 API만 노출

#### Service Layer (Core Domain)

* `feature-core`: 업무 규칙과 상태 머신 구현
* `auth-policy`: 비밀번호 정책 처리
* `telemetry-log`: 로깅 및 이벤트 전송
* `simulator-hook`: 시뮬레이터 입력/출력 처리

---

## 2. Module Responsibilities

| 모듈 | 역할 |
|---|---|
| **app-shell** | 창 생성 및 관리, 트레이, 알림, 시스템 idle/lock hook |
| **update-manager** | 업데이트 확인, 백그라운드 다운로드, 무결성 검증, 무확인 적용, 롤백/재시도 처리 |
| **auth-policy** | 비밀번호 변경 이벤트 감지, 확인 UI, 비밀번호 검증 생략, 정책 적용 로그 |
| **feature-core** | 로그인/잠금/사유입력/타이머/알림 등 업무 규칙, 상태 머신 구현 |
| **simulator** | CLI 기반 시뮬레이터 엔진, 입력 파라미터를 받아 상태 머신 실행 및 결과 리포팅 |
| **telemetry-log** | JSONL 구조의 로컬 로깅, 서버로 이벤트 배치 업로드 |
| **agent-guard** | 파일 무결성 확인, 삭제 시도 탐지, 자동 복구 트리거, OS별 하드닝 로직 |
| **ops-observer** | 상태 heartbeat, 충돌/통신두절 탐지, 설치자 레지스트리 동기화 |

---

## 3. IPC / API Design

### 3.1 Renderer → Main (via preload)

* `getAppState()` — 상태 머신 스냅샷
* `getCurrentUser()` — 로그인 사용자 표시 정보(loginUserNm, posNm, corpNm 등)
* `hasLogin()` — 로그인 여부
* `getServareaInfo(userMobileNo)` — 서비스 영역 목록 조회
* `login(payload)` — 로그인
* `logout()` — 로그아웃
* `getWorkTime()` — 근태정보(getPcOffWorkTime)
* `requestPcExtend(pcOffYmdTime?)` — 임시연장
* `requestEmergencyUse(reason)` — 긴급사용
* `requestPcOnOffLog(tmckButnCd, eventName?, reason?)` — PC-ON/PC-OFF
* `getPasswordChangeState()` — 비밀번호 변경 감지 상태 (FR-04)
* `confirmPasswordChange()` — 비밀번호 변경 확인 (검증 없음)
* `requestUpdateCheck()`, `getUpdateStatus()`, `getAppVersion()` — 업데이트 (FR-03)
* `getGuardStatus()`, `getGuardTamperEvents()`, `verifyIntegrity()` — Agent Guard (FR-07)

### 3.2 Main → Renderer events

* `onUpdateProgress(data)` — 업데이트 진행률 (FR-03)
* `onPasswordChangeDetected(data)` — 비밀번호 변경 감지 시 (FR-04)
* `onTamperDetected(event)` — Agent Guard 탐지 시 (FR-07)

IPC 메시지는 타입과 스키마를 정의하고 검증해야 한다.

---

## 4. Data Model (Local)

### 4.1 Local Storage Structure

* `config.json`: 설정
* `state.json`: 상태 정보(로그인 정보 등)
* `logs/YYYY-MM-DD.jsonl`: 일자별 로그 파일
* `guard/integrity.json`: Agent Guard 무결성 기준선 (FR-07)
* `guard/watch-list.json`: (선택) Guard 감시 대상 파일 목록
* `update/retry-queue.json`: 업데이트 재시도 큐

### 4.2 Core State Machine (High Level)

상태 머신은 다음과 같은 상위 상태를 가진다:

* `INIT`
* `LOGIN_REQUIRED`
* `AUTHENTICATED`
* `LOCKED`
* `UNLOCK_PENDING_REASON`
* `TIMER_RUNNING`
* `ALERTING`
* `UPDATE_PENDING`
* `UPDATE_APPLYING`
* `ERROR_STATE`

---

## 5. Logging Specification (Technical)

### 5.1 Local Log Format

로그는 JSON Lines(JSONL) 형식을 사용한다. 각 로그 항목에는 다음 필드가 포함된다:

* `timestamp` (ISO8601)
* `logCode`
* `level`
* `sessionId`
* `deviceId`
* `userId` (가능한 경우)
* `payload` (객체)

### 5.2 Remote Observer Log

`ops-observer`는 로그를 배치 업로드하며 네트워크 오류 시 지수적 backoff 기반 재시도를 수행한다.

---

## 6. Update Strategy

### 6.1 Requirements

* UI 프롬프트 없이 업데이트를 수행한다.
* 백그라운드에서 다운로드하며 완료 후 자동 적용한다.
* 무결성(hash/signature) 확인을 수행한다.
* 실패 시 롤백 또는 재시도 큐에 등록한다.

### 6.2 Failure Modes

* 네트워크 오류 → 재시도 큐 등록
* 패키지 손상 → 업데이트 취소 후 기존 버전 유지
* 적용 실패 → 롤백 + 이벤트 보고

---

## 7. Agent Guard Strategy

### 7.1 Protection Goals

* 표준 사용자 권한으로는 Agent를 삭제하거나 비활성화할 수 없어야 한다.
* Tamper 시도를 탐지하여 자동 복구를 트리거해야 한다.

### 7.2 Windows Considerations

* 서비스 기반 지속성 유지
* 파일 ACL(Access Control List) 설정 강화
* 스케줄된 작업(Watchdog) 등을 활용한 복구

### 7.3 macOS Considerations

* LaunchDaemon 기반 서비스 유지
* 권한/소유권 설정 강화
* App notarization 및 code signing 준수

### 7.4 Integrity Checks

* 바이너리 해시 비교
* 중요 파일 리스트 모니터링
* 예상치 않은 프로세스 종료 탐지

---

## 8. Simulator Design

### 8.1 CLI Interface

```bash
node simulator run --scenario update_success
node simulator run --scenario password_change_confirm
node simulator run --scenario tamper_attempt