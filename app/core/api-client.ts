export interface WorkTimeResponse {
  pcOnYn?: "Y" | "N";
  pcOnYmdTime?: string;
  pcOffYmdTime?: string;
  pcOnMsg?: string;
  pcExCount?: number;
  pcExMaxCount?: number;
  pcExTime?: number;
  leaveSeatOffInputMath?: string;
  leaveSeatReasonYn?: "YES" | "NO";
  leaveSeatReasonManYn?: "YES" | "NO";
  pcoffEmergencyYesNo?: "YES" | "NO";
  leaveSeatUseYn?: "Y" | "N";
  emergencyUseYesNo?: "YES" | "NO";
  /** 비밀번호 변경 필요 여부 (서버에서 플래그 제공 시) */
  pwdChgYn?: "Y" | "N";
  /** 비밀번호 변경 메시지 */
  pwdChgMsg?: string;
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
  reason: string;
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
  userServareaId?: string;
  userStaffId?: string;
  loginUserId?: string;
  loginUserNm?: string;
  corpNm?: string;
  posNm?: string;
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

  async getPcOffWorkTime(): Promise<WorkTimeResponse> {
    const json = (await this.post("/getPcOffWorkTime.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId
    })) as WorkTimeResponse | WorkTimeResponse[];
    if (Array.isArray(json)) return json[0] ?? {};
    return json;
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
      recoder: request.recoder ?? "PC-OFF(Electron)"
    });
  }

  async callPcOffTempDelay(pcOffYmdTime: string): Promise<unknown> {
    return this.post("/callPcOffTempDelay.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId,
      pcOffYmdTime
    });
  }

  async callPcOffEmergencyUse(request: EmergencyUseRequest): Promise<unknown> {
    return this.post("/callPcOffEmergencyUse.do", {
      workYmd: this.config.workYmd,
      userServareaId: this.config.userServareaId,
      userStaffId: this.config.userStaffId,
      reason: request.reason
    });
  }
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

/**
 * 에이전트 이벤트(heartbeat, CRASH_DETECTED, OFFLINE_DETECTED 등)를 서버에 보고.
 * 서버에 "중지/충돌/통신단절" 기록이 남도록 함.
 * 엔드포인트: POST /reportAgentEvents.do
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
  if (!res.ok) throw new Error(`reportAgentEvents failed: ${res.status}`);
}
