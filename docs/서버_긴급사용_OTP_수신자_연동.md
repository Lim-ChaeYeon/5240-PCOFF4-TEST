# 서버에서 긴급사용 OTP 수신자(본인/조직장) 내려주기

에이전트는 **서버에서** OTP 수신자(본인 발송 vs 조직장 발송)를 받아와야 안내 문구를 구분합니다. config.json에 고정해 두는 방식은 운영/테스트용 보조 수단이며, **정식으로는 아래 API 중 하나에서 값을 내려주면 됩니다.**

**원본 WebView(5240.PcOff-master/WebView)**: 본인/조직장에 따라 메시지를 나누는 로직은 **없음**. 원본은 `screen.php`·`PcUsePassModal`에서 **"메일 또는 스마트폰으로 받은 OTP를 입력하여 주세요."** 한 문구만 하드코딩. `getScreenInfo.php`·`tblSetting`의 `LockPass`, `Opt`는 긴급해제 비밀번호·이석 옵션용이며 OTP 수신 대상 구분용 필드는 없음. → **Electron 전환 시 요구사항으로 추가된 항목**이므로, 서버에서 값을 내려주려면 아래 API 중 한 경로에 필드 추가가 필요함.

---

## 1. getPcOffWorkTime.do 응답에 필드 추가 (권장)

**이미 클라이언트에서 해석 가능한 필드/값** — 백엔드에서 시간조회 응답에 아래 중 **하나만** 추가하면 됩니다.

| 필드명 (예시) | 값 (조직장 수신 시) | 값 (본인 수신 시) | 비고 |
|---------------|---------------------|---------------------|------|
| `emergencyOtpSendTo` | `"MANAGER"` | `"SELF"` | 권장. 문자열 그대로 사용 |
| `otpOrganizationalManagerReceiveYn` | `"Y"` 또는 `"YES"` | `"N"` 등 | Y/YES면 조직장 |
| `otpManagerReceiveYn` | `"Y"` 또는 `"YES"` | `"N"` 등 | 동일 |
| `emergencyOtpManagerReceiveYn` | `"Y"` 또는 `"YES"` | `"N"` 등 | 동일 |
| `otpOrganizationalManagerYn` | `"Y"` 또는 `"YES"` | `"N"` 등 | 동일 |
| `otpReceiveTarget` / `emergencyOtpReceiveTarget` | 문자열에 `"조직장"` 또는 `"MANAGER"` 포함 | 그 외 | 코드명/한글 설명 모두 가능 |
| `otpReceiveTargetCode` / `emergencyOtpReceiveType` | `2` (숫자) 또는 `"2"` (문자) | `1` 등 | 2=조직장으로 해석 |

**한글 키/값**  
- 키 이름에 `"조직장"` 포함이고 값이 `"Y"`/`"YES"`/`"수신"`/문자열에 `"조직장"` 포함이면 조직장으로 인식합니다.  
- 예: 관리 화면의 `OTP조직장수신여부`를 그대로 JSON 키로 써도 되고, 값은 `"Y"` 또는 `"OTP조직장 수신"` 등 문자열이면 됩니다.

**추천**  
- 새로 필드를 추가한다면 **`emergencyOtpSendTo`** 하나만 두고 값은 **`"MANAGER"`** / **`"SELF"`** 로 통일하는 것을 권장합니다.

---

## 2. lock-policy API (To-Be) 응답에 필드 추가

`GET /api/v1/pcoff/tenants/{tenantId}/lock-policy` 응답의 **`unlockPolicy`** 에 다음을 넣으면, 에이전트가 자동으로 병합해 사용합니다.

```json
{
  "unlockPolicy": {
    "emergencyOtpSendTo": "MANAGER",
    "leaveSeatUnlockRequirePassword": true,
    ...
  }
}
```

- `"MANAGER"`: 조직장 수신 문구  
- `"SELF"`: 본인 수신 문구  
- 필드 없음: config 또는 기본값(SELF) 사용

---

## 3. getLockScreenInfo.do 응답에 필드 추가

잠금화면 문구/배경을 내려주는 **getLockScreenInfo.do** 응답(또는 동일 구조의 `send_data` 항목)에 **`emergencyOtpSendTo`** 를 포함할 수 있습니다.

- **키**: `emergencyOtpSendTo`  
- **값**: `"MANAGER"` 또는 `"SELF"`  

에이전트는 getLockScreenInfo 결과를 병합할 때 이 값을 함께 반영하므로, **이 API를 이미 쓰는 경우** 여기만 추가해도 됩니다.

---

## 적용 우선순위 (에이전트 동작)

1. **getPcOffWorkTime** 응답의 해당 필드  
2. **lock-policy** API의 `unlockPolicy.emergencyOtpSendTo`  
3. **getLockScreenInfo** 응답의 `emergencyOtpSendTo`  
4. **config.json**의 `emergencyOtpSendTo` 또는 `pcoff.emergencyOtpSendTo`  
5. 없으면 기본값 **SELF**(본인 발송) 문구 사용  

---

## 백엔드 작업 요약

- **방법 1 (가장 단순)**: `getPcOffWorkTime.do` 응답에  
  `"emergencyOtpSendTo": "MANAGER"` 또는 `"SELF"` 한 필드만 추가.  
  (기존 5240 시간조회 응답 구조에 한 키 추가하는 수준)
- **방법 2**: lock-policy API를 이미 사용 중이면, `unlockPolicy.emergencyOtpSendTo` 추가.
- **방법 3**: getLockScreenInfo.do를 이미 사용 중이면, 같은 응답에 `emergencyOtpSendTo` 추가.

서버에서 위 중 한 경로로만 값을 내려줘도, config 없이 조직장/본인 문구가 구분됩니다.
