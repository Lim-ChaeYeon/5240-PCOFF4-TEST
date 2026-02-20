# PC‑OFF Agent API (PCOFF 통신 규격)

> **문의:** 김기현 프로

이 문서는 PCOFF Agent가 서버와 통신하는 API 엔드포인트와 파라미터를 정의한다. 해당 규격은 Electron 기반으로 재구축될 To‑Be 시스템에서도 As‑Is 동작을 유지하기 위한 기준을 제공한다.

---

## 0. 공통 규칙

### 0.1 표기/용어

* **Agent**: PcOff 클라이언트(Windows/macOS)
* **Server**: PCOFF 백엔드(웹뷰 관리 서버/근태 서버 포함)
* **WorkYmd**: 업무일자(YYYYMMDD)
* **DateTime**: YYYYMMDDHH24MI 형식

### 0.2 필수 공통 파라미터(권장)

API마다 달라질 수 있으나, 일반적으로 다음 값이 함께 전달된다:

* `workYmd (YYYYMMDD)`: 업무일자
* `userServareaId`: 서비스 영역 코드(암호화 및 인코딩)
* `userStaffId`: 사용자 OID(암호화 및 인코딩)

### 0.3 옵션 파라미터

각 API 호출 시 서버 정책이나 UI 설정에 따라 옵션 파라미터가 추가될 수 있다:

* `CHATBOT_TAA_MSG`
* `PCOFF_LEAVE_YN`
* `BSTRIP_PCOFF_YN`
* `TIMEREADER_LEAVE_SEAT`
* `PCOFF_TEMPORARY_DELAY`
* `PCOFF_USE_EMERGENCY`

---

## 1. 시나리오‑API 매핑 요약

| 시나리오 | 관련 API | 비고 |
|---|---|---|
| 로그인(기본/자동) | `/getPcOffServareaInfo.do`, `/getPcOffLoginUserInfo.do` | 전화번호 입력 후 서비스 영역 조회 및 계정 인증 |
| 근태/상태 조회 (PC‑ON/PC‑OFF/이석/임시연장/긴급사용 판단) | `/getPcOffWorkTime.do` | 정책 판단의 기준 데이터 |
| PC ON/OFF 로그 기록 (출근/퇴근 산정 포함) | `/callCmmPcOnOffLogPrc.do` | `tmckButnCd` IN/OUT 값에 따라 출근/퇴근 집계 |
| 임시연장 요청 | `/callPcOffTempDelay.do` | 임시연장 가능 여부 확인 후 호출 |
| 긴급사용 요청 | `/callPcOffEmergencyUse.do` | 인증번호/사유 입력 후 긴급사용 시작/종료 |

---

## 2. API 상세

### 2.1 서비스 영역 정보 획득

**Endpoint:** `POST /getPcOffServareaInfo.do`

**Scenario:** 로그인(기본/자동) 시 전화번호 입력 후 서비스 영역 정보(Servarea)를 조회한다.

**Request Parameters**

| 파라미터 | 설명 |
|---|---|
| `userMobileNo (000-0000-0000)` | 사용자 전화번호 |

**Response (요건 기반 예시)**

* 서비스 영역 코드/식별자(`userServareaId`) 등을 반환한다.

---

### 2.2 로그인 사용자 인증

**Endpoint:** `POST /getPcOffLoginUserInfo.do`

**Scenario:** 서비스 영역 정보 조회 후 계정/비밀번호를 입력하여 사용자 인증을 수행한다.

**Request Parameters**

| 파라미터 | 설명 |
|---|---|
| `userMobileNo` | 사용자 전화번호 |
| `userServareaId` | 서비스 영역 코드(암호화 및 인코딩) |
| `userStaffId` | 사용자 OID(암호화 및 인코딩) |
| `workYmd (YYYYMMDD)` | 업무일자 |

**Response (요건 기반 예시)**

* 로그인 성공 여부와 사용자 상태 정보를 반환한다.

---

### 2.3 근태/정책 판단 데이터 조회

**Endpoint:** `POST /getPcOffWorkTime.do`

**Scenario:** PC‑ON/PC‑OFF 상태 판단, 이석, 임시연장, 긴급사용 가능 여부 등 정책 결정을 위한 데이터를 조회한다.

**Options:**

이 API는 여러 옵션에 따라 추가 데이터를 반환할 수 있다. 예: `CHATBOT_TAA_MSG`, `PCOFF_LEAVE_YN`, `BSTRIP_PCOFF_YN`, `TIMEREADER_LEAVE_SEAT`, `PCOFF_TEMPORARY_DELAY`, `PCOFF_USE_EMERGENCY`.

**Response Fields (주요)**

| Field | 설명 |
|---|---|
| `pcOnYn (Y/N)` | PC‑ON 가능 여부 |
| `pcOnYmdTime (YYYYMMDDHH24MI)` | PC‑ON 시간 |
| `pcOffYmdTime (YYYYMMDDHH24MI)` | PC‑OFF 시간 |
| `leaveSeatUseYn (Y/N)` | 이석 관리 사용 여부 |
| `leaveSeatTime (분)` | 이석 잠금 시간 |
| `leaveSeatReasonYn (Y/N)` | 이석 사유 입력 여부 |
| `leaveSeatReasonManYn (Y/N)` | 이석 사유 필수 여부 |
| `leaveSeatOffInputMath (0)` | 비근무시간 입력/선택 설정 |
| `pcExMaxCount` | 임시연장 최대 횟수 |
| `pcExCount` | 임시연장 사용 횟수 |
| `pcExTime (분)` | 임시연장 시간 |
| `emergencyUseYesNo (YES/NO)` | 긴급사용 가능 여부 |
| `emergencyReasonYesNo (YES/NO)` | 긴급사용 시 사유 입력 여부 |
| `emergencyUsePass` | 긴급사용 인증번호 |
| `pcoffEmergencyYesNo (YES/NO)` | 긴급사용 중 여부 |
| `emergencyStaDate (YYYYMMDDHH24MI)` | 긴급사용 시작 시간 |
| `emergencyEndDate (YYYYMMDDHH24MI)` | 긴급사용 종료 시간 |
| `screenType` | 잠금화면 유형: `before`(시업 전), `off`(종업), `empty`(이석). 클라이언트에서 `exCountRenewal`로 재계산 가능 |
| `exCountRenewal (YYYYMMDDHH24MI)` | 일자변경 시각(옵션 1227). 현재 시각 < exCountRenewal → 종업화면(off), ≥ exCountRenewal → 시업화면(before) |

---

### 2.4 PC ON/OFF 동작 로그 기록

**Endpoint:** `POST /callCmmPcOnOffLogPrc.do`

**Scenario:** Agent의 출근/퇴근 로그 기록에 사용한다. IN/OUT 중 earliest/latest 시간으로 출근/퇴근을 산정한다.

**Request Parameters**

| 파라미터 | 설명 |
|---|---|
| `tmckButnCd (IN/OUT)` | PC‑OFF 동작 로그 구분(IN: 출근, OUT: 퇴근) |

**Option:** `CHATBOT_TAA_MSG`

**출근 규칙:** IN 로그 호출 코드 중 가장 빠른 시간으로 출근 기록. 예: Power On, Agent On, Lock Off, Lock Off-이석해제, Lock Off-임시연장, Lock Off-근태정보 불러오기, Lock Off-네트워크 복구 (Lock Off-긴급사용은 제외).

**퇴근 규칙:** OUT 로그 호출 코드 중 가장 늦은 시간으로 퇴근 기록. 예: Power Off, Agent Off, Lock On, Lock On-이석시작, Lock On-임시연장 종료, Lock On-긴급사용 종료.

> **Note:** 로그 코드 매핑은 `docs/operations/logcode.md`에 정의되어 있다.

---

### 2.5 임시연장 요청

**Endpoint:** `POST /callPcOffTempDelay.do`

**Scenario:** 근태 정보 결과에서 임시연장이 허용되는 경우, 임시연장 버튼 동작 시 서버에 요청한다.

**Options:** `PCOFF_TEMPORARY_DELAY`

**Request Parameters (요건 기반)**

| 파라미터 | 설명 |
|---|---|
| `pcOffYmdTime (YYYYMMDDHH24MI)` | PC‑OFF 기준 시간 |

임시연장은 `pcExMaxCount > 0`이고 `pcExCount < pcExMaxCount`일 때 가능하며, `pcExTime` 동안 PC 사용이 연장된다.

---

### 2.6 긴급사용 요청

**Endpoint:** `POST /callPcOffEmergencyUse.do`

**Scenario:** 긴급사용이 허용될 경우, 인증번호와 사유 입력 후 긴급사용을 시작하거나 종료한다.

**Options:** `PCOFF_USE_EMERGENCY`

**Request/Response Fields (주요)**

| Field | 설명 |
|---|---|
| `emergencyUsePass` | 긴급사용 인증번호 |
| `reason` | 긴급사용 사유(필요 시) |
| 기타 상태 값 | 서버 응답에 따라 처리 |

긴급사용 설정: `emergencyUseYesNo=YES`이면 사용 가능, `emergencyReasonYesNo=YES`이면 사유 입력이 필수다.

긴급사용 시작 시 Lock‑Off, 종료 시 Lock‑On 처리된다.

---

### 2.7 에이전트 이벤트 보고 (FR-08, Ops Observer)

**Endpoint:** `POST /reportAgentEvents.do`

**Scenario:** 에이전트가 heartbeat, 크래시 감지(CRASH_DETECTED), 통신 두절(OFFLINE_DETECTED) 등 이벤트를 중앙 서버에 배치 전송한다. 서버에 "중지/충돌/통신단절" 기록이 남도록 한다.

**Request Body (JSON)**

| 필드 | 설명 |
|------|------|
| `deviceId` | 기기 식별자(플랫폼 등) |
| `sessionId` | 세션 식별자 |
| `events` | 로그 항목 배열. 각 항목: `timestamp`, `logCode`, `level`, `sessionId`, `deviceId`, `payload` |

**logCode 예:** `APP_START`, `HEARTBEAT`, `CRASH_DETECTED`, `OFFLINE_DETECTED`, `AGENT_TAMPER_DETECTED`, `UPDATE_FOUND` 등 (`docs/operations/logcode.md` 참고).

**Response:** 서버는 2xx로 수신 확인 시 성공으로 간주한다. 실패 시 클라이언트는 지수 백오프 후 재시도한다.

---

## 3. To‑Be (Electron) 구현 시 주의사항

### 3.1 API 클라이언트 요구

* 모든 API 호출은 타입이 명확한 클라이언트로 감싸고, 요청과 응답을 구조화된 로그(JSONL)로 남긴다.
* 네트워크 장애나 통신 두절 상황을 ops‑observer에 보고해야 한다.

### 3.2 정책 판단 원칙

* Lock On/Off, 이석, 임시연장, 긴급사용 여부는 반드시 `/getPcOffWorkTime.do` 응답에 기반해 판단한다.
* 기능 동등성은 UI 표시가 아니라 결과(상태, 로그, API 파라미터)가 동일한지로 판단한다.

### 3.3 로그/출퇴근 규칙 준수

* 출근/퇴근 산정은 `/callCmmPcOnOffLogPrc.do`의 IN/OUT 로그 규칙을 준수한다.
* 어떤 동작이 IN/OUT에 해당하는지 매핑은 `docs/operations/logcode.md`와 동기화해야 한다.
