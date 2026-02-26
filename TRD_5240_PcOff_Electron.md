# TRD - 5240.PcOff 신규 제작 (Electron 전환)

## 0. Document Meta

| 항목 | 내용 |
|---|---|
| **Related PRD** | `docs/requirements/PRD_5240_PcOff_Electron.md` |
| **Stack** | Electron + TypeScript |
| **Target OS** | Windows, macOS |
| **Key Constraints** | Feature parity with legacy client, silent auto-update, simulator support in CI, Agent Guard mandatory |
| **Last Updated** | 2026-02-16 |

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
| **leave-seat-detector** | Idle/절전 기반 이석 감지, 이석 화면 트리거, 이석 시작/종료 이벤트 전송 |
| **offline-manager** | 오프라인 감지, 30분 유예, 오프라인 잠금, 복구 시도, 상태 저장 |
| **emergency-unlock** | 긴급해제 비밀번호 검증, 시도 제한, 3시간 만료 관리 |
| **tray-manager** | 시스템 트레이 메뉴, 작동정보 조회, 모드 실시간 갱신 |
| **tenant-policy** | 고객사 설정(문구·이미지·로고·정책) 캐시 및 동적 렌더링 |
| **kill-controller** | 프로세스 Kill 통제, OTP 검증 흐름, 감사 로그 |
| **installer-registry** | 설치자 정보 수집, 서버 등록, 조회 API 연동 |

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
* `getConnectivityState()`, `retryConnectivity()` — 오프라인 복구 (FR-17)
* `getLeaveSeatPolicy()`, `releaseLeaveSeat(reasonText)` — 이석 해제 (FR-11)
* `reportLeaveSeatEvent(eventType, payload)` — 이석 이벤트 전송 (FR-12)
* `requestEmergencyUnlock(password, reason)` — 긴급해제 (FR-15)
* `getTrayOperationInfo()`, `refreshMyAttendance()` — 트레이 작동정보 (FR-16)
* `getTenantLockPolicy()` — 고객사 설정 조회 (FR-14)
* `requestKillApproval()`, `submitKillOtp(otp)`, `executeKill(token)` — Kill 통제 (FR-18)

### 3.2 Main → Renderer events

* `onUpdateProgress(data)` — 업데이트 진행률 (FR-03)
* `onPasswordChangeDetected(data)` — 비밀번호 변경 감지 시 (FR-04)
* `onTamperDetected(event)` — Agent Guard 탐지 시 (FR-07)
* `onLeaveSeatDetected(payload)` — 이석 감지 시 (FR-11), payload: reason, detectedAt, leaveSeatTimeSec, observedSec
* `onConnectivityChanged(state)` — 오프라인/온라인 전환 시 (FR-17)
* `onModeChanged(mode)` — 모드 전환 시 (FR-16), mode: NORMAL, TEMP_EXTEND, EMERGENCY_USE, EMERGENCY_RELEASE
* `onEmergencyUnlockExpiring(remainingSec)` — 긴급해제 3시간 만료 예고 (FR-15)

IPC 메시지는 타입과 스키마를 정의하고 검증해야 한다.

---

## 4. Data Model (Local)

### 4.1 Local Storage Structure

* `config.json`: 설정
* `state.json`: 상태 정보(로그인 정보 등). 임시연장 복원용 `tempExtendUntil`(YYYYMMDDHH24MI), `lastWorkTimeSnapshot`(선택)
* `logs/YYYY-MM-DD.json`: 일자별 로그 파일
* `guard/integrity.json`: Agent Guard 무결성 기준선 (FR-07)
* `guard/watch-list.json`: (선택) Guard 감시 대상 파일 목록
* `update/retry-queue.json`: 업데이트 재시도 큐
* `offline-state.json`: 오프라인 상태 (offlineSince, deadline, locked) (FR-17)
* `leave-seat-queue.jsonl`: 이석 이벤트 재전송 큐 (FR-12)
* `tenant-policy-cache.json`: 고객사 설정 암호화 캐시 (FR-14)
* `emergency-unlock-state.json`: 긴급해제 상태 (startAt, expiresAt, retryCount, lockedUntil) (FR-15)

### 4.2 Core State Machine (High Level)

상태 머신은 다음과 같은 상위 상태를 가진다:

* `INIT`
* `LOGIN_REQUIRED`
* `AUTHENTICATED`
* `LOCKED` — 하위 상태: `LOCKED_BEFORE`(시업), `LOCKED_OFF`(종업), `LOCKED_LEAVE`(이석), `LOCKED_OFFLINE`(오프라인)
* `UNLOCK_PENDING_REASON`
* `TIMER_RUNNING`
* `ALERTING`
* `UPDATE_PENDING`
* `UPDATE_APPLYING`
* `OFFLINE_GRACE` — 30분 유예 (FR-17)
* `OFFLINE_LOCKED` — 오프라인 잠금 (FR-17)
* `LEAVE_SEAT_DETECTED` — 이석 감지 (FR-11)
* `EMERGENCY_UNLOCK_ACTIVE` — 긴급해제 활성 (FR-15)
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
node simulator run --scenario leave_seat_idle
node simulator run --scenario leave_seat_sleep
node simulator run --scenario offline_recovery_lock
node simulator run --scenario emergency_unlock
```

### 8.2 Scenario Mapping

| Flow | 시나리오 ID | 설명 |
|------|-------------|------|
| Flow-01 | `login_success` | 로그인 성공 |
| Flow-02 | `lock_reason_input` | 잠금 + 사유 입력 |
| Flow-03 | `update_success` | 무확인 자동 업데이트 |
| Flow-04 | `update_failure_retry` | 업데이트 실패·재시도 |
| Flow-05 | `password_change_confirm` | 비밀번호 변경 확인 |
| Flow-06 | `tamper_attempt` | Agent 삭제/우회 탐지 |
| Flow-07 | `offline_detected` | 오프라인/충돌 감지 |
| Flow-08 | `installer_registry_sync` | 설치자 레지스트리 동기화 |
| Flow-09 | `leave_seat_idle` | Idle 기반 이석 감지 |
| Flow-09 | `leave_seat_sleep` | 절전 기반 이석 감지 |
| Flow-10 | `leave_seat_event_report` | 이석 이벤트 서버 전송 |
| Flow-12 | `emergency_unlock` | 긴급해제 (비밀번호) |
| Flow-13 | `offline_recovery_lock` | 오프라인 30분 유예·잠금 |

---

## 9. Leave Seat Detection Architecture (FR-11)

### 9.1 Detection Methods

* **Idle-based**: `powerMonitor.getSystemIdleTime()` 5초 폴링, `leaveSeatTime` 분 초과 시 이석 감지
* **Sleep-based**: `powerMonitor.on("suspend")` 시 `sleepStartedAt` 기록, `resume` 시 경과시간 비교

### 9.2 Policy Source

`getPcOffWorkTime` 응답의 `leaveSeatUseYn`, `leaveSeatTime`, `leaveSeatReasonYn`, `leaveSeatReasonManYn` 필드.

### 9.3 State Variables

* `powerState.suspendAt` — 절전 진입 시각
* `leaveState.detectedAt` — 이석 감지 시각 (절전 시 `suspendAt` 사용)
* `leaveState.detectedReason` — `INACTIVITY` | `SLEEP_EXCEEDED`

### 9.4 UI Display

이석 화면에 이석감지시각(`leaveDetectedAt`) 표시. 절전 초과 시 절전 시작시각으로 표기.

### 9.5 적용 제외 조건 (PRD FR-11 정책)

로컬 이석 감지 시 아래인 경우 잠금 화면을 띄우지 않음:
* **이미 잠금(종업/시업 전)**: `resolveScreenType`이 off/before이면 이석(empty)으로 덮어쓰지 않음. `showLockForLocalLeaveSeat`에서 `isAlreadyLockedByWorkHours()`이면 return.
* **임시연장·긴급사용·긴급해제 중**: `currentMode`가 TEMP_EXTEND, EMERGENCY_USE, EMERGENCY_RELEASE이면 이석 잠금 미표시.
* **그 외(일반 해제 상태)**: 위가 아닐 때만 유휴/절전 초과 시 이석 잠금 표시.

---

## 10. Offline Recovery Lock Architecture (FR-17)

### 10.1 Detection

* Heartbeat 3회 연속 실패 또는 핵심 API 네트워크 오류 2회 연속 시 `OFFLINE_DETECTED`

### 10.2 Grace Period

* 30분 유예 (`OFFLINE_GRACE` 상태)
* UI: 경과 시간(mm:ss/30:00), 재시도 버튼, 네트워크 설정 안내

### 10.3 Lock Transition

* 30분 내 미복구 시 `OFFLINE_LOCKED` 상태
* PC-ON/임시연장/긴급사용 차단
* 온라인 복구 시 재인증 후 해제 가능

### 10.4 Persistence

`offline-state.json`에 상태 저장, 앱 재시작 시에도 잠금 유지

---

## 11. Emergency Unlock Architecture (FR-15)

### 11.1 Exposure Condition

`emergencyUnlockUseYn=YES` && `emergencyUnlockPasswordSetYn=Y` && 잠금 상태

### 11.2 Verification Flow

1. 비밀번호 입력
2. `POST /callPcOffEmergencyUnlock.do` 서버 검증
3. 성공 시 잠금 해제, `emergencyUnlockStartAt` 기록
4. 실패 시 남은 횟수 표시

### 11.3 Retry Limit

`policy.maxFailures`(기본 5회) 초과 시 `policy.lockoutSeconds`(기본 300초) 차단 (`lockedUntil` 저장)

### 11.4 Expiration

3시간 경과 시 조건 기반 잠금화면 자동 복귀, 5분 전 예고 알림 (`onEmergencyUnlockExpiring`)

### 11.5 API

* **Request**: `POST /callPcOffEmergencyUnlock.do`
* **Payload**: `{ password, reason, deviceId, userStaffId }`
* **Response**: `{ success, remainingAttempts, lockoutUntil?, message }`

### 11.6 Audit Events

`EMERGENCY_UNLOCK_ATTEMPT`, `EMERGENCY_UNLOCK_SUCCESS`, `EMERGENCY_UNLOCK_FAILED`, `EMERGENCY_UNLOCK_LOCKED`, `EMERGENCY_UNLOCK_EXPIRED`, `EMERGENCY_UNLOCK_EXPIRY_WARNING`

---

## 12. Tenant Lock Policy Architecture (FR-14)

### 12.1 Policy Model

```typescript
interface TenantLockPolicy {
  lockScreen: {
    screens: {
      before: { title: string; message: string; imageAssetId?: string };
      leave: { title: string; message: string; imageAssetId?: string };
      off: { title: string; message: string; imageAssetId?: string };
    };
    logoAssetId?: string;
  };
  unlockPolicy: {
    emergencyUnlockEnabled: boolean;
    emergencyUnlockPassword?: {
      minLength: number;
      requireComplexity: boolean;
      maxFailures: number;
      lockoutSeconds: number;
      expiresInDays: number;
    };
    leaveSeatUnlockRequirePassword: boolean;
  };
  version: number;
  publishedAt: string;
}
```

### 12.2 Admin Console Workflow

* **Draft 저장**: 미리보기/저장, 즉시 적용 안 됨
* **Publish**: 승인 후 에이전트 배포 (버전 증가, rolloutPolicy 적용)
* **Rollback**: 이전 정상 버전으로 즉시 복원
* **권한 모델**: VIEWER(읽기), EDITOR(초안), APPROVER(게시), ADMIN(전체)

### 12.3 Policy Distribution (Hybrid)

* **Push**: 정책 게시 시 서버→에이전트 WebSocket 알림 또는 Long-Polling, TTL 30분 이내 갱신
* **Periodic Polling**: 30분 주기 폴링 백업, 버전 비교 후 변경 시 다운로드

### 12.4 Cache Strategy

마지막 정상 정책 로컬 암호화 캐시, TTL 24h, 오프라인 시 캐시 사용

### 12.5 Audit Events

* `LOCK_POLICY_DRAFT_SAVED`, `LOCK_POLICY_PUBLISHED`, `LOCK_POLICY_ROLLBACK`

---

## 13. Tray Manager Architecture (FR-16)

### 13.1 Menu Items

* `PCOFF 열기`
* `PCOFF 작동정보` (신규)
* `로그 보기`
* `종료`

### 13.2 Operation Info Panel

* 현재 반영 근태정보 (기준 시각, 적용 정책)
* 나의 근태정보 (수동 새로고침)
* 현재 모드: `NORMAL`, `TEMP_EXTEND`, `EMERGENCY_USE`, `EMERGENCY_RELEASE`
* 버전정보: App Version, Agent/Core Version

### 13.3 Real-time Updates

`onModeChanged` 이벤트로 모드 전환 시 UI 즉시 갱신

---

## 14. Process Kill Control Architecture (FR-18)

### 14.1 OS-level Protection

* **Windows**: LocalSystem 서비스, DACL로 `PROCESS_TERMINATE` 미부여, Recovery + Watchdog
* **Linux**: root/systemd, `ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes`, `CapabilityBoundingSet=`, `Restart=always`, systemd watchdog(`WatchdogSec=30`)
* **macOS**: LaunchDaemon(root), root:wheel 소유권, KeepAlive, (선택) EndpointSecurity

### 14.2 Kill Sequence

1. `POST /kill-requests` — `KillRequest` 등록, 관리자에게 OTP 발송
2. `POST /kill-requests/{id}/verify-otp` — 관리자 OTP 입력, 성공 시 `KillToken`(JWT/PASETO, TTL 2분) 발급
3. `POST /kill-execute` — Bearer KillToken 헤더, Process Fingerprint 검증 후 종료

### 14.3 Process Fingerprint

```typescript
interface ProcessFingerprint {
  pid: number;
  createdAt: string;  // ISO8601
  exePath: string;
  cmdLine: string;
  hash: string;  // SHA-256 of exePath
}
```

PID 재사용 공격 방지를 위해 fingerprint 전체 검증

### 14.4 OTP/Token Policy

* OTP 재시도 제한: 3회, 초과 시 30분 차단
* KillToken TTL: 2분
* 관리자 권한: `admin:kill` 권한 보유 사용자만 OTP 발급 가능

### 14.5 Communication Security

* mTLS (터미널 인증서 pinning)
* API Gateway rate-limit

### 14.6 Audit Logging

`KILL_REQUEST_CREATED`, `KILL_OTP_SENT`, `KILL_OTP_VERIFIED`, `KILL_OTP_FAILED`, `KILL_TOKEN_ISSUED`, `KILL_EXECUTED`, `KILL_REJECTED`, `KILL_ATTEMPT_BLOCKED` 100% 기록

---

## 15. Install/Uninstall Architecture (FR-19)

### 15.1 Install Policy

* **설치 전**: 환경 점검(OS 버전/디스크 여유/네트워크 연결/관리자 권한), 중복 설치 탐지
* **설치 중**: 파일 배치, Windows(서비스/작업스케줄러/ACL)·macOS(LaunchDaemon), 해시 기준선(SHA-256) 생성
* **설치 후**: 초기 heartbeat, 실패 시 롤백/제한 모드

### 15.2 Minimum Privilege Installer

불필요한 시스템 변경 최소화, 관리자 권한 요청 범위 명확히 문서화

### 15.3 Uninstall Policy

* 일반 사용자 임의 삭제 금지
* 삭제는 관리자 승인 또는 정책 토큰(1회용)으로만 허용
* 언인스톨 시 잔여 파일/레지스트리 정리, 로컬 로그 아카이브

### 15.4 Recovery Strategy

탐지 → 자동 복구(재설치/파일 복원) → 복구 실패 시 격리 모드 + 운영팀 알림

### 15.5 Audit Events

`INSTALL_START`, `INSTALL_SUCCESS`, `INSTALL_FAIL`, `INSTALL_ROLLBACK`, `INSTALLER_REGISTRY_SYNC`, `UNINSTALL_REQUEST`, `UNINSTALL_ATTEMPT`, `UNINSTALL_SUCCESS`, `UNINSTALL_FAIL`, `SELF_HEAL_SUCCESS`, `SELF_HEAL_FAIL`, `ISOLATION_MODE_ENTERED`

---

## 16. Leave Seat Event Reporting Architecture (FR-12)

### 16.1 API

* **Endpoint**: `POST /reportLeaveSeatEvent.do`
* **Request**: `eventType`(LEAVE_SEAT_START/END), `workSessionType`, `leaveSeatSessionId`, `workSessionId`, `reason`, `reasonRequired`, `occurredAt`, `clientVersion`
* **Response**: `code`, `message`, `accepted`, `eventId`, `serverReceivedAt`

### 16.2 Data Model

```typescript
interface LeaveSeatEvent {
  eventId: string;
  leaveSeatSessionId: string;
  workSessionId?: string;
  eventType: 'LEAVE_SEAT_START' | 'LEAVE_SEAT_END';
  occurredAt: string;
  workYmd: string;
  userServareaId: string;
  userStaffId: string;
  deviceId: string;
  workSessionType: 'NORMAL' | 'TEMP_EXTEND' | 'EMERGENCY_USE';
  reason?: string;
  transmitStatus: 'PENDING' | 'SENT' | 'FAILED';
  retryCount: number;
}
```

### 16.3 Retry Strategy

네트워크 실패 시 로컬 큐(JSONL) 적재 + 지수 백오프(10s → 30s → 60s → 5m → 15m), 최대 재시도 초과 시 `FAILED` + Ops Observer 경고

### 16.4 Security/Privacy

* reason 길이 제한(200자), 제어문자 제거
* 로그 출력 시 reason 원문 마스킹 옵션
* HTTPS/TLS 필수

### 16.5 Operations Metrics

* START/END 수, START 대비 END 누락 비율
* 평균 이석 시간
* 전송 실패율/재시도 성공률
* 특정 단말 반복 실패 알람

---

## 17. Screen Display Logic Architecture (FR-13)

### 17.1 Decision Points

1. PC-ON 예외: `isPcOn && now >= pcOnAllowedAt` → 시업화면 없이 즉시 사용
2. 종업/연장 경계 계산: 종업시각 당일/익일, 임시연장 허용시간 당일/익일 조합
3. 화면 결정: `now >= workEndAt && now < startScreenBoundary` → 종업화면, `now >= startScreenBoundary` → 시업화면

### 17.2 State Machine Integration

* `SCREEN_TYPE_DETERMINED` 상태 전이 시 화면 결정
* 타이머 기반 자동 전환: 종업시각/시업시각 도달 시 자동 화면 전환

### 17.3 Edge Cases

* `tempExtendExhausted` 반영 (임시연장 소진 시 즉시 종업화면)
* 경계값 포함/제외 고정(`>=`)
* 타임존 일치 필수 (서버-클라이언트 UTC 동기화)

### 17.4 Audit Events

`SCREEN_TYPE_BEFORE`, `SCREEN_TYPE_OFF`, `SCREEN_TYPE_USABLE`, `SCREEN_TRANSITION`

---

## 18. Windows Defender/SmartScreen Strategy

### 18.1 Code Signing

* Authenticode 적용(가능 시 EV Code Signing)
* 타임스탬프 서버: `http://timestamp.digicert.com`
* CI 게이트: `signtool verify /pa /v <file>`
* macOS: notarization 필수

### 18.2 SmartScreen Reputation

제품명/회사명/서명자·배포 URL·파일명 일관 유지, 동일 인증서 지속 사용

### 18.3 Update Integrity

* 아티팩트 서명 + SHA-256
* 실패 원인 구분 로깅: `UPDATE_SIGNATURE_INVALID`, `UPDATE_HASH_MISMATCH`, `UPDATE_NETWORK_ERROR`

### 18.4 False Positive Response

* Microsoft: https://www.microsoft.com/wdsi/filesubmission
* 릴리즈마다 해시·서명·탐지 로그 아카이빙

### 18.5 Release Checklist

* 릴리즈 전: 인증서 유효성, 빌드 재현성, 보안 점검
* 릴리즈 중: 서명 → 검증 → SHA-256 → 매니페스트 업로드
* 릴리즈 후: SmartScreen 경고 모니터링, 오탐 즉시 제출