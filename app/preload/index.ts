import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error" | "not-available";
  version?: string;
  progress?: number;
  error?: string;
}

export interface PasswordChangeEvent {
  detected: boolean;
  message?: string;
  confirmedAt?: string;
}

export interface GuardStatus {
  active: boolean;
  lastCheck: string | null;
  tamperEvents: TamperEvent[];
  protectedFiles: number;
  platform: NodeJS.Platform;
}

export interface TamperEvent {
  type: string;
  filePath?: string;
  originalHash?: string;
  currentHash?: string;
  detectedAt: string;
  recovered: boolean;
  recoveryStrategy?: string;
}

export type OperationMode = "NORMAL" | "TEMP_EXTEND" | "EMERGENCY_USE" | "EMERGENCY_RELEASE";

export interface TrayOperationInfo {
  reflectedAttendance: {
    basedAt: string | null;
    appliedPolicy: string;
  };
  myAttendance: {
    workStartTime?: string;
    workEndTime?: string;
    pcOnYn?: string;
    pcExCount?: number;
    pcExMaxCount?: number;
    pcExTime?: number;
    pcoffEmergencyYesNo?: string;
  };
  versionInfo: {
    appVersion: string;
    coreVersion: string;
    lastUpdatedAt: string;
  };
  mode: OperationMode;
  user?: {
    loginUserNm?: string;
    loginUserId?: string;
    posNm?: string;
    corpNm?: string;
  };
}

const api = {
  getAppState: () => ipcRenderer.invoke("pcoff:getAppState") as Promise<{ state: string }>,
  getCurrentUser: () =>
    ipcRenderer.invoke("pcoff:getCurrentUser") as Promise<{
      loginUserNm?: string;
      loginUserId?: string;
      posNm?: string;
      corpNm?: string;
    }>,
  requestUpdateCheck: () => ipcRenderer.invoke("pcoff:requestUpdateCheck") as Promise<UpdateStatus>,
  getUpdateStatus: () => ipcRenderer.invoke("pcoff:getUpdateStatus") as Promise<UpdateStatus>,
  getAppVersion: () => ipcRenderer.invoke("pcoff:getAppVersion") as Promise<string>,
  onUpdateProgress: (callback: (data: { percent: number }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { percent: number }) => callback(data);
    ipcRenderer.on("pcoff:update-progress", handler);
    return () => ipcRenderer.removeListener("pcoff:update-progress", handler);
  },
  getWorkTime: () =>
    ipcRenderer.invoke("pcoff:getWorkTime") as Promise<{
      source: "api" | "mock" | "fallback";
      data: Record<string, unknown>;
      error?: string;
    }>,
  requestPcExtend: (pcOffYmdTime?: string) =>
    ipcRenderer.invoke("pcoff:requestPcExtend", { pcOffYmdTime }) as Promise<{
      source: "api" | "mock" | "fallback";
      success: boolean;
      data?: unknown;
      error?: string;
    }>,
  requestEmergencyUse: (reason: string) =>
    ipcRenderer.invoke("pcoff:requestEmergencyUse", { reason }) as Promise<{
      source: "api" | "mock" | "fallback";
      success: boolean;
      data?: unknown;
      error?: string;
    }>,
  requestPcOnOffLog: (tmckButnCd: "IN" | "OUT", eventName: string, reason = "") =>
    ipcRenderer.invoke("pcoff:requestPcOnOffLog", { tmckButnCd, eventName, reason }) as Promise<{
      source: "api" | "mock" | "fallback";
      success: boolean;
      data?: unknown;
      error?: string;
    }>,
  hasLogin: () => ipcRenderer.invoke("pcoff:hasLogin") as Promise<{ hasLogin: boolean }>,
  getServareaInfo: (userMobileNo: string) =>
    ipcRenderer.invoke("pcoff:getServareaInfo", userMobileNo) as Promise<{
      success: boolean;
      list: Array<{ servareaId?: string; servareaNm?: string; userServareaId?: string }>;
      error?: string;
    }>,
  logout: () => ipcRenderer.invoke("pcoff:logout") as Promise<{ success: boolean }>,
  login: (payload: {
    userMobileNo: string;
    loginServareaId: string;
    loginUserId: string;
    loginPassword: string;
  }) =>
    ipcRenderer.invoke("pcoff:login", payload) as Promise<{
      success: boolean;
      error?: string;
      userServareaId?: string;
      userStaffId?: string;
      loginUserNm?: string;
    }>,
  // FR-04: 비밀번호 변경 확인 (검증 없이 확인만)
  getPasswordChangeState: () =>
    ipcRenderer.invoke("pcoff:getPasswordChangeState") as Promise<PasswordChangeEvent>,
  confirmPasswordChange: () =>
    ipcRenderer.invoke("pcoff:confirmPasswordChange") as Promise<{ success: boolean }>,
  onPasswordChangeDetected: (callback: (data: { message: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { message: string }) => callback(data);
    ipcRenderer.on("pcoff:password-change-detected", handler);
    return () => ipcRenderer.removeListener("pcoff:password-change-detected", handler);
  },
  // FR-07: Agent Guard
  getGuardStatus: () =>
    ipcRenderer.invoke("pcoff:getGuardStatus") as Promise<GuardStatus>,
  getGuardTamperEvents: () =>
    ipcRenderer.invoke("pcoff:getGuardTamperEvents") as Promise<TamperEvent[]>,
  verifyIntegrity: () =>
    ipcRenderer.invoke("pcoff:verifyIntegrity") as Promise<{ valid: boolean; status: GuardStatus }>,
  onTamperDetected: (callback: (data: TamperEvent) => void) => {
    const handler = (_event: IpcRendererEvent, data: TamperEvent) => callback(data);
    ipcRenderer.on("pcoff:tamper-detected", handler);
    return () => ipcRenderer.removeListener("pcoff:tamper-detected", handler);
  },

  // 트레이 작동정보 조회 (에이전트 정보 화면용)
  getTrayOperationInfo: () =>
    ipcRenderer.invoke("pcoff:getTrayOperationInfo") as Promise<TrayOperationInfo>,
  refreshMyAttendance: () =>
    ipcRenderer.invoke("pcoff:refreshMyAttendance") as Promise<Record<string, unknown>>,
  getOperationMode: () =>
    ipcRenderer.invoke("pcoff:getOperationMode") as Promise<{ mode: OperationMode }>,
  onModeChanged: (callback: (data: { mode: OperationMode }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { mode: OperationMode }) => callback(data);
    ipcRenderer.on("pcoff:mode-changed", handler);
    return () => ipcRenderer.removeListener("pcoff:mode-changed", handler);
  },

  // 창 제어
  /** 사용시간 종료(pcOnYn=N)일 때만 잠금화면 열기. 로그인 성공 후 호출 */
  checkLockAndShow: () =>
    ipcRenderer.invoke("pcoff:checkLockAndShow") as Promise<{ lockOpened: boolean }>,
  openLockWindow: () => ipcRenderer.invoke("pcoff:openLockWindow") as Promise<{ success: boolean }>,
  closeCurrentWindow: () => ipcRenderer.invoke("pcoff:closeCurrentWindow") as Promise<{ success: boolean }>,

  // 로그 이벤트 (선택적)
  logEvent: (code: string, payload: Record<string, unknown>) =>
    ipcRenderer.invoke("pcoff:logEvent", { code, payload }) as Promise<void>
};

contextBridge.exposeInMainWorld("pcoffApi", api);

declare global {
  interface Window {
    pcoffApi: typeof api;
  }
}
