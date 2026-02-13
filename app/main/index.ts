import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, LOG_CODES } from "../core/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { FeatureStateMachine } from "../core/state-machine.js";
import { TelemetryLogger } from "../core/telemetry-log.js";
import { UpdateManager } from "../core/update-manager.js";
import { OpsObserver } from "../core/ops-observer.js";
import { PcOffApiClient, PcOffAuthClient, type WorkTimeResponse } from "../core/api-client.js";
import { loadRuntimeConfig, getApiBaseUrl, saveLoginState, clearLoginState } from "../core/runtime-config.js";

const baseDir = process.cwd();
const machine = new FeatureStateMachine();
const logger = new TelemetryLogger(baseDir, machine.getSessionId(), process.platform);
const updater = new UpdateManager(baseDir, logger);
const observer = new OpsObserver(logger);

function getTodayYmd(): string {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function buildMockWorkTime(): WorkTimeResponse {
  const ymd = getTodayYmd();
  return {
    pcOnYn: "Y",
    pcOnYmdTime: `${ymd}0830`,
    pcOffYmdTime: `${ymd}1830`,
    pcExCount: 1,
    pcExMaxCount: 3,
    pcExTime: 30,
    pcoffEmergencyYesNo: "YES"
  };
}

type ActionResult = {
  source: "api" | "mock" | "fallback";
  success: boolean;
  data?: unknown;
  error?: string;
};

async function getApiClient(): Promise<PcOffApiClient | null> {
  const runtimeConfig = await loadRuntimeConfig(baseDir);
  if (!runtimeConfig) return null;
  return new PcOffApiClient({
    baseUrl: runtimeConfig.apiBaseUrl,
    workYmd: getTodayYmd(),
    userServareaId: runtimeConfig.userServareaId,
    userStaffId: runtimeConfig.userStaffId
  });
}

function createMainWindow(): void {
  const preloadCandidates = [
    join(__dirname, "../preload/index.js"),
    join(process.cwd(), "dist/app/preload/index.js"),
    join(app.getAppPath(), "dist/app/preload/index.js")
  ];
  const preloadPath = preloadCandidates.find((p) => existsSync(p));
  const rendererPath = join(__dirname, "../../../app/renderer/index.html");
  const rendererFallback = join(process.cwd(), "app/renderer/index.html");
  const htmlPath = existsSync(rendererPath) ? rendererPath : rendererFallback;

  if (!preloadPath) {
    console.error("[PCOFF] Preload not found. Tried:", preloadCandidates);
  } else {
    console.info("[PCOFF] Preload:", preloadPath);
  }

  const win = new BrowserWindow({
    width: 960,
    height: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath ?? undefined
    }
  });
  win.loadFile(htmlPath);
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  await logger.write(LOG_CODES.APP_START, "INFO", { platform: process.platform });
  observer.startHeartbeat();
  createMainWindow();
});

app.on("window-all-closed", () => {
  observer.stopHeartbeat();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("pcoff:getAppState", async () => machine.getSnapshot());
ipcMain.handle("pcoff:requestUpdateCheck", async () => updater.checkAndApplySilently());

const LOGIN_PLACEHOLDERS = ["REPLACE_WITH_SERVAREA_ID", "REPLACE_WITH_STAFF_ID"];
function isRealLoginId(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  return v.length > 0 && !LOGIN_PLACEHOLDERS.includes(v);
}
ipcMain.handle("pcoff:hasLogin", async () => {
  const config = await loadRuntimeConfig(baseDir);
  const hasLogin = Boolean(
    config?.userServareaId && config?.userStaffId &&
    isRealLoginId(config.userServareaId) && isRealLoginId(config.userStaffId)
  );
  return { hasLogin };
});

ipcMain.handle("pcoff:getServareaInfo", async (_event, userMobileNo: string) => {
  const baseUrl = await getApiBaseUrl(baseDir);
  if (!baseUrl) return { success: false, error: "API 주소가 설정되지 않았습니다.", list: [] };
  try {
    const auth = new PcOffAuthClient(baseUrl);
    const list = await auth.getPcOffServareaInfo(userMobileNo ?? "");
    console.log("[PCOFF] getServareaInfo response:", JSON.stringify(list, null, 2));
    return { success: true, list };
  } catch (error) {
    console.error("[PCOFF] getServareaInfo error:", error);
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "getPcOffServareaInfo", error: String(error) });
    return { success: false, error: String(error), list: [] };
  }
});

ipcMain.handle(
  "pcoff:login",
  async (
    _event,
    payload: { userMobileNo: string; loginServareaId: string; loginUserId: string; loginPassword: string }
  ) => {
    const baseUrl = await getApiBaseUrl(baseDir);
    if (!baseUrl) return { success: false, error: "API 주소가 설정되지 않았습니다." };
    try {
      console.log("[PCOFF] login request:", JSON.stringify(payload, null, 2));
      const auth = new PcOffAuthClient(baseUrl);
      const res = await auth.getPcOffLoginUserInfo({
        userMobileNo: payload.userMobileNo,
        loginServareaId: payload.loginServareaId,
        loginUserId: payload.loginUserId,
        loginPassword: payload.loginPassword
      });
      console.log("[PCOFF] login response:", JSON.stringify(res, null, 2));
      const code = res.code ?? "";
      if (String(code) !== "1") {
        const errorMsg = res.msg ? decodeURIComponent(res.msg) : "로그인에 실패했습니다.";
        return { success: false, error: errorMsg };
      }
      const userServareaId = res.userServareaId ?? payload.loginServareaId;
      const userStaffId = res.userStaffId ?? "";
      if (!userStaffId) return { success: false, error: "사용자 정보를 가져올 수 없습니다." };
      await saveLoginState(baseDir, {
        userServareaId,
        userStaffId,
        loginUserId: res.loginUserId ?? payload.loginUserId,
        loginUserNm: res.loginUserNm
      });
      await logger.write("LOGIN_SUCCESS", "INFO", { loginUserId: payload.loginUserId });
      return {
        success: true,
        userServareaId,
        userStaffId,
        loginUserNm: res.loginUserNm
      };
    } catch (error) {
      await logger.write("LOGIN_FAIL", "WARN", { error: String(error) });
      return { success: false, error: String(error) };
    }
  }
);
ipcMain.handle("pcoff:logout", async () => {
  await clearLoginState(baseDir);
  await logger.write("LOGOUT", "INFO", {});
  return { success: true };
});
ipcMain.handle("pcoff:getWorkTime", async () => {
  const api = await getApiClient();
  if (!api) {
    return { source: "mock", data: buildMockWorkTime() };
  }

  try {
    const data = await api.getPcOffWorkTime();
    return { source: "api", data };
  } catch (error) {
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "getPcOffWorkTime", error: String(error) });
    return { source: "fallback", data: buildMockWorkTime(), error: String(error) };
  }
});

ipcMain.handle("pcoff:requestPcExtend", async (_event, payload: { pcOffYmdTime?: string }): Promise<ActionResult> => {
  const api = await getApiClient();
  if (!api) return { source: "mock", success: true };
  try {
    const pcOffYmdTime = payload.pcOffYmdTime ?? buildMockWorkTime().pcOffYmdTime ?? "";
    const data = await api.callPcOffTempDelay(pcOffYmdTime);
    await logger.write("LOCK_TRIGGERED", "INFO", { action: "pc_extend", pcOffYmdTime });
    return { source: "api", success: true, data };
  } catch (error) {
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffTempDelay", error: String(error) });
    return { source: "fallback", success: false, error: String(error) };
  }
});

ipcMain.handle("pcoff:requestEmergencyUse", async (_event, payload: { reason: string }): Promise<ActionResult> => {
  const api = await getApiClient();
  if (!api) return { source: "mock", success: true };
  try {
    const data = await api.callPcOffEmergencyUse({ reason: payload.reason || "긴급사용 요청" });
    await logger.write("UNLOCK_TRIGGERED", "INFO", { action: "emergency_use" });
    return { source: "api", success: true, data };
  } catch (error) {
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", error: String(error) });
    return { source: "fallback", success: false, error: String(error) };
  }
});

ipcMain.handle(
  "pcoff:requestPcOnOffLog",
  async (_event, payload: { tmckButnCd: "IN" | "OUT"; eventName?: string; reason?: string }): Promise<ActionResult> => {
    const api = await getApiClient();
    if (!api) return { source: "mock", success: true };
    try {
      const data = await api.callCmmPcOnOffLogPrc({
        tmckButnCd: payload.tmckButnCd,
        eventName: payload.eventName,
        reason: payload.reason,
        emergencyYn: "N"
      });
      return { source: "api", success: true, data };
    } catch (error) {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callCmmPcOnOffLogPrc", error: String(error) });
      return { source: "fallback", success: false, error: String(error) };
    }
  }
);
