import { contextBridge, ipcRenderer } from "electron";

const api = {
  getAppState: () => ipcRenderer.invoke("pcoff:getAppState") as Promise<{ state: string }>,
  requestUpdateCheck: () => ipcRenderer.invoke("pcoff:requestUpdateCheck") as Promise<void>,
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
    }>
};

contextBridge.exposeInMainWorld("pcoffApi", api);

declare global {
  interface Window {
    pcoffApi: typeof api;
  }
}
