# Log Code Mapping

Electron 앱에서 사용하는 로그 코드 매핑.  
레거시 `5240.PcOff-master/docs/logcode.md`와 동기화하며, `app/core/constants.ts`의 `LOG_CODES`와 일치시킨다.

| Log Code | Description | 비고 |
|----------|-------------|------|
| APP_START | 애플리케이션 시작 | |
| LOGIN_SUCCESS | 로그인 성공 | |
| LOGIN_FAIL | 로그인 실패 | |
| LOGOUT | 로그아웃 | |
| LOCK_TRIGGERED | 잠금 트리거 (임시연장·이석 등) | |
| UNLOCK_TRIGGERED | 잠금 해제 트리거 (긴급사용 등) | |
| UPDATE_FOUND | 업데이트 감지 | FR-03 |
| UPDATE_DOWNLOADED | 업데이트 다운로드 완료 | |
| UPDATE_APPLIED | 업데이트 적용 완료 | |
| UPDATE_FAILED | 업데이트 실패 | |
| PASSWORD_CHANGE_DETECTED | 비밀번호 변경 감지 | FR-04, getPcOffWorkTime pwdChgYn=Y |
| PASSWORD_CONFIRM_DONE | 비밀번호 확인 완료 (검증 생략) | FR-04 |
| AGENT_TAMPER_DETECTED | 에이전트 변조/삭제/우회 탐지 | FR-07 |
| AGENT_TAMPER_ATTEMPT | 탬퍼 시도 이벤트 | FR-07 |
| AGENT_RECOVERED | 에이전트 복구 트리거 완료 | FR-07 |
| AGENT_RECOVERY_FAILED | 에이전트 복구 실패 | FR-07 |
| AGENT_STOP_ATTEMPT | 프로세스 Kill 시도 감지 | FR-07 |
| CRASH_DETECTED | 비정상 종료 감지 | FR-08 |
| OFFLINE_DETECTED | 통신 두절 감지 | |
| HEARTBEAT | Ops Observer heartbeat | FR-08 |
| INSTALLER_REGISTRY_SYNC | 설치자 레지스트리 동기화 | FR-09 (스캐폴드) |
