# PC‑OFF Agent API (PCOFF 통신 규격)

> **문의:** 김기현 프로  
> **규격 기준:** 5240_COMMON_PC_OFF_API v1.9 (엑셀)
> 5240_COMMON_PC_OFF_API_v1.9_원본시트.md

이 문서는 PCOFF Agent가 서버와 통신하는 API 엔드포인트와 파라미터를 정의한다. 해당 규격은 Electron 기반으로 재구축될 To‑Be 시스템에서도 As‑Is 동작을 유지하기 위한 기준을 제공한다.

**Base URL:** `https://api.5240.cloud`  
**공통:** 모든 API는 `HTTPS/POST`, Request/Response `type:json`(JSON).

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

### 0.4 공통 응답 코드 (에러코드)

서버 응답의 `code` 값은 UTF-8로 인코딩된 `msg`와 함께 반환된다. 한글 표시를 위해 `msg`는 UTF-8로 디코딩하여 사용한다.

| code | 설명 |
|------|------|
| `1` | 조회 성공 |
| `-1` | 조회 실패 |
| `-4` | 데이터 처리 오류 |
| `-5` | 임시연장 실패 |
| `-9` | 기타 알 수 없는 오류 |
| `500` | 내부 서버 오류 |

---

## 1. 시나리오‑API 매핑 요약

| 시나리오 | 관련 API | 비고 |
|---|---|---|
| 로그인(기본/자동) | `/getPcOffServareaInfo.do`, `/getPcOffLoginUserInfo.do` | 전화번호 입력 후 서비스 영역 조회 및 계정 인증 |
| 근태/상태 조회 (PC‑ON/PC‑OFF/이석/임시연장/긴급사용 판단) | `/getPcOffWorkTime.do` | 정책 판단의 기준 데이터 |
| PC ON/OFF 로그 기록 (출근/퇴근 산정 포함) | `/callCmmPcOnOffLogPrc.do` | `tmckButnCd` IN/OUT 값에 따라 출근/퇴근 집계 |
| 임시연장 요청 | `/callPcOffTempDelay.do` | 임시연장 가능 여부 확인 후 호출 |
| 긴급사용 요청 | `/callPcOffEmergencyUse.do` | 인증번호/사유 입력 후 긴급사용 시작/종료 |
| 이석정보 서버 전송 (FR-12) | `/reportLeaveSeatEvent.do` | 이석 START/END 세션 기반 전송, 재시도 큐 |
| 고객사 잠금 정책 (FR-14) | `GET /api/v1/pcoff/tenants/{tenantId}/lock-policy` | 조회·30분 폴링 캐시. Draft/Publish/Rollback: `POST .../lock-policy/draft`, `.../publish`, `.../rollback`(관리 콘솔용) |

---

## 2. API 상세

### 2.1 서비스 영역 정보 획득

**Endpoint:** `POST https://api.5240.cloud/getPcOffServareaInfo.do`

**Scenario:** 전화번호를 입력받아 접속 가능한 서비스 영역 리스트를 조회한다.

**Request Parameters**

| 파라미터 | 설명 |
|----------|------|
| `userMobileNo` | 로그인 유저 휴대폰 번호 (예: 000-0000-0000) |

**Response (JSON)**

| 필드 | 설명 |
|------|------|
| `code` | 조회 결과 코드 (1: 성공 등, §0.4 참고) |
| `msg` | 조회 결과 메시지 (UTF-8 디코딩 후 사용) |
| `servareaList` | 접속 가능 서비스 영역 리스트 (예: `[{servareaId, servareaNm}, ...]`) |
| `userMobileNo` | 호출 시 전달한 전화번호(그대로 반환) |

---

### 2.2 로그인 사용자 인증

**Endpoint:** `POST https://api.5240.cloud/getPcOffLoginUserInfo.do`

**Scenario:** 로그인 시 서비스 영역·직원 식별 정보를 받기 위해, 전화번호·선택한 서비스영역·아이디·비밀번호를 전달한다. 성공 시 암호화된 서비스영역 ID·직원 ID를 반환한다.

**Request Parameters**

| 파라미터 | 설명 |
|----------|------|
| `userMobileNo` | 로그인 유저 휴대폰 번호 |
| `loginServareaId` | 로그인 서비스 영역(암호화). 서비스영역 조회 결과에서 선택한 값 |
| `loginUserId` | 로그인 유저 아이디 |
| `loginPassword` | 로그인 유저 패스워드 |

**Response (JSON)**

| 필드 | 설명 |
|------|------|
| `code` | 처리 결과 코드 |
| `msg` | 처리 결과 메시지 (UTF-8 디코딩 후 사용) |
| `userMobileNo` | 로그인 유저 휴대폰 번호 |
| `userServareaId` | 암호화된 서비스 영역 ID (이후 API 공통 파라미터) |
| `userStaffId` | 암호화된 직원 ID (이후 API 공통 파라미터) |
| `loginUserNm` | 로그인 유저 성명 |
| `corpNm`, `posNm`, `resNm` | 회사명, 직위, 직책 |
| `message1` ~ `message5` | 메시지 필드 |

---

### 2.3 근태/정책 판단 데이터 조회

**Endpoint:** `POST https://api.5240.cloud/getPcOffWorkTime.do`

**Scenario:** 해당 근무일자에 대한 근태 관련 시간 데이터(시업, 종업, PC-ON, PC-OFF, 출근체크, 퇴근체크 등)를 조회한다. 정책 판단의 기준 데이터로 사용한다.

**Request Parameters**

| 파라미터 | 설명 |
|----------|------|
| `userServareaId` | 암호화된 서비스 영역 ID |
| `userStaffId` | 암호화된 직원 ID |
| `workYmd` | 근무일자(YYYYMMDD) |

**Options:** 서버 정책에 따라 추가 데이터 반환. 예: `CHATBOT_TAA_MSG`, `PCOFF_LEAVE_YN`, `BSTRIP_PCOFF_YN`, `TIMEREADER_LEAVE_SEAT`, `PCOFF_TEMPORARY_DELAY`, `PCOFF_USE_EMERGENCY`.

**Response (JSON)** — `code`, `msg`(UTF-8 디코딩 후 사용), 이하 근태 데이터.

**Response Fields (전체, 엑셀 v1.9 기준)**

| Field | 설명 |
|-------|------|
| `userServareaId`, `userStaffId` | 암호화된 서비스 영역 ID, 직원 ID |
| `workYmd` | 근무일자(YYYYMMDD) |
| `staYmdTime`, `endYmdTime` | 시업시간, 종업시간(YYYYMMDDHH24MI) |
| `pcOnYmdTime`, `pcOffYmdTime` | PC-ON 시간, PC-OFF 시간(임시연장 적용된 종료시간, YYYYMMDDHH24MI) |
| `checkTime` | 출퇴근 체크시간(값 없으면 ##N) |
| `workTypeCd`, `workTypeNm` | 근무유형코드, 근무유형명(고객사별 상이) |
| `freeTimeWorkTypeYn` | 자율근무제 여부(Y/N) |
| `pcOffTargetYn` | PC-OFF 적용 대상 여부(Y/N) |
| `exCountRenewal` | 임시연장 차수 초기화 기준시간(YYYYMMDDHH24MI) |
| `pcExCount`, `pcExMaxCount`, `pcExTime` | 해당일 임시연장 사용 횟수, 최대 횟수, 1회당 추가 시간(분) |
| `pcMealStaTime`, `pcMealEndTime` | 휴게(식사) 시작·종료 시간(YYYYMMDDHH24MI) |
| `pcOnYn`, `pcOnMsg` | PC 사용 가능 일자 여부(Y/N), PC 사용 안내 메시지 |
| `workZoneQtyType` | 근무구역 관리 유형(예: ZONE 등) |
| `pcoffEmergencyYesNo` | PC-OFF 긴급사용 기능 사용 여부(YES/NO) |
| `emergencyUseYesNo`, `emergencyUsePass` | 긴급사용 승인 여부(YES/NO), 긴급사용 비밀번호(없으면 null) |
| `emergencyReasonYesNo` | 긴급사용 사유 입력 여부(YES/NO) |
| `emergencyStaDate`, `emergencyEndDate` | 긴급사용 시작·종료시간(YYYYMMDDHH24MI 또는 HH24MISS) |
| `nextYmd` | 익일 근무일자(YYYYMMDD) |
| `leaveSeatUseYn` | 이석관리 사용 여부(YES/NO) |
| `leaveSeatTime` | 이석 시 자동 화면잠금 기준시간(분) |
| `leaveSeatReasonTime` | 이석 후 사유 입력 기준시간(분) |
| `leaveSeatReasonYn`, `leaveSeatReasonManYn` | 이석 후 PC ON 시 사유 입력 여부, 사유 필수 여부(YES/NO) |
| `leaveSeatOffInputMath` | 이석 관련 입력 처리 구분값(0/1/2/3) |
| `weekCreWorkTime`, `weekWorkTime` | 주 기준 근로시간, 해당 주 누적 근로시간 |
| `weekLmtOtTime`, `weekUseOtTime`, `weekApplOtTime` | 주 연장근로 한도·사용·신청 시간 |
| `apiCallLogYesNo` | API 호출 로그 저장 여부(YES/NO) |
| `pcoffLoginYn` | PC-OFF 상태에서 로그인 가능 여부(Y/N) |

**클라이언트 보조:** `screenType`은 문서/클라이언트에서 사용하는 잠금화면 유형(`before`/`off`/`empty`)이며, `exCountRenewal` 기준으로 재계산 가능하다.

**FR-14 잠금화면 문구:** 서버에서 `lockScreenBeforeTitle`/`lockScreenBeforeMessage`, `lockScreenOffTitle`/`lockScreenOffMessage`, `lockScreenLeaveTitle`/`lockScreenLeaveMessage`를 내려주면 잠금화면에 우선 적용한다. 미제공 시 클라이언트는 선택 API `getLockScreenInfo.do`로 설정값을 보강할 수 있다.

**FR-14 잠금화면 배경·로고:** 서버 또는 getLockScreenInfo의 `send_data`에서 `Background`·`Logo` URL을 내려주면, 클라이언트는 `screenType`(before/off/empty)별로 body 배경 이미지와 헤더 로고 이미지(`#lock-logo-img`)에 적용한다. config.json `lockScreen.before/off/leave.backgroundUrl`·`logoUrl`로도 동일하게 지정 가능하며, API와 병합 후 적용된다.

---

### 2.3.1 잠금화면 설정 조회 (선택)

**Endpoint:** `POST https://api.5240.cloud/getLockScreenInfo.do`

**Scenario:** 고객사별 잠금화면 문구·배경 등 설정을 조회한다. `getPcOffWorkTime.do` 응답에 `lockScreen*` 필드가 없을 때 클라이언트가 이 API를 호출해 설정값을 보강한다.

**Request Parameters**

| 파라미터 | 설명 |
|----------|------|
| `userServareaId` | 암호화된 서비스 영역 ID |
| `userStaffId` | 암호화된 직원 ID |
| `workYmd` | 근무일자(YYYYMMDD) |

**Response (JSON)**

| 필드 | 설명 |
|------|------|
| `code` | 조회 결과 코드 (1: 성공 등) |
| `send_data` | 배열. 각 항목: `ScreenType`(before/off/empty), `LockTitle`, `LockMessage`, `Background`, `Logo` 등 |

**ScreenType 매핑:** `before` → 시업 전, `off` → 종업, `empty`(또는 `leave`) → 이석. 클라이언트는 `send_data`를 `WorkTimeResponse`의 `lockScreen*` 필드로 변환해 병합한다.

**WebView 호환:** 서버에 `getLockScreenInfo.do`가 없을 경우, `config.json`에 `lockScreenApiUrl`을 두면 해당 URL로 동일 규격(POST `[{ "userServareaId" }]` → `{ "status", "send_data" }`)을 호출한다. 예: `https://5240.work/LockScreen/getScreenInfo.php`

---

### 2.4 PC ON/OFF 동작 로그 기록

**Endpoint:** `POST https://api.5240.cloud/callCmmPcOnOffLogPrc.do`

**Scenario:** PC ON/OFF 시 로그를 서버에 기록한다. Agent는 IN/OUT 로그 코드에 따라 출근/퇴근을 산정한다.

**Request Parameters**

| 파라미터 | 설명 |
|----------|------|
| `userServareaId` | 암호화된 서비스 영역 ID |
| `userStaffId` | 암호화된 직원 ID |
| `workYmd` | 근무일자(YYYYMMDD) |
| `recoder` | 고정값 `"PC-OFF"` |
| `tmckButnCd` | `IN`(켜질 때/출근), `OUT`(꺼질 때/퇴근) |
| `reason` | 사유(사유 필수인 경우 입력). 긴급사용·이석 사유 등 |
| `emergencyYn` | `N` 또는 `긴급사용여부(Y/N)/이석시간(시간단위,소수점7자리)/이석시작(HHMI)/이석종료(HHMI)/이석중비근무시간`. 예: `N`, `0.5/1210/1240/0` |

**이석 중 비근무 시간 (`emergencyYn` 마지막 값, `leaveSeatOffInputMath` 기준)**

`getPcOffWorkTime.do` 응답의 `leaveSeatOffInputMath` 값에 따라 전달한다.

| 값 | 의미 | 전달 |
|----|------|------|
| `0` | 사용 안 함 | 전달하지 않아도 됨 |
| `1` | 비근무시간 입력 | 사용자 입력값 그대로 전달 |
| `2` | 근무 중 이석시간으로 자동 입력 | `0` 전달 |
| `3` | 근무이석(1)/비근무이석(2) 선택 | 콤보 1이면 `0`, 2면 입력값 전달 |

**NOTE (엑셀):** 위 2, 3의 경우 서버로 이석 시작시간·종료시간을 전달하며, 서버에서 시간을 재계산한다.

**Option:** `CHATBOT_TAA_MSG`

**출근 규칙:** IN 로그 호출 코드 중 가장 빠른 시간으로 출근 기록. 예: Power On, Agent On, Lock Off, Lock Off-이석해제, Lock Off-임시연장, Lock Off-근태정보 불러오기, Lock Off-네트워크 복구 (Lock Off-긴급사용은 제외).

**퇴근 규칙:** OUT 로그 호출 코드 중 가장 늦은 시간으로 퇴근 기록. 예: Power Off, Agent Off, Lock On, Lock On-이석시작, Lock On-임시연장 종료, Lock On-긴급사용 종료.

> **Note:** 로그 코드 매핑은 `docs/operations/logcode.md`에 정의되어 있다.

---

### 2.5 임시연장 요청

**Endpoint:** `POST https://api.5240.cloud/callPcOffTempDelay.do`

**Scenario:** 임시연장 처리 후 서버가 갱신된 근태 시간 정보를 조회해 리턴한다. `getPcOffWorkTime.do`에서 `pcExMaxCount > 0`이고 `pcExCount < pcExMaxCount`일 때만 호출한다.

**Options:** `PCOFF_TEMPORARY_DELAY`

**Request Parameters**

| 파라미터 | 설명 |
|----------|------|
| `userServareaId` | 암호화된 서비스 영역 ID |
| `userStaffId` | 암호화된 직원 ID |
| `workYmd` | 근무일자(YYYYMMDD) |
| `pcOffYmdTime` | PC‑OFF 기준 시간(YYYYMMDDHH24MI). 선택 시 사용 |
| `extCount` | 임시연장 차수(1, 2, …). 서버가 연장 횟수로 사용 |

임시연장 성공 시 응답에 갱신된 근태 데이터(예: `pcExCount`, `pcExTime` 등)가 포함된다.

---

### 2.6 긴급사용 요청

**Endpoint:** `POST https://api.5240.cloud/callPcOffEmergencyUse.do`

**Scenario:** 긴급사용 요청 시 호출한다. 호출 후 PC-OFF에서 확인할 수 있도록 긴급사용 비밀번호 및 긴급사용 시간이 응답에 포함된다.

**Options:** `PCOFF_USE_EMERGENCY`

**Request Parameters**

| 파라미터 | 설명 |
|----------|------|
| `userServareaId` | 암호화된 서비스 영역 ID |
| `userStaffId` | 암호화된 직원 ID |
| `workYmd` | 근무일자(YYYYMMDD) |
| `clickIp` | (선택) 호출 PC의 IP/GPS/OS를 `"/"`로 연결한 문자열. 예: `127.0.0.1/WINDOW` |
| `emergencyUsePass` | 긴급사용 인증번호 |
| `reason` | 긴급사용 사유 (`emergencyReasonYesNo=YES`일 때 입력) |

**Response:** `code`, `msg` 및 갱신된 근태 정보(긴급사용 비밀번호, 긴급사용 시간 등). `emergencyUseYesNo=YES`이면 사용 가능, `emergencyReasonYesNo=YES`이면 사유 입력 필수. 긴급사용 시작 시 Lock‑Off, 종료 시 Lock‑On 처리.

---

### 2.7 에이전트 이벤트 보고 (FR-08, Ops Observer)

**Endpoint:** `POST https://api.5240.cloud/reportAgentEvents.do` (To‑Be 전용)

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

### 2.8 이석정보 서버 전송 (FR-12)

**Endpoint:** `POST https://api.5240.cloud/reportLeaveSeatEvent.do` (To‑Be 전용)

**Scenario:** 에이전트가 이석 시작(START)/종료(END) 이벤트를 세션 기반(`leaveSeatSessionId`)으로 서버에 전송한다. Idle/절전 감지 시 START, PC-ON 해제 시 END. 장애 내성을 위해 실패 시 로컬 큐(JSONL) 적재 후 지수 백오프 재시도.

**Request Body (JSON 배열, 1건)**

| 필드 | 설명 |
|------|------|
| `eventType` | `LEAVE_SEAT_START` \| `LEAVE_SEAT_END` |
| `workSessionType` | `NORMAL` \| `TEMP_EXTEND` \| `EMERGENCY_USE` |
| `leaveSeatSessionId` | 동일 세션 내 START/END 매핑용 UUID |
| `reason` | 이석 사유(200자 제한, 제어문자 제거). END 시 PC-ON 사유 가능 |
| `occurredAt` | 이벤트 발생 시각(ISO8601) |
| `clientVersion` | 앱 버전 |
| `workYmd` | 업무일자(YYYYMMDD) |
| `userServareaId` | 서비스 영역 코드 |
| `userStaffId` | 사용자 OID |
| `deviceId` | 기기 식별자 |

**Response (요건 기반 예시):** `code`, `message`, `accepted`, `eventId`, `serverReceivedAt` 등. 2xx 수신 시 성공. 실패 시 클라이언트는 `leave-seat-queue.jsonl`에 적재 후 10s→30s→60s→5m→15m 지수 백오프, 최대 10회 재시도.

**정합성:** START 없이 END 전송 금지. 중복 START 방지(활성 세션 있으면 무시).

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

---

## 부록 A. 기존 대비 v1.9에서 추가·변경된 항목

엑셀 5240_COMMON_PC_OFF_API v1.9 반영 시, **기존 문서에 없던 값** 또는 **이름·의미가 바뀐 값**만 정리한다.

### 공통

| 구분 | 항목 | 내용 |
|------|------|------|
| **추가** | 규격 기준 | 문서 상단에 "5240_COMMON_PC_OFF_API v1.9 (엑셀)" 명시 |
| **추가** | Base URL | `https://api.5240.cloud` |
| **추가** | §0.4 공통 응답 코드 | code: 1, -1, -4, -5, -9, 500 및 설명. msg UTF-8 디코딩 안내 |

### 2.1 서비스 영역

| 구분 | 항목 | 내용 |
|------|------|------|
| **추가** | Response `userMobileNo` | 호출 시 전달한 전화번호 그대로 반환 |

### 2.2 로그인

| 구분 | 항목 | 내용 |
|------|------|------|
| **변경** | Request 파라미터 | 기존: userServareaId, userStaffId, workYmd 등으로 적혀 있음 → **v1.9**: `loginServareaId`, `loginUserId`, `loginPassword` (요청 시 전달하는 값) |
| **추가** | Response `loginUserNm` | 로그인 유저 성명 |
| **추가** | Response `message5` | 기존 message1~4 → **message1~5** |

### 2.3 시간조회 (getPcOffWorkTime)

| 구분 | 항목 | 내용 |
|------|------|------|
| **추가** | Request 표 | `userServareaId`, `userStaffId`, `workYmd` 명시 |
| **추가** | Response 필드 (엑셀 전체) | `staYmdTime`, `endYmdTime`, `checkTime`, `workTypeCd`, `workTypeNm`, `freeTimeWorkTypeYn`, `workYmd`, `pcOffTargetYn`, `pcMealStaTime`, `pcMealEndTime`, `pcOnMsg`, `workZoneQtyType`, `nextYmd`, `leaveSeatReasonTime`, `weekCreWorkTime`, `weekWorkTime`, `weekLmtOtTime`, `weekUseOtTime`, `weekApplOtTime`, `apiCallLogYesNo`, `pcoffLoginYn` 등 (기존에는 일부만 있었음) |

### 2.4 로그기록 (callCmmPcOnOffLogPrc)

| 구분 | 항목 | 내용 |
|------|------|------|
| **추가** | Request `userServareaId`, `userStaffId`, `workYmd` | 공통 파라미터 명시 |
| **추가** | Request `recoder` | 고정값 `"PC-OFF"` |
| **추가** | Request `reason` | 사유(필수인 경우 입력) |
| **추가** | Request `emergencyYn` | 긴급사용여부/이석시간/이석시작/이석종료/이석중비근무시간 형식 |
| **추가** | leaveSeatOffInputMath (0/1/2/3) 규칙 표 | 비근무시간 전달 규칙 |
| **추가** | NOTE | 2·3의 경우 서버로 이석 시작·종료 시간 전달, 서버에서 재계산 |

### 2.5 임시연장

| 구분 | 항목 | 내용 |
|------|------|------|
| **추가** | Request `userServareaId`, `userStaffId`, `workYmd` | 공통 파라미터 명시 |
| **추가** | Request `extCount` | 임시연장 차수(1, 2, …) |

### 2.6 긴급사용

| 구분 | 항목 | 내용 |
|------|------|------|
| **추가** | Request `userServareaId`, `userStaffId`, `workYmd` | 공통 파라미터 명시 |
| **추가** | Request `clickIp` | (선택) IP/GPS/OS를 "/"로 연결. 예: 127.0.0.1/WINDOW |

### 요약

- **추가된 것**: Base URL, 공통 응답 코드(§0.4), 각 API별 전체 URL, 서비스영역 응답 `userMobileNo`, 로그인 요청 정확한 필드명(loginServareaId 등) 및 응답 `loginUserNm`·`message5`, 시간조회 Request 표·Response 필드 전체, 로그기록 Request(recoder·reason·emergencyYn)·이석 비근무 규칙·NOTE, 임시연장·긴급사용 Request(extCount·clickIp 등).
- **이름/의미 변경**: 로그인 **요청**은 `userServareaId`/`userStaffId`가 아니라 `loginServareaId`/`loginUserId`/`loginPassword`로 전달한다는 점을 명확히 함.
