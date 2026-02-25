# Kill 통제 Phase 1 (FR-18)

사용자 임의 종료 차단, Kill은 관리자 OTP 검증 후에만 허용하는 Phase 1 설계·체크리스트입니다.

**에이전트(클라이언트) 담당 항목은 모두 완료됨.** 백엔드·OS/인프라 구현 후 연동하면 됨.

---

## 1. 원칙

- 사용자 임의 종료 차단: 표준 권한에서 taskkill/kill로 프로세스 종료 불가
- Kill 허용: 관리자 OTP 검증 후에만 종료 허용
- 감사 로그: 요청·OTP 발송·검증·실행·거부 전 과정 100% 기록
- Windows / Linux / macOS 동일 모델

---

## 2. Kill 시퀀스

1. **KillRequest 등록** — `POST /kill-requests` (요청 생성, 관리자 OTP 발송 트리거)
2. **관리자 OTP 입력** — 대시보드/관리 도구에서 OTP 입력
3. **OTP 검증·KillToken 발급** — `POST /kill-requests/{id}/verify-otp` (성공 시 JWT/PASETO, TTL 2분)
4. **kill-execute** — `POST /kill-execute` (Bearer KillToken + Process Fingerprint), 서버 검증 후 에이전트 종료

- OTP 재시도: 3회 초과 시 30분 차단
- 관리자 인가: `admin:kill` 권한 보유 사용자만 OTP 발급 가능

---

## 3. API 스펙 (백엔드 구현 대상)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /kill-requests | KillRequest 등록, 관리자 OTP 발송 |
| POST | /kill-requests/{id}/verify-otp | OTP 검증, 성공 시 KillToken 반환 (TTL 2분) |
| POST | /kill-execute | Body: Process Fingerprint. Header: Authorization: Bearer {KillToken}. 검증 후 200 시 에이전트가 자체 종료 |

**Process Fingerprint** (PID 재사용 공격 방지): `{ pid, createdAt, exePath, cmdLine, hash(exePath) }`

---

## 3.1 백엔드에 전달할 내용 (요청/응답 규격)

에이전트가 호출할 API이므로, 백엔드는 아래 규격으로 구현하면 됨.

### POST /kill-requests

| 구분 | 내용 |
|------|------|
| **목적** | Kill 요청 등록, 관리자에게 OTP 발송 트리거 |
| **에이전트 → 백엔드 (Body)** | `deviceId`(선택), `userStaffId`(선택), `reason`(선택). 기타 필요한 식별자(서비스영역·세션 등)는 기존 인증/헤더로 통일 가능. |
| **백엔드 동작** | 요청 저장, 관리자(admin:kill 권한)에게 OTP 발송. OTP 재시도 3회 초과 시 30분 차단. |
| **응답** | `{ id: string, message?: string }` — `id`는 이후 verify-otp·대시보드에서 사용. |

### POST /kill-requests/{id}/verify-otp

| 구분 | 내용 |
|------|------|
| **목적** | 관리자가 입력한 OTP 검증, 성공 시 KillToken 발급 |
| **에이전트 → 백엔드** | Path: `id`(kill-requests에서 받은 id). Body: `otp`(string). |
| **백엔드 동작** | OTP 일치 시 JWT/PASETO 형태의 KillToken 발급, TTL 2분. 3회 초과 실패 시 30분 차단 후 `KILL_ATTEMPT_BLOCKED`에 해당하는 오류 반환. |
| **응답** | `{ token: string, expiresAt?: string }` — 에이전트는 이 token을 kill-execute 호출 시 Authorization 헤더에 사용. |

### POST /kill-execute

| 구분 | 내용 |
|------|------|
| **목적** | KillToken + Process Fingerprint 검증 후, 해당 프로세스 Kill 허용 여부 반환 |
| **에이전트 → 백엔드** | Header: `Authorization: Bearer {KillToken}`. Body: **Process Fingerprint** (아래 필드). |
| **Process Fingerprint (Body)** | `pid`(number), `createdAt`(string, ISO8601), `exePath`(string), `cmdLine`(string, 선택), `exeHash`(string, 선택, exePath 파일 SHA-256). PID 재사용 공격 방지용. |
| **백엔드 동작** | 토큰 유효성·만료 검사, 필요 시 fingerprint와 요청 시점 정보 대조. 검증 성공 시 200 + `{ allowed: true }`. 실패 시 4xx + `{ allowed: false }` 또는 오류 메시지. |
| **응답** | `{ allowed: boolean }` — 에이전트는 `allowed === true`일 때만 `app.quit()` 호출. |

### 정책·공통

- **관리자 인가**: OTP 발급·검증은 `admin:kill` 권한 보유 사용자만 가능. 요청 내역은 대시보드에 노출.
- **OTP**: 3회 초과 실패 시 30분 차단.
- **KillToken TTL**: 2분 엄수. 만료 후에는 kill-execute 호출 시 401/403 등으로 거부.

---

## 4. 로그 코드 (에이전트 구현 완료)

`app/core/constants.ts` 및 `docs/operations/logcode.md`에 반영됨.

| Log Code | 설명 |
|----------|------|
| KILL_REQUEST_CREATED | Kill 요청 등록 |
| KILL_OTP_SENT | Kill OTP 발송(관리자) |
| KILL_OTP_VERIFIED | OTP 검증 성공, KillToken 발급 |
| KILL_OTP_FAILED | OTP 검증 실패 |
| KILL_TOKEN_ISSUED | Kill 토큰 발급 |
| KILL_EXECUTED | Kill 실행(토큰 검증 후 종료) |
| KILL_REJECTED | Kill 거부(토큰 만료/무효) |
| KILL_ATTEMPT_BLOCKED | Kill 시도 차단(OTP 3회 초과 등) |

---

## 5. Phase 1 체크리스트

### 5.1 에이전트(클라이언트) 담당

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1 | 로그 코드 상수·logcode.md 동기화 | ✅ | constants.ts, logcode.md |
| 2 | Kill API 타입·스텁 (createKillRequest, verifyKillOtp, killExecute) | ✅ | api-client 또는 전용 모듈, 서버 미구현 시 미호출/스텁 |
| 3 | Process Fingerprint 수집 유틸 (pid, exePath, cmdLine, hash) | ✅ | `app/core/kill-fingerprint.ts` — `getProcessFingerprint()` |
| 4 | kill-execute 성공 시 앱 종료 (quit) 연동 | ✅ | `app/core/kill-control.ts` — `executeKillWithToken()` 내에서 `result.allowed` 시 `appQuit()` 호출 |
| 5 | 감사 로그 기록 (KILL_* 이벤트 JSONL) | ✅ | `requestKillWithLog` / `verifyKillOtpWithLog` / `executeKillWithToken` 에서 각 단계별 `logger.write(LOG_CODES.KILL_*)` |

### 5.2 백엔드 담당

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1 | POST /kill-requests 구현 | ⬜ | 요청 저장, 관리자 OTP 발송 |
| 2 | POST /kill-requests/{id}/verify-otp 구현 | ⬜ | 3회 초과 시 30분 차단, 성공 시 KillToken(JWT/PASETO, TTL 2분) 발급 |
| 3 | POST /kill-execute 구현 | ⬜ | Bearer 토큰 검증, Process Fingerprint 검증 후 200 반환 |
| 4 | 관리자 권한 admin:kill · 대시보드 노출 | ⬜ | |

### 5.3 OS·인프라 담당

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| 1 | **Windows**: LocalSystem 서비스, DACL(PROCESS_TERMINATE 미부여), Recovery + Watchdog | ⬜ | 에이전트 프로세스를 서비스 자식으로 실행 시 사용자 kill 차단 |
| 2 | **Linux**: systemd 유닛 (ProtectSystem=strict, ProtectHome=yes, NoNewPrivileges=yes, Restart=always), WatchdogSec=30 | ⬜ | 유닛 템플릿 제공 |
| 3 | **macOS**: LaunchDaemon(root), root:wheel 소유·일반 사용자 write 금지, KeepAlive | ⬜ | plist 확정 |

**감사 로그·quit 연동 (구현 시)**  
- `createKillRequest` 호출 직후: `logger.write(LOG_CODES.KILL_REQUEST_CREATED, ...)`  
- `verifyKillOtp` 성공 시: `KILL_OTP_VERIFIED` / `KILL_TOKEN_ISSUED`, 실패 시: `KILL_OTP_FAILED` / `KILL_ATTEMPT_BLOCKED`  
- `killExecute` 호출 전 fingerprint 전달, 서버 200 수신 시: `logger.write(LOG_CODES.KILL_EXECUTED)` 후 `app.quit()`  
- 토큰 만료/무효 시: `KILL_REJECTED`

---

## 6. 통신 보안 (권고)

- mTLS 또는 터미널 인증서 pinning
- API Gateway rate-limit
- KillToken TTL 2분 엄수

---

## 7. 참고

- `docs/다음_개발_진행_사항.md` §9 Kill 통제
- PRD/TRD FR-18
- Kill 통제·OTP 보고서 (별도 문서)

---

## 8. 에이전트 구현 완료 여부

| 구분 | 상태 |
|------|------|
| **에이전트(클라이언트)** | **완료** — 로그 코드, API 타입·스텁, Process Fingerprint 수집, 연동 레이어(감사 로그·quit)까지 구현됨. 백엔드 API 구현 후 api-client의 `createKillRequest` / `verifyKillOtp` / `killExecute`만 실제 HTTP로 교체하면 연동 가능. |
| **백엔드** | 미구현 — §3·§3.1 규격으로 구현 필요. |
| **OS·인프라** | 미구현 — Service/Daemon 권한 분리, 사용자 kill 차단 등. |
