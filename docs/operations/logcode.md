# Log Code Mapping (Initial)

이 문서는 Electron 전환 초기 단계의 로그 코드 매핑 초안이다.
레거시 `5240.PcOff-master/docs/logcode.md`와 동기화하며 확정한다.

| Log Code | Description |
|---|---|
| APP_START | 애플리케이션 시작 |
| LOGIN_SUCCESS | 로그인 성공 |
| LOGIN_FAIL | 로그인 실패 |
| LOCK_TRIGGERED | 잠금 트리거 |
| UNLOCK_TRIGGERED | 잠금 해제 트리거 |
| UPDATE_FOUND | 업데이트 감지 |
| UPDATE_DOWNLOADED | 업데이트 다운로드 완료 |
| UPDATE_APPLIED | 업데이트 적용 완료 |
| UPDATE_FAILED | 업데이트 실패 |
| PASSWORD_CHANGE_DETECTED | 비밀번호 변경 감지 |
| PASSWORD_CONFIRM_DONE | 비밀번호 확인 완료 |
| AGENT_TAMPER_DETECTED | 에이전트 변조 감지 |
| AGENT_RECOVERED | 에이전트 복구 |
| CRASH_DETECTED | 비정상 종료 감지 |
| OFFLINE_DETECTED | 통신 두절 감지 |
