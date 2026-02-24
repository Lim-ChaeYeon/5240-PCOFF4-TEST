/** 잠금화면 종류: before=시업 전, off=종업, empty=이석 */
export type ScreenType = "before" | "off" | "empty";

export interface WorkTimeResponse {
  /** 암호화된 서비스 영역 ID */
  userServareaId?: string;
  /** 암호화된 직원 ID */
  userStaffId?: string;
  /** 근무일자(YYYYMMDD) */
  workYmd?: string;
  /** 시업시간(YYYYMMDDHH24MI) */
  staYmdTime?: string;
  /** 종업시간(YYYYMMDDHH24MI) */
  endYmdTime?: string;
  /** PC-ON 시간(YYYYMMDDHH24MI) */
  pcOnYmdTime?: string;
  /** PC-OFF 시간 — 임시연장 적용된 종료시간(YYYYMMDDHH24MI) */
  pcOffYmdTime?: string;
  /** 출퇴근 체크시간(값 없으면 ##N) */
  checkTime?: string;
  /** 근무유형코드(고객사별 상이) */
  workTypeCd?: string;
  /** 근무유형명 */
  workTypeNm?: string;
  /** 자율근무제 여부 */
  freeTimeWorkTypeYn?: "Y" | "N";
  /** PC-OFF 적용 대상 여부 */
  pcOffTargetYn?: "Y" | "N";
  /** 임시연장 차수 초기화 기준시간(YYYYMMDDHH24MI) */
  exCountRenewal?: string;
  /** 해당일 임시연장 사용 횟수 */
  pcExCount?: number;
  /** 임시연장 최대 횟수 */
  pcExMaxCount?: number;
  /** 1회당 임시연장 추가 시간(분) */
  pcExTime?: number;
  /** 휴게(식사) 시작시간(YYYYMMDDHH24MI) */
  pcMealStaTime?: string;
  /** 휴게(식사) 종료시간(YYYYMMDDHH24MI) */
  pcMealEndTime?: string;
  /** PC 사용 가능 일자 여부(Y/N). 휴일·휴가·출장 등 일자 기준 체크 */
  pcOnYn?: "Y" | "N";
  /** PC 사용 안내 메시지 */
  pcOnMsg?: string;
  /** 근무구역 관리 유형(예: ZONE 등) */
  workZoneQtyType?: string;
  /** PC-OFF 긴급사용 기능 사용 여부 */
  pcoffEmergencyYesNo?: "YES" | "NO";
  /** 긴급사용 승인 여부 */
  emergencyUseYesNo?: "YES" | "NO";
  /** 긴급사용 비밀번호(없으면 null) */
  emergencyUsePass?: string | null;
  /** 긴급사용 사유 입력 여부 */
  emergencyReasonYesNo?: "YES" | "NO";
  /** 긴급사용 시작시간(YYYYMMDDHH24MI 또는 HH24MISS) */
  emergencyStaDate?: string;
  /** 긴급사용 종료시간(YYYYMMDDHH24MI 또는 HH24MISS) */
  emergencyEndDate?: string;
  /** 익일 근무일자(YYYYMMDD) */
  nextYmd?: string;
  /** 이석관리 사용 여부 */
  leaveSeatUseYn?: "Y" | "N" | "YES" | "NO";
  /** 이석 판정 기준 시간(분). 유휴/절전 경과 >= 이 값이면 이석 처리 */
  leaveSeatTime?: number;
  /** 이석 후 사유 입력 기준시간(분) */
  leaveSeatReasonTime?: number;
  /** 이석 후 PC ON 시 사유 입력 여부 */
  leaveSeatReasonYn?: "YES" | "NO";
  /** 이석 사유 필수 여부 */
  leaveSeatReasonManYn?: "YES" | "NO";
  /** 이석 관련 입력 처리 구분값(0/1/2/3) */
  leaveSeatOffInputMath?: string;
  /** 주 기준 근로시간 */
  weekCreWorkTime?: string;
  /** 해당 주 누적 근로시간 */
  weekWorkTime?: string;
  /** 주 연장근로 한도 시간 */
  weekLmtOtTime?: string;
  /** 주 연장근로 사용 시간 */
  weekUseOtTime?: string;
  /** 주 연장근로 신청 시간 */
  weekApplOtTime?: string;
  /** API 호출 로그 저장 여부 */
  apiCallLogYesNo?: "YES" | "NO";
  /** PC-OFF 상태에서 로그인 가능 여부 */
  pcoffLoginYn?: "Y" | "N";

  /* --- FR-15: 긴급해제 정책 (서버 옵션) --- */
  /** 긴급해제 기능 사용 여부 */
  emergencyUnlockUseYn?: "YES" | "NO";
  /** 긴급해제 비밀번호 설정 여부 */
  emergencyUnlockPasswordSetYn?: "Y" | "N";
  /** 긴급해제 허용 시간(분). 기본 180(3시간) */
  emergencyUnlockTime?: number;
  /** 긴급해제 최대 실패 횟수. 기본 5 */
  emergencyUnlockMaxFailures?: number;
  /** 긴급해제 차단 시간(초). 기본 300(5분) */
  emergencyUnlockLockoutSeconds?: number;

  /* --- 기타 클라이언트 보조 --- */
  /** 비밀번호 변경 필요 여부 */
  pwdChgYn?: "Y" | "N";
  /** 비밀번호 변경 메시지 */
  pwdChgMsg?: string;
  /** 서버가 내려준 화면 유형(before/off/empty). exCountRenewal 기준 재계산 가능 */
  screenType?: ScreenType | string;

  /* --- FR-14: 고객사 설정(잠금화면 문구). 서버에서 내려주면 우선 적용 --- */
  /** 시업 전(before) 잠금 제목 */
  lockScreenBeforeTitle?: string;
  /** 시업 전(before) 잠금 안내 문구 */
  lockScreenBeforeMessage?: string;
  /** 종업(off) 잠금 제목 */
  lockScreenOffTitle?: string;
  /** 종업(off) 잠금 안내 문구 */
  lockScreenOffMessage?: string;
  /** 이석(leave/empty) 잠금 제목 */
  lockScreenLeaveTitle?: string;
  /** 이석(leave/empty) 잠금 안내 문구 */
  lockScreenLeaveMessage?: string;
  /** 시업 전(before) 배경 이미지 URL */
  lockScreenBeforeBackground?: string;
  /** 시업 전(before) 로고 이미지 URL */
  lockScreenBeforeLogo?: string;
  /** 종업(off) 배경 이미지 URL */
  lockScreenOffBackground?: string;
  /** 종업(off) 로고 이미지 URL */
  lockScreenOffLogo?: string;
  /** 이석(leave/empty) 배경 이미지 URL */
  lockScreenLeaveBackground?: string;
  /** 이석(leave/empty) 로고 이미지 URL */
  lockScreenLeaveLogo?: string;
  /** FR-14: 이석 해제 시 비밀번호 입력 필요 여부 (전용 정책 API에서 설정) */
  leaveSeatUnlockRequirePassword?: boolean;
}

/** FR-14: 전용 정책 API 응답 (GET /api/v1/pcoff/tenants/{tenantId}/lock-policy) */
export interface TenantLockPolicy {
  lockScreen?: {
    screens?: {
      before?: { title?: string; message?: string; imageAssetId?: string };
      off?: { title?: string; message?: string; imageAssetId?: string };
      leave?: { title?: string; message?: string; imageAssetId?: string };
    };
    logoAssetId?: string;
  };
  unlockPolicy?: {
    emergencyUnlockEnabled?: boolean;
    emergencyUnlockPassword?: {
      minLength?: number;
      requireComplexity?: boolean;
      maxFailures?: number;
      lockoutSeconds?: number;
      expiresInDays?: number;
    };
    leaveSeatUnlockRequirePassword?: boolean;
  };
  version?: number;
  publishedAt?: string;
}

/** 잠금화면 설정 조회 API 응답 항목 (getLockScreenInfo.send_data 요소) */
export interface LockScreenInfoItem {
  ScreenType?: string;
  LockTitle?: string;
  LockMessage?: string;
  Background?: string;
  Logo?: string;
}

/** 잠금화면 설정 조회 API 응답 (고객사별 문구/배경 등, 선택 API) */
export interface GetLockScreenInfoResponse {
  code?: number;
  send_data?: LockScreenInfoItem[];
}

export interface ApiClientConfig {
  baseUrl: string;
  workYmd: string;
  userServareaId: string;
  userStaffId: string;
}

export interface PcOnOffLogRequest {
  tmckButnCd: "IN" | "OUT";
  reason?: string;
  emergencyYn?: string;
  eventName?: string;
  recoder?: string;
}

export interface EmergencyUseRequest {
  /** 긴급사용 인증번호 */
  emergencyUsePass: string;
  /** 긴급사용 사유 (emergencyReasonYesNo=YES일 때 입력) */
  reason?: string;
  /** (선택) IP/GPS/OS를 "/"로 연결. 예: 127.0.0.1/WINDOW */
  clickIp?: string;
}

/** FR-15: 긴급해제 요청 */
export interface EmergencyUnlockRequest {
  password: string;
  reason?: string;
}

/** FR-15: 긴급해제 응답 */
export interface EmergencyUnlockResponse {
  success: boolean;
  remainingAttempts?: number;
  lockoutUntil?: string;
  message?: string;
}

/** 서비스 영역 조회 응답 (전화번호로 조회) */
export interface ServareaInfoItem {
  servareaId?: string;
  servareaNm?: string;
  userServareaId?: string;
}

/** 로그인 요청 (레거시와 동일: loginServareaId, loginUserId, loginPassword) */
export interface LoginRequest {
  userMobileNo: string;
  loginServareaId: string;
  loginUserId: string;
  loginPassword: string;
  workYmd?: string;
}

/** 로그인 성공 응답 */
export interface LoginResponse {
  code?: string;
  msg?: string;
  userMobileNo?: string;
  userServareaId?: string;
  userStaffId?: string;
  loginUserId?: string;
  loginUserNm?: string;
  corpNm?: string;
  posNm?: string;
  resNm?: string;
  message1?: string;
  message2?: string;
  message3?: string;
  message4?: string;
  message5?: string;
}

/** 로그인/서비스영역 전용 (인증 전 호출) */
export class PcOffAuthClient {
  constructor(private readonly baseUrl: string) {}

  private async post(endpoint: string, payload: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify([payload]);
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    if (!res.ok) throw new Error(`${endpoint} failed: ${res.status}`);
    return (await res.json()) as unknown;
  }

  /** 1단계: 전화번호로 서비스 영역 목록 조회 */
  async getPcOffServareaInfo(userMobileNo: string): Promise<ServareaInfoItem[]> {
    const raw = (await this.post("/getPcOffServareaInfo.do", { userMobileNo })) as unknown;

    // 내부 servareaList 등을 추출하는 헬퍼
    const extractList = (obj: unknown): ServareaInfoItem[] | null => {
      if (!obj || typeof obj !== "object") return null;
      const o = obj as Record<string, unknown>;
      const inner = o.list ?? o.data ?? o.servareaList ?? o.result;
      return Array.isArray(inner) ? (inner as ServareaInfoItem[]) : null;
    };

    // 1) 배열인 경우: 첫 번째 요소에 servareaList가 있으면 그걸 사용
    if (Array.isArray(raw)) {
      if (raw.length > 0) {
        const nested = extractList(raw[0]);
        if (nested) return nested;
      }
      // 배열 자체가 서비스영역 목록일 수도 있음
      return raw as ServareaInfoItem[];
    }

    // 2) 객체인 경우: list/data/servareaList/result 추출
    const extracted = extractList(raw);
    if (extracted) return extracted;

    // 3) 단일 객체면 배열로 감쌈
    return raw && typeof raw === "object" ? [raw as ServareaInfoItem] : [];
  }

  /** 2단계: 계정/비밀번호로 로그인 → userServareaId, userStaffId 반환 */
  async getPcOffLoginUserInfo(req: LoginRequest): Promise<LoginResponse> {
    const workYmd = req.workYmd ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const payload = {
      userMobileNo: req.userMobileNo,
      loginServareaId: req.loginServareaId,
      userServareaId: req.loginServareaId,
      loginUserId: req.loginUserId,
      loginPassword: req.loginPassword,
      workYmd
    };
    const raw = (await this.post("/getPcOffLoginUserInfo.do", payload)) as LoginResponse[] | LoginResponse;
    if (Array.isArray(raw)) return raw[0] ?? {};
    return raw ?? {};
  }
}

export class PcOffApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  private async post(endpoint: string, payload: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify([payload]);
    const res = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    if (!res.ok) throw new Error(`${endpoint} failed: ${res.status}`);
    return (await res.json()) as unknown;
  }

  /** FR-14: GET 요청 (전용 정책 API 등) */
  private async get(endpoint: string): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}${endpoint}`;
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${endpoint} failed: ${res.status}`);
    return (await res.json()) as unknown;
  }

  /**
   * FR-14: 전용 정책 API — 잠금화면·이석해제 비밀번호 등 고객사 정책 조회.
   * GET /api/v1/pcoff/tenants/{tenantId}/lock-policy
   * 서버 미구현 시 404 등으로 실패하므로 호출부에서 try/catch 후 기존 getLockScreenInfo·config 병합 유지.
   */
  async getLockPolicy(tenantId: string): Promise<TenantLockPolicy | null> {
    if (!tenantId?.trim()) return null;
    const path = `/api/v1/pcoff/tenants/${encodeURIComponent(tenantId.trim())}/lock-policy`;
    const raw = await this.get(path);
    return (raw ?? null) as TenantLockPolicy | null;
  }

  /**
   * FR-14: 이석 해제 비밀번호 검증 (leaveSeatUnlockRequirePassword=true 시 해제 전 호출).
   * POST /verifyLeaveSeatUnlock.do — 서버 미구현 시 404 등으로 실패 가능.
   */
  async verifyLeaveSeatUnlock(password: string, reason?: string): Promise<{ success: boolean; message?: string }> {
    const raw = await this.post("/verifyLeaveSeatUnlock.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId,
      password,
      reason: reason ?? ""
    });
    const res = (Array.isArray(raw) ? raw[0] : raw) as { success?: boolean; message?: string } | undefined;
    return { success: Boolean(res?.success), message: res?.message };
  }

  async getPcOffWorkTime(): Promise<WorkTimeResponse> {
    const json = (await this.post("/getPcOffWorkTime.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId
    })) as WorkTimeResponse | WorkTimeResponse[];
    if (Array.isArray(json)) return json[0] ?? {};
    return json;
  }

  /**
   * 고객사 잠금화면 설정 조회 (선택 API).
   * getPcOffWorkTime에 lockScreen* 미포함 시 이 API로 설정값 보강.
   * 응답 send_data를 WorkTimeResponse 형식으로 매핑한 객체를 반환(병합용).
   */
  async getLockScreenInfo(): Promise<Partial<WorkTimeResponse>> {
    const raw = (await this.post("/getLockScreenInfo.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId
    })) as GetLockScreenInfoResponse | GetLockScreenInfoResponse[];
    const res = Array.isArray(raw) ? raw[0] : raw;
    const list = res?.send_data ?? [];
    const out: Partial<WorkTimeResponse> = {};
    for (const item of list) {
      const t = (item.ScreenType ?? "").toLowerCase();
      if (t === "before") {
        if (item.LockTitle != null) out.lockScreenBeforeTitle = String(item.LockTitle);
        if (item.LockMessage != null) out.lockScreenBeforeMessage = String(item.LockMessage);
        if (item.Background != null) out.lockScreenBeforeBackground = String(item.Background);
        if (item.Logo != null) out.lockScreenBeforeLogo = String(item.Logo);
      } else if (t === "off") {
        if (item.LockTitle != null) out.lockScreenOffTitle = String(item.LockTitle);
        if (item.LockMessage != null) out.lockScreenOffMessage = String(item.LockMessage);
        if (item.Background != null) out.lockScreenOffBackground = String(item.Background);
        if (item.Logo != null) out.lockScreenOffLogo = String(item.Logo);
      } else if (t === "empty" || t === "leave") {
        if (item.LockTitle != null) out.lockScreenLeaveTitle = String(item.LockTitle);
        if (item.LockMessage != null) out.lockScreenLeaveMessage = String(item.LockMessage);
        if (item.Background != null) out.lockScreenLeaveBackground = String(item.Background);
        if (item.Logo != null) out.lockScreenLeaveLogo = String(item.Logo);
      }
    }
    return out;
  }

  async callCmmPcOnOffLogPrc(request: PcOnOffLogRequest): Promise<unknown> {
    return this.post("/callCmmPcOnOffLogPrc.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId,
      tmckButnCd: request.tmckButnCd,
      reason: request.reason ?? "",
      emergencyYn: request.emergencyYn ?? "N",
      eventName: request.eventName ?? "",
      recoder: request.recoder ?? "PC-OFF"
    });
  }

  async callPcOffTempDelay(pcOffYmdTime: string, extCount: number): Promise<unknown> {
    return this.post("/callPcOffTempDelay.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId,
      pcOffYmdTime,
      extCount
    });
  }

  async callPcOffEmergencyUse(request: EmergencyUseRequest): Promise<unknown> {
    const payload: Record<string, unknown> = {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId,
      emergencyUsePass: request.emergencyUsePass,
      reason: request.reason ?? ""
    };
    if (request.clickIp) payload.clickIp = request.clickIp;
    return this.post("/callPcOffEmergencyUse.do", payload);
  }

  /** FR-15: 긴급해제 — 비밀번호 검증 후 잠금 해제 */
  async callPcOffEmergencyUnlock(request: EmergencyUnlockRequest): Promise<EmergencyUnlockResponse> {
    const raw = await this.post("/callPcOffEmergencyUnlock.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId,
      password: request.password,
      reason: request.reason ?? ""
    });
    if (Array.isArray(raw)) return (raw[0] ?? { success: false }) as EmergencyUnlockResponse;
    return (raw ?? { success: false }) as EmergencyUnlockResponse;
  }
}

/** FR-12: 이석정보 서버 전송 */
export interface LeaveSeatReportRequest {
  eventType: "LEAVE_SEAT_START" | "LEAVE_SEAT_END";
  workSessionType: "NORMAL" | "TEMP_EXTEND" | "EMERGENCY_USE";
  leaveSeatSessionId: string;
  workSessionId?: string;
  reason?: string;
  reasonRequired?: boolean;
  occurredAt: string;
  clientVersion: string;
  workYmd: string;
  userServareaId: string;
  userStaffId: string;
  deviceId: string;
}

export interface LeaveSeatReportResponse {
  code?: string;
  message?: string;
  accepted?: boolean;
  eventId?: string;
  serverReceivedAt?: string;
}

export async function reportLeaveSeatEvent(
  baseUrl: string,
  payload: LeaveSeatReportRequest
): Promise<LeaveSeatReportResponse> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/reportLeaveSeatEvent.do`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([payload]),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`reportLeaveSeatEvent failed: ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json)) return (json[0] ?? {}) as LeaveSeatReportResponse;
  return json as LeaveSeatReportResponse;
}

/** FR-08: 에이전트 이벤트 로그 전송 (Ops Observer) */
export interface AgentEventPayload {
  events: Array<{
    timestamp: string;
    logCode: string;
    level: string;
    sessionId: string;
    deviceId: string;
    payload?: Record<string, unknown>;
  }>;
  deviceId: string;
  sessionId: string;
}

/** reportAgentEvents가 서버 HTTP 4xx/5xx로 실패했을 때 사용. 네트워크 단절이 아님. */
export class ReportAgentEventsHttpError extends Error {
  constructor(public readonly status: number) {
    super(`reportAgentEvents failed: ${status}`);
    this.name = "ReportAgentEventsHttpError";
  }
}

/**
 * 에이전트 이벤트(heartbeat, CRASH_DETECTED, OFFLINE_DETECTED 등)를 서버에 보고.
 * 서버에 "중지/충돌/통신단절" 기록이 남도록 함.
 * 엔드포인트: POST /reportAgentEvents.do
 * HTTP 4xx/5xx 시 ReportAgentEventsHttpError 던짐(통신 성공·오프라인 아님).
 */
export async function reportAgentEvents(
  baseUrl: string,
  payload: AgentEventPayload
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/reportAgentEvents.do`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new ReportAgentEventsHttpError(res.status);
}
