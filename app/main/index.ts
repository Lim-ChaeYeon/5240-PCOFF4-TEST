import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, globalShortcut } from "electron";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, LOG_CODES } from "../core/constants.js";

// ESM에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { FeatureStateMachine } from "../core/state-machine.js";
import { TelemetryLogger } from "../core/telemetry-log.js";
import { UpdateManager } from "../core/update-manager.js";
import { OpsObserver } from "../core/ops-observer.js";
import { AuthPolicy } from "../core/auth-policy.js";
import { AgentGuard } from "../core/agent-guard.js";
import { PcOffApiClient, PcOffAuthClient, type WorkTimeResponse } from "../core/api-client.js";
import {
  loadRuntimeConfig,
  getApiBaseUrl,
  saveLoginState,
  clearLoginState,
  getLoginUserDisplay
} from "../core/runtime-config.js";

const baseDir = process.cwd();

// 윈도우 관리: 모든 화면(작동정보·로그인·잠금)을 하나의 창에서 전환
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// 현재 운영 모드
type OperationMode = "NORMAL" | "TEMP_EXTEND" | "EMERGENCY_USE" | "EMERGENCY_RELEASE";
let currentMode: OperationMode = "NORMAL";
let lastWorkTimeData: Record<string, unknown> = {};
let lastWorkTimeFetchedAt: string | null = null;

const machine = new FeatureStateMachine();
const logger = new TelemetryLogger(baseDir, machine.getSessionId(), process.platform);
const updater = new UpdateManager(baseDir, logger);
const observer = new OpsObserver(logger, () => getApiBaseUrl(baseDir));
const authPolicy = new AuthPolicy(logger);
const guard = new AgentGuard(baseDir, logger);

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

function getPreloadPath(): string | undefined {
  const preloadCandidates = [
    join(__dirname, "../preload/index.js"),
    join(process.cwd(), "dist/app/preload/index.js"),
    join(app.getAppPath(), "dist/app/preload/index.js")
  ];
  const preloadPath = preloadCandidates.find((p) => existsSync(p));
  if (!preloadPath) {
    console.error("[PCOFF] Preload not found. Tried:", preloadCandidates);
  } else {
    console.info("[PCOFF] Preload:", preloadPath);
  }
  return preloadPath;
}

function getRendererPath(htmlFile: string): string {
  const candidates = [
    join(__dirname, `../../../app/renderer/${htmlFile}`),
    join(process.cwd(), "app/renderer", htmlFile),
    join(process.cwd(), "build", htmlFile),
    join(app.getAppPath(), "app/renderer", htmlFile)
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  const fallback = join(process.cwd(), "app/renderer", htmlFile);
  console.warn("[PCOFF] Renderer path not found, using fallback:", fallback);
  return fallback;
}

/**
 * 트레이에서 열리는 에이전트 정보 화면 (main.html)
 * 버튼 없이 정보 조회만 가능
 */
function createTrayInfoWindow(): void {
  const htmlPath = getRendererPath("main.html");
  console.info("[PCOFF] Opening tray info window:", htmlPath);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(560, 760);
    mainWindow.setTitle("PCOFF 작동정보");
    mainWindow.loadFile(htmlPath);
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 560,
    height: 760,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    show: false,
    title: "PCOFF 작동정보",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath()
    }
  });
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
  });
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  win.loadFile(htmlPath).catch((err) => {
    console.error("[PCOFF] Failed to load main.html:", err);
    win.show();
    win.focus();
  });
  void logger.write("TRAY_INFO_OPENED", "INFO", {});
}

/**
 * 잠금화면 (lock.html)
 * 로그인 창과 같은 창을 재사용해 새 창이 뜨지 않도록 함.
 */
function createLockWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(960, 640);
    mainWindow.setTitle("PCOFF 잠금화면");
    mainWindow.loadFile(getRendererPath("lock.html"));
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 960,
    height: 640,
    resizable: false,
    minimizable: true,
    closable: true,
    fullscreenable: true,
    title: "PCOFF 잠금화면",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath()
    }
  });
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
  });
  win.loadFile(getRendererPath("lock.html"));
}

/** 같은 창에 잠금 화면 로드 (로그인 → 잠금 전환 시 새 창 안 띄움) */
function showLockInWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  mainWindow = win;
  win.setSize(960, 640);
  win.setTitle("PCOFF 잠금화면");
  win.loadFile(getRendererPath("lock.html"));
  win.show();
  win.focus();
}

/** 전역 핫키용 로그아웃: 로그인 정보 삭제 후 로그인 창만 표시 */
async function doGlobalLogout(): Promise<void> {
  await clearLoginState(baseDir);
  await logger.write("LOGOUT", "INFO", { source: "globalShortcut" });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    mainWindow = null;
  }
  createLoginWindow();
}

/**
 * 로그인 화면 (index.html)
 * 잠금화면과 같은 창(mainWindow) 재사용 — 로그인 후 잠금 시 같은 창에서 전환
 */
function createLoginWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(480, 560);
    mainWindow.setTitle("PCOFF 로그인");
    mainWindow.loadFile(getRendererPath("index.html"));
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    title: "PCOFF 로그인",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath()
    }
  });
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
  });
  win.loadFile(getRendererPath("index.html"));
}

/** 트레이용 fallback 아이콘 (16x16, 단색) — assets/tray-icon.png 없을 때 사용. 맥 메뉴 막대에 보이도록 */
const TRAY_FALLBACK_ICON_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVQ4T2NkYGD4z0ABYBw1gGE0DBgGNAwYpjQMAPEGA0sH0bTnAAAAAElFTkSuQmCC";

/**
 * 시스템 트레이 생성
 */
function createTray(): void {
  if (tray) return;

  // 트레이 아이콘 (assets/tray-icon.png 우선, 없으면 fallback으로 맥/윈도우 모두 표시)
  const iconPath = join(__dirname, "../../../assets/tray-icon.png");
  let icon: Electron.NativeImage;
  if (existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // 파일 없을 때: 빈 아이콘은 맥 메뉴 막대에 안 보이므로 fallback 사용
    icon = nativeImage.createFromDataURL(TRAY_FALLBACK_ICON_DATA);
  }

  // 맥 메뉴 막대: 단색 아이콘을 템플릿으로 쓰면 라이트/다크 자동 반전
  if (process.platform === "darwin" && typeof (icon as Electron.NativeImage & { setTemplateImage?: (v: boolean) => void }).setTemplateImage === "function") {
    (icon as Electron.NativeImage & { setTemplateImage: (v: boolean) => void }).setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip("5240 PCOFF Agent - 클릭 또는 메뉴에서 'PCOFF 작동정보' 선택");
  updateTrayMenu();

  tray.on("click", () => {
    createTrayInfoWindow();
  });
  tray.on("double-click", () => {
    createTrayInfoWindow();
  });
}

function updateTrayMenu(): void {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "PCOFF 작동정보",
      click: () => createTrayInfoWindow()
    },
    {
      label: "잠금화면 열기",
      click: () => createLockWindow()
    },
    { type: "separator" },
    {
      label: "로그 폴더 열기",
      click: () => {
        const logsPath = join(baseDir, "logs");
        void shell.openPath(logsPath);
      }
    },
    { type: "separator" },
    {
      label: `현재 모드: ${getModeLabel(currentMode)}`,
      enabled: false
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
}

function getModeLabel(mode: OperationMode): string {
  switch (mode) {
    case "NORMAL": return "일반";
    case "TEMP_EXTEND": return "임시연장";
    case "EMERGENCY_USE": return "긴급사용";
    case "EMERGENCY_RELEASE": return "긴급해제";
    default: return mode;
  }
}

function setOperationMode(mode: OperationMode): void {
  if (currentMode === mode) return;
  const prevMode = currentMode;
  currentMode = mode;
  void logger.write("TRAY_MODE_CHANGED", "INFO", { from: prevMode, to: mode });
  updateTrayMenu();
  
  // 모드 변경 시 모든 창에 알림
  const windows = mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : [];
  for (const win of windows) {
    win?.webContents.send("pcoff:mode-changed", { mode });
  }
}

/** 서버 근태 기준 잠금 필요 여부: pcOnYn === "N" 이면 사용시간 종료(잠금) */
async function isLockRequired(): Promise<boolean> {
  const api = await getApiClient();
  if (!api) {
    return false;
  }
  try {
    const data = await api.getPcOffWorkTime();
    lastWorkTimeData = data as unknown as Record<string, unknown>;
    lastWorkTimeFetchedAt = new Date().toISOString();
    return data.pcOnYn === "N";
  } catch {
    return false;
  }
}

/** 잠금 필요 시 잠금화면 표시. reuseWindow 있으면 그 창에 로드(새 창 X) */
async function checkLockAndShowLockWindow(reuseWindow?: BrowserWindow | null): Promise<boolean> {
  const locked = await isLockRequired();
  if (!locked) return false;
  if (reuseWindow && !reuseWindow.isDestroyed()) {
    showLockInWindow(reuseWindow);
    void logger.write("LOCK_TRIGGERED", "INFO", { reason: "usage_time_ended" });
    return true;
  }
  createLockWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    void logger.write("LOCK_TRIGGERED", "INFO", { reason: "usage_time_ended" });
  }
  return true;
}

let lockCheckIntervalId: ReturnType<typeof setInterval> | null = null;
const LOCK_CHECK_INTERVAL_MS = 60_000; // 1분

function startLockCheckInterval(): void {
  if (lockCheckIntervalId) return;
  lockCheckIntervalId = setInterval(() => {
    void checkLockAndShowLockWindow();
  }, LOCK_CHECK_INTERVAL_MS);
}

function stopLockCheckInterval(): void {
  if (lockCheckIntervalId) {
    clearInterval(lockCheckIntervalId);
    lockCheckIntervalId = null;
  }
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  await logger.write(LOG_CODES.APP_START, "INFO", { platform: process.platform });
  // FR-08: Ops Observer 시작 (heartbeat + 로그 서버 전송)
  observer.start();
  // FR-07: Agent Guard 시작 (무결성 감시)
  await guard.start();
  
  // 시스템 트레이 생성
  createTray();

  // 전역 핫키 (맥에서 트레이가 안 보여도 동작)
  globalShortcut.register("CommandOrControl+Shift+L", () => {
    void doGlobalLogout();
  });
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    createTrayInfoWindow();
  });
  globalShortcut.register("CommandOrControl+Shift+K", () => {
    createLockWindow();
  });

  // 로그인 상태 확인 후 적절한 창 열기
  const config = await loadRuntimeConfig(baseDir);
  const hasLogin = Boolean(
    config?.userServareaId && config?.userStaffId &&
    isRealLoginId(config.userServareaId) && isRealLoginId(config.userStaffId)
  );
  
  if (hasLogin) {
    // 사용시간 종료(pcOnYn=N)일 때만 잠금화면 표시
    const lockOpened = await checkLockAndShowLockWindow();
    startLockCheckInterval(); // 주기 검사로 사용시간 종료 시 잠금화면 자동 오픈
    // 잠금이 아니면 에이전트 화면을 먼저 열어서 사용자가 바로 정보를 볼 수 있게 함
    if (!lockOpened) {
      createTrayInfoWindow();
    }
  } else {
    // 로그인 필요: 로그인 창 표시
    createLoginWindow();
  }
});

app.on("window-all-closed", () => {
  // 트레이 앱이므로 창이 모두 닫혀도 앱은 종료하지 않음
  // macOS에서는 기본적으로 앱이 Dock에 유지됨
});

// macOS: Dock 아이콘 클릭 시 창이 없으면 에이전트 화면 열기
app.on("activate", () => {
  const hasVisibleWindow =
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  if (!hasVisibleWindow) {
    createTrayInfoWindow();
  } else {
    mainWindow!.show();
    mainWindow!.focus();
  }
});

app.on("before-quit", async () => {
  globalShortcut.unregisterAll();
  stopLockCheckInterval();
  observer.stop();
  await guard.stop();
});

// FR-08: 비정상 종료 시 서버에 CRASH_DETECTED 보고
process.on("uncaughtException", (err) => {
  void observer.reportCrash(err).then(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  void observer.reportCrash(String(reason)).then(() => process.exit(1));
});

ipcMain.handle("pcoff:getAppState", async () => machine.getSnapshot());
ipcMain.handle("pcoff:getCurrentUser", async () => getLoginUserDisplay(baseDir));
ipcMain.handle("pcoff:requestUpdateCheck", async () => {
  const status = await updater.checkAndApplySilently();
  return status;
});
ipcMain.handle("pcoff:getUpdateStatus", async () => updater.getStatus());
ipcMain.handle("pcoff:getAppVersion", async () => updater.getAppVersion());

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
        loginUserNm: res.loginUserNm,
        posNm: res.posNm,
        corpNm: res.corpNm
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
    
    // 캐시 업데이트
    lastWorkTimeData = data as Record<string, unknown>;
    lastWorkTimeFetchedAt = new Date().toISOString();
    
    // FR-04: 비밀번호 변경 감지
    if (data.pwdChgYn === "Y") {
      await authPolicy.onPasswordChangeDetected("getPcOffWorkTime", data.pwdChgMsg);
      // Renderer에 비밀번호 변경 이벤트 전송 (모든 창에)
      const windows = mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : [];
      for (const win of windows) {
        win?.webContents.send("pcoff:password-change-detected", {
          message: data.pwdChgMsg || "비밀번호가 변경되었습니다. 확인 버튼을 눌러주세요.",
        });
      }
    }
    
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
    // 긴급사용 성공 시 잠금 해제 → 작동정보 화면으로 전환
    createTrayInfoWindow();
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
      // PC-ON 시 잠금화면 → 작동정보 화면으로 전환
      if (payload.tmckButnCd === "IN") {
        createTrayInfoWindow();
      }
      return { source: "api", success: true, data };
    } catch (error) {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callCmmPcOnOffLogPrc", error: String(error) });
      return { source: "fallback", success: false, error: String(error) };
    }
  }
);

// FR-04: 비밀번호 변경 확인 (검증 없이 확인만)
ipcMain.handle("pcoff:getPasswordChangeState", async () => {
  return authPolicy.getPasswordChangeState();
});

ipcMain.handle("pcoff:confirmPasswordChange", async () => {
  const userInfo = await getLoginUserDisplay(baseDir);
  const userId = userInfo?.loginUserId || "unknown";
  await authPolicy.confirmPasswordChange(userId);
  return { success: true };
});

// FR-07: Agent Guard IPC
ipcMain.handle("pcoff:getGuardStatus", async () => {
  return guard.getStatus();
});

ipcMain.handle("pcoff:getGuardTamperEvents", async () => {
  return guard.getTamperEvents();
});

ipcMain.handle("pcoff:verifyIntegrity", async () => {
  const valid = await guard.verifyIntegrity();
  return { valid, status: guard.getStatus() };
});

// 트레이 작동정보 조회 IPC
ipcMain.handle("pcoff:getTrayOperationInfo", async () => {
  const userInfo = await getLoginUserDisplay(baseDir);
  
  return {
    reflectedAttendance: {
      basedAt: lastWorkTimeFetchedAt,
      appliedPolicy: lastWorkTimeData.screenType || "일반"
    },
    myAttendance: {
      workStartTime: lastWorkTimeData.pcOnYmdTime,
      workEndTime: lastWorkTimeData.pcOffYmdTime,
      pcOnYmdTime: lastWorkTimeData.pcOnYmdTime,
      pcOffYmdTime: lastWorkTimeData.pcOffYmdTime,
      pcOnYn: lastWorkTimeData.pcOnYn,
      screenType: lastWorkTimeData.screenType,
      pcExCount: lastWorkTimeData.pcExCount,
      pcExMaxCount: lastWorkTimeData.pcExMaxCount,
      pcExTime: lastWorkTimeData.pcExTime,
      pcoffEmergencyYesNo: lastWorkTimeData.pcoffEmergencyYesNo
    },
    versionInfo: {
      appVersion: updater.getAppVersion(),
      coreVersion: updater.getAppVersion(),
      lastUpdatedAt: new Date().toISOString()
    },
    mode: currentMode,
    user: userInfo
  };
});

ipcMain.handle("pcoff:refreshMyAttendance", async () => {
  const api = await getApiClient();
  if (!api) {
    const mockData = buildMockWorkTime();
    lastWorkTimeData = mockData as unknown as Record<string, unknown>;
    lastWorkTimeFetchedAt = new Date().toISOString();
    return mockData;
  }

  try {
    const data = await api.getPcOffWorkTime();
    lastWorkTimeData = data as unknown as Record<string, unknown>;
    lastWorkTimeFetchedAt = new Date().toISOString();
    await logger.write("TRAY_ATTENDANCE_REFRESHED", "INFO", {});
    return data;
  } catch (error) {
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "refreshMyAttendance", error: String(error) });
    throw error;
  }
});

ipcMain.handle("pcoff:setOperationMode", async (_event, mode: OperationMode) => {
  setOperationMode(mode);
  return { success: true, mode: currentMode };
});

ipcMain.handle("pcoff:getOperationMode", async () => {
  return { mode: currentMode };
});

// 로그인 성공 후: 사용시간 종료(pcOnYn=N)일 때만 잠금화면 표시 (호출한 창을 재사용해 새 창 안 띄움)
ipcMain.handle("pcoff:checkLockAndShow", async (event) => {
  const reuseWin = BrowserWindow.fromWebContents(event.sender);
  const lockOpened = await checkLockAndShowLockWindow(reuseWin ?? undefined);
  startLockCheckInterval(); // 로그인 직후부터 주기 검사 시작
  return { lockOpened };
});

// 수동으로 잠금화면 창 열기 (트레이 메뉴 등)
ipcMain.handle("pcoff:openLockWindow", async () => {
  createLockWindow();
  return { success: true };
});

// 현재 열린 창 닫기 (로그인 완료 후 사용)
ipcMain.handle("pcoff:closeCurrentWindow", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  return { success: true };
});

// 로그 이벤트 기록
ipcMain.handle("pcoff:logEvent", async (_event, payload: { code: string; payload: Record<string, unknown> }) => {
  await logger.write(payload.code, "INFO", payload.payload);
});
