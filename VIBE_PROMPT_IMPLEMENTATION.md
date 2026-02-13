# VIBE CODING IMPLEMENTATION PROMPT ‒ 5240.PcOff Electron

이 프롬프트는 AI 개발 도구(예: Google Antigravity 또는 기타 LLM 기반 코드 제너레이터)에 전달하여 5240.PcOff Agent의 초기 구현을 생성하는 데 사용된다. 명확한 역할과 제약 조건을 정의하고, 참조 문서를 명시하며, 출력물 요구사항과 폴더 구조를 제안한다.

---

## Role

You are a senior Electron + TypeScript architect and implementer. Your task is to generate a production‑ready Electron project for the 5240.PcOff Agent.

---

## Mandatory Constraints

* Feature parity with legacy MFC PcOff Agent (기능 동등성)
* Silent auto‑update: user confirmation dialogs are **not** permitted
* Password change event must trigger confirmation UI only; **do not** validate password contents
* The application must run on both Windows and macOS
* Provide a simulator CLI that can run in CI environments
* Implement Agent Guard for tamper detection and self‑healing
* Implement Ops Observer for heartbeat, abnormal logs and installer registry synchronization

---

## Reference Docs

참고해야 할 문서 목록:

* `PRD_5240_PcOff_Electron.md`
* `TRD_5240_PcOff_Electron.md`
* `PC_OFF_AGENT_API.md`

이 외에도 API 명세(`api.md`)나 기타 서버 문서가 제공되면 함께 참고한다.

---

## Required Output

AI는 아래 항목을 포함하는 초기 프로젝트 구조와 코드를 생성해야 한다:

1. **Electron 앱 스켈레톤**: `app/main`, `app/renderer`, `app/preload`, `app/core` 폴더로 분리된 구조.
2. **feature‑core 상태 머신**: 로그인, 잠금, 사유입력, 타이머, 알림, 업데이트 등 업무 규칙을 TypeScript 상태 머신으로 구현.
3. **update‑manager 구현 스캐폴드**: 업데이트 확인, 백그라운드 다운로드, 무결성 검증, silent 적용, 롤백/재시도 큐 지원.
4. **telemetry‑log 시스템**: JSONL 로그 포맷으로 로컬에 저장하고 서버로 업로드할 수 있는 모듈.
5. **ops‑observer 모듈**: Heartbeat 전송, 비정상 종료/통신 두절 감지, installer registry 동기화.
6. **agent‑guard 모듈**: 무결성 체크, 삭제/우회 시도 탐지, 자동 복구 트리거.
7. **simulator CLI**: 시나리오 실행 도구로서 `simulator/` 폴더에 위치하고, 입력 파라미터를 받아 상태 머신을 실행하고 결과를 리포트한다.
8. **CI 파이프라인**: GitHub Actions 워크플로(`.github/workflows/`)를 포함하여 빌드, 시뮬레이터 실행, parity report 생성, 릴리즈 아티팩트를 자동화.

---

## Folder Layout

프로젝트는 다음과 같은 구조를 따라야 한다: