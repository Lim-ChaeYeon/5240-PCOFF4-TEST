# Log Code Mapping

Electron 앱에서 사용하는 로그 코드 매핑.  
레거시 `5240.PcOff-master/docs/logcode.md`와 동기화하며, `app/core/constants.ts`의 `LOG_CODES`와 일치시킨다.

**Last Updated**: 2026-02-20

---

## 기본 이벤트

| Log Code | Description | 비고 |
|----------|-------------|------|
| APP_START | 애플리케이션 시작 | |
| LOGIN_SUCCESS | 로그인 성공 | |
| LOGIN_FAIL | 로그인 실패 | |
| LOGOUT | 로그아웃 | |
| LOCK_TRIGGERED | 잠금 트리거 (임시연장·이석 등) | |
| UNLOCK_TRIGGERED | 잠금 해제 트리거 (긴급사용 등) | |

---

## 업데이트 (FR-03)

| Log Code | Description | 비고 |
|----------|-------------|------|
| UPDATE_FOUND | 업데이트 감지 | |
| UPDATE_DOWNLOADED | 업데이트 다운로드 완료 | |
| UPDATE_APPLIED | 업데이트 적용 완료 | |
| UPDATE_FAILED | 업데이트 실패 | |

---

## 비밀번호 변경 (FR-04)

| Log Code | Description | 비고 |
|----------|-------------|------|
| PASSWORD_CHANGE_DETECTED | 비밀번호 변경 감지 | getPcOffWorkTime pwdChgYn=Y |
| PASSWORD_CONFIRM_DONE | 비밀번호 확인 완료 (검증 생략) | |

---

## Agent Guard (FR-07)

| Log Code | Description | 비고 |
|----------|-------------|------|
| AGENT_TAMPER_DETECTED | 에이전트 변조/삭제/우회 탐지 | |
| AGENT_TAMPER_ATTEMPT | 탬퍼 시도 이벤트 | |
| AGENT_RECOVERED | 에이전트 복구 트리거 완료 | |
| AGENT_RECOVERY_FAILED | 에이전트 복구 실패 | |
| AGENT_STOP_ATTEMPT | 프로세스 Kill 시도 감지 | |

---

## Ops Observer (FR-08)

| Log Code | Description | 비고 |
|----------|-------------|------|
| CRASH_DETECTED | 비정상 종료 감지 | |
| OFFLINE_DETECTED | 통신 두절 감지 | |
| HEARTBEAT | Ops Observer heartbeat | |

---

## 설치자 레지스트리 (FR-09, FR-19)

| Log Code | Description | 비고 |
|----------|-------------|------|
| INSTALL_START | 설치 시작 | |
| INSTALL_SUCCESS | 설치 성공 | |
| INSTALL_FAIL | 설치 실패 | |
| INSTALL_ROLLBACK | 설치 롤백 | 실패 시 이전 상태 복원 |
| INSTALLER_REGISTRY_SYNC | 설치자 레지스트리 동기화 | |
| INSTALLER_REGISTRY_FAIL | 설치자 레지스트리 동기화 실패 | |
| UNINSTALL_REQUEST | 언인스톨 요청 | |
| UNINSTALL_ATTEMPT | 언인스톨 시도 탐지 | 임의 삭제 시도 |
| UNINSTALL_SUCCESS | 언인스톨 성공 | |
| UNINSTALL_FAIL | 언인스톨 실패 | |
| SELF_HEAL_SUCCESS | 자동 복구 성공 | |
| SELF_HEAL_FAIL | 자동 복구 실패 | |
| ISOLATION_MODE_ENTERED | 격리 모드 진입 | 복구 실패 시 |

---

## 이석 감지 (FR-11)

| Log Code | Description | 비고 |
|----------|-------------|------|
| LEAVE_SEAT_DETECTED | 이석 감지(화면 로드 시) | screenType=empty 시 잠금화면 진입 |
| LEAVE_SEAT_UNLOCK | 이석 해제(PC-ON) | PC-ON 성공 시 |
| LEAVE_SEAT_REASON_SUBMITTED | 이석 사유 입력 완료 | 사유 필수 시 모달에서 제출 |
| LEAVE_SEAT_BREAK_EXEMPT | 휴게시간 이석 면제 | breakStartTime~breakEndTime 내 PC-ON |
| LEAVE_SEAT_IDLE_DETECTED | Idle 기반 이석 감지 | powerMonitor.getSystemIdleTime() 초과(로컬) |
| LEAVE_SEAT_SLEEP_DETECTED | 절전 기반 이석 감지 | resume 시 절전 경과시간 >= 이석시간(로컬) |
| LEAVE_SEAT_RESUME_CHECKED | 절전 복귀 시 이석 체크 | |
| LEAVE_SEAT_RELEASED | 로컬 이석 해제 | 로컬 이석 감지 후 PC-ON 성공 시 |
| SLEEP_ENTERED | 절전모드 진입 | powerMonitor.on("suspend") |
| SLEEP_RESUMED | 절전모드 복귀 | powerMonitor.on("resume") |

---

## 이석정보 서버 전송 (FR-12)

| Log Code | Description | 비고 |
|----------|-------------|------|
| LEAVE_SEAT_START | 이석 시작 서버 전송 | leaveSeatSessionId로 매핑 |
| LEAVE_SEAT_END | 이석 종료 서버 전송 | 동일 세션ID |
| LEAVE_SEAT_REPORT_FAILED | 이석 이벤트 전송 실패 | 재시도 큐 적재 |
| LEAVE_SEAT_REPORT_RETRY | 이석 이벤트 재전송 | |

---

## 긴급해제 (FR-15)

| Log Code | Description | 비고 |
|----------|-------------|------|
| EMERGENCY_UNLOCK_ATTEMPT | 긴급해제 시도 | 비밀번호 입력 |
| EMERGENCY_UNLOCK_SUCCESS | 긴급해제 성공 | 잠금 해제 |
| EMERGENCY_UNLOCK_FAILED | 긴급해제 실패 | 비밀번호 불일치 |
| EMERGENCY_UNLOCK_LOCKED | 긴급해제 잠금 | 5회 초과 → 5분 차단 |
| EMERGENCY_UNLOCK_EXPIRED | 긴급해제 만료 | 3시간 후 재잠금 |
| EMERGENCY_UNLOCK_EXPIRY_WARNING | 긴급해제 만료 예고 | 5분 전 알림 |

---

## 오프라인 복구·잠금 (FR-17)

| Log Code | Description | 비고 |
|----------|-------------|------|
| OFFLINE_GRACE_STARTED | 오프라인 유예 시작 | 30분 카운트다운 |
| OFFLINE_RETRY | 오프라인 복구 재시도 | |
| OFFLINE_RECOVERED | 오프라인 복구 성공 | |
| OFFLINE_TIMEOUT_LOCK | 오프라인 30분 유예 만료 → 잠금 | |

---

## 프로세스 Kill 통제 (FR-18)

| Log Code | Description | 비고 |
|----------|-------------|------|
| KILL_REQUEST_CREATED | Kill 요청 등록 | |
| KILL_OTP_SENT | Kill OTP 발송 | 관리자에게 |
| KILL_OTP_VERIFIED | Kill OTP 검증 성공 | KillToken 발급 |
| KILL_OTP_FAILED | Kill OTP 검증 실패 | |
| KILL_TOKEN_ISSUED | Kill 토큰 발급 | JWT/PASETO, TTL 2분 |
| KILL_EXECUTED | Kill 실행 | 토큰 검증 후 종료 |
| KILL_REJECTED | Kill 거부 | 토큰 만료/무효 |
| KILL_ATTEMPT_BLOCKED | Kill 시도 차단 | OTP 3회 초과 등 |

---

## 트레이 작동정보 (FR-16)

| Log Code | Description | 비고 |
|----------|-------------|------|
| TRAY_INFO_OPENED | 트레이 작동정보 열기 | |
| TRAY_ATTENDANCE_REFRESHED | 근태정보 새로고침 | |
| TRAY_MODE_CHANGED | 트레이 모드 변경 표시 | NORMAL/TEMP_EXTEND/EMERGENCY_USE/EMERGENCY_RELEASE |

---

## 고객사 설정 (FR-14)

| Log Code | Description | 비고 |
|----------|-------------|------|
| LOCK_POLICY_DRAFT_SAVED | 정책 초안 저장 | 관리자 콘솔 |
| LOCK_POLICY_PUBLISHED | 정책 게시 | 에이전트 배포 |
| LOCK_POLICY_ROLLBACK | 정책 롤백 | 이전 버전 복원 |
| LOCK_POLICY_APPLIED | 고객사 잠금정책 적용 | |
| LOCK_POLICY_CACHE_USED | 캐시된 정책 사용 | 오프라인 시 |

---

## 화면 전환 (FR-13)

| Log Code | Description | 비고 |
|----------|-------------|------|
| SCREEN_TYPE_BEFORE | 시업 화면 표시 | screenType=before |
| SCREEN_TYPE_OFF | 종업 화면 표시 | screenType=off |
| SCREEN_TYPE_USABLE | PC 사용 가능 화면 | |
| SCREEN_TRANSITION | 화면 전환 | 이전→현재 상태 기록 |

---

## 업데이트 무결성

| Log Code | Description | 비고 |
|----------|-------------|------|
| UPDATE_SIGNATURE_INVALID | 업데이트 서명 검증 실패 | |
| UPDATE_HASH_MISMATCH | 업데이트 해시 불일치 | SHA-256 |
| UPDATE_NETWORK_ERROR | 업데이트 네트워크 오류 | |
