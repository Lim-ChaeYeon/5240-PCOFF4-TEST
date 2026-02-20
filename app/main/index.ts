import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, globalShortcut } from "electron";
import type { LeaveSeatDetectedReason } from "../core/leave-seat-detector.js";
import { LeaveSeatDetector } from "../core/leave-seat-detector.js";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
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
import {
  loadOrCreateInstallerRegistry,
  syncInstallerRegistry
} from "../core/installer-registry.js";

/** 개발 시: 프로젝트 디렉터리, 설치 앱: userData(설치 앱 전용 상태·로그 분리) */
let baseDir = process.cwd();

// 윈도우 관리: 모든 화면(작동정보·로그인·잠금)을 하나의 창에서 전환
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// 현재 화면 상태 추적 (닫기 방지 정책 결정에 사용)
type ScreenType = "login" | "lock" | "tray-info";
let currentScreen: ScreenType = "login";

// 현재 운영 모드
type OperationMode = "NORMAL" | "TEMP_EXTEND" | "EMERGENCY_USE" | "EMERGENCY_RELEASE";
let currentMode: OperationMode = "NORMAL";
let lastWorkTimeData: Record<string, unknown> = {};
let lastWorkTimeFetchedAt: string | null = null;

/** 로컬 이석 감지(유휴/절전)로 잠금된 경우: 감지 시각·사유. PC-ON 해제 시 클리어 */
let localLeaveSeatDetectedAt: Date | null = null;
let localLeaveSeatReason: LeaveSeatDetectedReason | null = null;
const leaveSeatDetector = new LeaveSeatDetector();

const machine = new FeatureStateMachine();
/** whenReady()에서 baseDir 설정 후 초기화됨 (설치 앱은 userData 사용) */
let logger: TelemetryLogger;
let updater: UpdateManager;
let observer: OpsObserver;
let authPolicy: AuthPolicy;
let guard: AgentGuard;

function getTodayYmd(): string {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Date → YYYYMMDDHHmm (이석 감지 시각 등) */
function formatYmdHm(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}${h}${min}`;
}

/** 터미널에 설정/로드된 값 출력 (디버깅·확인용) */
function logLoadedConfig(label: string, payload: Record<string, unknown>): void {
  console.log("[PCOFF] 설정값:", label, JSON.stringify(payload, null, 2));
}

/** API 응답이 "YES"/"NO" 또는 "Y"/"N" 둘 다 올 수 있음 → 이석 정책은 "Y"|"N"만 사용 */
function normalizeLeaveSeatUseYn(value: unknown): "Y" | "N" {
  const v = String(value ?? "").toUpperCase();
  if (v === "Y" || v === "YES") return "Y";
  return "N";
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
  const appPath = app.getAppPath();
  const preloadCandidates = app.isPackaged
    ? [
        join(appPath, "dist/app/preload/index.js"),
        join(__dirname, "../preload/index.js")
      ]
    : [
        join(__dirname, "../preload/index.js"),
        join(process.cwd(), "dist/app/preload/index.js"),
        join(appPath, "dist/app/preload/index.js")
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
  const appPath = app.getAppPath();
  const candidates = app.isPackaged
    ? [
        join(appPath, "app/renderer", htmlFile),
        join(__dirname, `../../../app/renderer/${htmlFile}`)
      ]
    : [
        join(__dirname, `../../../app/renderer/${htmlFile}`),
        join(process.cwd(), "app/renderer", htmlFile),
        join(process.cwd(), "build", htmlFile),
        join(appPath, "app/renderer", htmlFile)
      ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  const fallback = join(appPath, "app/renderer", htmlFile);
  console.warn("[PCOFF] Renderer path not found, using fallback:", fallback);
  return fallback;
}

/**
 * mainWindow close 이벤트 핸들러 부착
 * - lock 화면: 닫기 완전 차단 (잠금 우회 방지)
 * - tray-info 화면: 트레이로 숨김 (앱 유지)
 * - login 화면: 일반 닫기 허용
 */
function attachMainWindowCloseHandler(win: BrowserWindow): void {
  win.on("close", (e) => {
    if (currentScreen === "lock") {
      e.preventDefault();   // 잠금화면 닫기 완전 차단
      return;
    }
    if (currentScreen === "tray-info") {
      e.preventDefault();   // 작동정보는 닫기 대신 트레이로 숨김
      win.hide();
      return;
    }
    // login: 그냥 닫히도록 허용
  });
  win.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * 트레이에서 열리는 에이전트 정보 화면 (main.html)
 * 버튼 없이 정보 조회만 가능.
 * 화면 오픈 시 잠금 필요(종업 시간 경과 등)면 잠금화면을 먼저 표시한다.
 * Windows: setAlwaysOnTop으로 창을 앞으로 가져옴.
 */
async function createTrayInfoWindow(): Promise<void> {
  try {
  // 종업 시간 경과 등으로 잠금 필요 시 작동정보 대신 잠금화면 표시
  const lockShown = await checkLockAndShowLockWindow(mainWindow ?? undefined);
  if (lockShown) return;

  const htmlPath = getRendererPath("main.html");
  console.info("[PCOFF] Opening tray info window:", htmlPath);

  if (mainWindow && !mainWindow.isDestroyed()) {
    currentScreen = "tray-info";
    mainWindow.setSize(560, 760);
    mainWindow.setTitle("PCOFF 작동정보");
    // Windows: 먼저 창을 보이게 한 뒤 로드해 트레이 클릭 시 바로 창이 보이도록
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === "win32") {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.focus();
    }
    mainWindow.loadFile(htmlPath);
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
  currentScreen = "tray-info";
  attachMainWindowCloseHandler(win);
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
    if (process.platform === "win32") {
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
      win.focus();
    }
  });
  win.loadFile(htmlPath).catch((err) => {
    console.error("[PCOFF] Failed to load main.html:", err);
    win.show();
    win.focus();
    if (process.platform === "win32") {
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
      win.focus();
    }
  });
  void logger.write("TRAY_INFO_OPENED", "INFO", {});
  } catch (err) {
    console.error("[PCOFF] createTrayInfoWindow failed:", err);
  }
}

/**
 * 잠금화면 (lock.html)
 * 로그인 창과 같은 창을 재사용해 새 창이 뜨지 않도록 함.
 */
function createLockWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    currentScreen = "lock";
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
    closable: false,   // 잠금 중 닫기 버튼 비활성화
    fullscreenable: true,
    title: "PCOFF 잠금화면",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath()
    }
  });
  mainWindow = win;
  currentScreen = "lock";
  attachMainWindowCloseHandler(win);
  win.loadFile(getRendererPath("lock.html"));
}

/** 같은 창에 잠금 화면 로드 (로그인 → 잠금 전환 시 새 창 안 띄움) */
function showLockInWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  mainWindow = win;
  currentScreen = "lock";
  win.setSize(960, 640);
  win.setTitle("PCOFF 잠금화면");
  win.loadFile(getRendererPath("lock.html"));
  win.show();
  win.focus();
}

/** 로컬 이석 감지(유휴/절전) 시 잠금화면 표시 */
function showLockForLocalLeaveSeat(detectedAt: Date, reason: LeaveSeatDetectedReason): void {
  localLeaveSeatDetectedAt = detectedAt;
  localLeaveSeatReason = reason;

  if (mainWindow && !mainWindow.isDestroyed()) {
    showLockInWindow(mainWindow);
    mainWindow.show();
    mainWindow.focus();
  } else {
    createLockWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

/** 전역 핫키용 로그아웃: 로그인 정보 삭제 후 로그인 창 전환 */
async function doGlobalLogout(): Promise<void> {
  await clearLoginState(baseDir);
  await logger.write("LOGOUT", "INFO", { source: "globalShortcut" });
  // 잠금화면 닫기 방지 이벤트를 우회하기 위해 close 대신 화면 전환
  createLoginWindow();
}

/**
 * 로그인 화면 (index.html)
 * 잠금화면과 같은 창(mainWindow) 재사용 — 로그인 후 잠금 시 같은 창에서 전환
 */
function createLoginWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    currentScreen = "login";
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
  currentScreen = "login";
  attachMainWindowCloseHandler(win);
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

  // 트레이 아이콘 (설치 앱: app.getAppPath() 기준, 없으면 fallback)
  const appPath = app.getAppPath();
  const iconCandidates = app.isPackaged
    ? [join(appPath, "assets/tray-icon.png"), join(__dirname, "../../../assets/tray-icon.png")]
    : [join(__dirname, "../../../assets/tray-icon.png"), join(process.cwd(), "assets/tray-icon.png")];
  const iconPath = iconCandidates.find((p) => existsSync(p));
  let icon: Electron.NativeImage;
  if (iconPath) {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createFromDataURL(TRAY_FALLBACK_ICON_DATA);
  } else {
    icon = nativeImage.createFromDataURL(TRAY_FALLBACK_ICON_DATA);
  }

  // 맥 메뉴 막대: 단색 아이콘을 템플릿으로 쓰면 라이트/다크 자동 반전
  if (process.platform === "darwin" && typeof (icon as Electron.NativeImage & { setTemplateImage?: (v: boolean) => void }).setTemplateImage === "function") {
    (icon as Electron.NativeImage & { setTemplateImage: (v: boolean) => void }).setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip("5240 PCOFF Agent - 클릭 또는 메뉴에서 'PCOFF 작동정보' 선택");
  // Windows: 단일 클릭이 더블클릭 대기로 먹히지 않도록 (트레이 클릭 시 창이 안 뜨는 이슈 완화)
  if (process.platform === "win32") {
    tray.setIgnoreDoubleClickEvents(true);
  }
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

/** 서버 근태 기준 잠금 필요 여부: getPcOffWorkTime 응답의 pcOnYn === "N" 이면 사용시간 종료(잠금). 설계: 서버가 조정해 회신한 값으로만 판단. */
async function isLockRequired(): Promise<boolean> {
  const api = await getApiClient();
  if (!api) {
    return false;
  }
  try {
    const data = await api.getPcOffWorkTime();
    lastWorkTimeData = data as unknown as Record<string, unknown>;
    lastWorkTimeFetchedAt = new Date().toISOString();
    leaveSeatDetector.updatePolicy({
      leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
      leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
    });
    const wt = data as Record<string, unknown>;
    logLoadedConfig("근태정보 (getPcOffWorkTime)", {
      pcOnYn: data.pcOnYn,
      screenType: wt.screenType,
      pcOnYmdTime: data.pcOnYmdTime,
      pcOffYmdTime: data.pcOffYmdTime,
      leaveSeatUseYn: data.leaveSeatUseYn,
      leaveSeatTime: data.leaveSeatTime,
      leaveSeatReasonYn: data.leaveSeatReasonYn,
      leaveSeatReasonManYn: data.leaveSeatReasonManYn,
      pcoffEmergencyYesNo: data.pcoffEmergencyYesNo
    });
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
  // 설치 앱: userData 사용(개발 시 state와 분리). 개발: process.cwd()
  baseDir = app.isPackaged ? app.getPath("userData") : process.cwd();
  // 설치 앱 첫 실행: userData에 config 없으면 번들(extraResources) config 복사 → API 주소 설정 오류 방지
  if (app.isPackaged) {
    const userConfigPath = join(baseDir, "config.json");
    const bundledConfigPath = join(process.resourcesPath, "config.json");
    if (!existsSync(userConfigPath) && existsSync(bundledConfigPath)) {
      try {
        mkdirSync(baseDir, { recursive: true });
        copyFileSync(bundledConfigPath, userConfigPath);
        console.info("[PCOFF] config.json copied from bundle to userData");
      } catch (e) {
        console.warn("[PCOFF] Failed to copy config from bundle:", e);
      }
    }
  }
  logger = new TelemetryLogger(baseDir, machine.getSessionId(), process.platform);
  updater = new UpdateManager(baseDir, logger);
  observer = new OpsObserver(logger, () => getApiBaseUrl(baseDir));
  authPolicy = new AuthPolicy(logger);
  guard = new AgentGuard(baseDir, logger);

  await logger.write(LOG_CODES.APP_START, "INFO", { platform: process.platform });

  // FR-09: 설치자 레지스트리 초기화 및 서버 동기화 시도
  void (async () => {
    try {
      const userDisplay = await getLoginUserDisplay(baseDir);
      const appVersion = app.getVersion();
      const registry = await loadOrCreateInstallerRegistry(
        baseDir,
        appVersion,
        userDisplay.loginUserId ?? "unknown"
      );
      if (registry.syncStatus !== "synced") {
        const apiBaseUrl = await getApiBaseUrl(baseDir);
        const synced = await syncInstallerRegistry(baseDir, registry, apiBaseUrl);
        if (synced.syncStatus === "synced") {
          await logger.write(LOG_CODES.INSTALLER_REGISTRY_SYNC, "INFO", {
            deviceId: synced.deviceId,
            installedAt: synced.installedAt
          });
        } else {
          await logger.write(LOG_CODES.INSTALLER_REGISTRY_FAIL, "WARN", {
            deviceId: registry.deviceId,
            reason: "server_sync_failed"
          });
        }
      }
    } catch (err) {
      await logger.write(LOG_CODES.INSTALLER_REGISTRY_FAIL, "WARN", {
        reason: String(err)
      });
    }
  })();

  // FR-08: Ops Observer 시작 (heartbeat + 로그 서버 전송)
  observer.start();
  // FR-07: Agent Guard 시작 (무결성 감시)
  await guard.start();
  
  // 시스템 트레이 생성 (실패 시에도 앱은 계속 실행, Windows에서 아이콘 경로 등 이슈 대비)
  try {
    createTray();
  } catch (err) {
    console.error("[PCOFF] Tray creation failed:", err);
  }

  // 전역 핫키 (설치 앱: macOS는 손쉬운 사용 허용 필요, Windows는 앱 포커스/관리자 권한에 따라 동작)
  const hotkeys: [string, () => void][] = [
    ["CommandOrControl+Shift+L", () => void doGlobalLogout()],
    ["CommandOrControl+Shift+I", () => createTrayInfoWindow()],
    ["CommandOrControl+Shift+K", () => createLockWindow()]
  ];
  const registerHotkeys = () => {
    for (const [accel, fn] of hotkeys) {
      try {
        const ok = globalShortcut.register(accel, fn);
        if (ok) console.info("[PCOFF] 핫키 등록:", accel);
        else console.warn("[PCOFF] 핫키 등록 실패(이미 사용 중?):", accel);
      } catch (e) {
        console.warn("[PCOFF] 핫키 등록 실패:", accel, e, "(macOS: 손쉬운 사용 허용 확인)");
      }
    }
  };
  // Windows: 시작 직후 다른 앱이 포커스를 잡아 핫키가 동작하지 않을 수 있으므로 짧은 지연 후 등록
  if (process.platform === "win32") {
    setTimeout(registerHotkeys, 400);
  } else {
    registerHotkeys();
  }

  // 로그인 상태 확인 후 적절한 창 열기
  const config = await loadRuntimeConfig(baseDir);
  const hasLogin = Boolean(
    config?.userServareaId && config?.userStaffId &&
    isRealLoginId(config.userServareaId) && isRealLoginId(config.userStaffId)
  );

  logLoadedConfig("런타임 설정 (config/state)", {
    apiBaseUrl: config?.apiBaseUrl ?? "(없음)",
    userServareaId: config?.userServareaId ?? "(없음)",
    userStaffId: config?.userStaffId ?? "(없음)",
    hasLogin
  });
  if (hasLogin) {
    const userDisplay = await getLoginUserDisplay(baseDir);
    logLoadedConfig("로그인 사용자", {
      loginUserId: userDisplay?.loginUserId ?? "(없음)",
      loginUserNm: userDisplay?.loginUserNm ?? "(없음)",
      posNm: userDisplay?.posNm ?? "(없음)",
      corpNm: userDisplay?.corpNm ?? "(없음)"
    });
  }

  if (hasLogin) {
    startLockCheckInterval();

    leaveSeatDetector.start({
      isLeaveSeatActive: () => localLeaveSeatDetectedAt !== null,
      onIdleDetected: (detectedAt, idleSeconds) => {
        void logger.write(LOG_CODES.LEAVE_SEAT_IDLE_DETECTED, "INFO", {
          detectedAt: detectedAt.toISOString(),
          idleSeconds,
          leaveSeatTimeMinutes: lastWorkTimeData?.leaveSeatTime ?? 0
        });
        showLockForLocalLeaveSeat(detectedAt, "INACTIVITY");
      },
      onSleepDetected: (detectedAt, sleepElapsedSeconds) => {
        void logger.write(LOG_CODES.LEAVE_SEAT_SLEEP_DETECTED, "INFO", {
          detectedAt: detectedAt.toISOString(),
          sleepElapsedSeconds,
          leaveSeatTimeMinutes: lastWorkTimeData?.leaveSeatTime ?? 0
        });
        showLockForLocalLeaveSeat(detectedAt, "SLEEP_EXCEEDED");
      },
      onSleepEntered: () => void logger.write(LOG_CODES.SLEEP_ENTERED, "INFO", {}),
      onSleepResumed: () => void logger.write(LOG_CODES.SLEEP_RESUMED, "INFO", {})
    });
    leaveSeatDetector.updatePolicy({
      leaveSeatUseYn: normalizeLeaveSeatUseYn(lastWorkTimeData?.leaveSeatUseYn),
      leaveSeatTimeMinutes: Number(lastWorkTimeData?.leaveSeatTime ?? 0) || 0
    });

    const lockOpened = await checkLockAndShowLockWindow();
    if (!lockOpened) createTrayInfoWindow();
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
  leaveSeatDetector.stop();
  observer?.stop();
  await guard?.stop();
});

// FR-08: 비정상 종료 시 서버에 CRASH_DETECTED 보고 (whenReady 이전에는 observer 미초기화)
process.on("uncaughtException", (err) => {
  void observer?.reportCrash(err).then(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  void observer?.reportCrash(String(reason)).then(() => process.exit(1));
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
      logLoadedConfig("로그인 저장됨", {
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
    const mockData = buildMockWorkTime() as Record<string, unknown>;
    if (localLeaveSeatDetectedAt) {
      mockData.screenType = "empty";
      mockData.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
    }
    logLoadedConfig("근태정보 (getWorkTime IPC, mock)", { source: "mock", pcOnYn: mockData.pcOnYn, screenType: mockData.screenType });
    return { source: "mock", data: mockData };
  }

  try {
    const data = await api.getPcOffWorkTime();
    
    // 캐시 업데이트
    lastWorkTimeData = data as Record<string, unknown>;
    lastWorkTimeFetchedAt = new Date().toISOString();
    leaveSeatDetector.updatePolicy({
      leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
      leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
    });
    const wt = data as Record<string, unknown>;
    logLoadedConfig("근태정보 (getWorkTime IPC)", {
      source: "api",
      pcOnYn: data.pcOnYn,
      screenType: wt.screenType,
      pcOnYmdTime: data.pcOnYmdTime,
      pcOffYmdTime: data.pcOffYmdTime,
      leaveSeatUseYn: data.leaveSeatUseYn,
      leaveSeatTime: data.leaveSeatTime,
      leaveSeatReasonYn: data.leaveSeatReasonYn,
      leaveSeatReasonManYn: data.leaveSeatReasonManYn
    });

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

    const merged = { ...data } as Record<string, unknown>;
    if (localLeaveSeatDetectedAt) {
      merged.screenType = "empty";
      merged.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
    }
    return { source: "api", data: merged };
  } catch (error) {
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "getPcOffWorkTime", error: String(error) });
    const fallbackData = buildMockWorkTime() as Record<string, unknown>;
    if (localLeaveSeatDetectedAt) {
      fallbackData.screenType = "empty";
      fallbackData.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
    }
    return { source: "fallback", data: fallbackData, error: String(error) };
  }
});

ipcMain.handle("pcoff:requestPcExtend", async (_event, payload: { pcOffYmdTime?: string }): Promise<ActionResult> => {
  const api = await getApiClient();
  if (!api) return { source: "mock", success: true };
  try {
    const pcOffYmdTime = payload.pcOffYmdTime ?? buildMockWorkTime().pcOffYmdTime ?? "";
    const data = await api.callPcOffTempDelay(pcOffYmdTime);
    await logger.write("UNLOCK_TRIGGERED", "INFO", { action: "pc_extend", pcOffYmdTime });
    setOperationMode("TEMP_EXTEND");
    const workTime = await api.getPcOffWorkTime();
    lastWorkTimeData = workTime as unknown as Record<string, unknown>;
    lastWorkTimeFetchedAt = new Date().toISOString();
    createTrayInfoWindow();
    return { source: "api", success: true, data: workTime };
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
  async (
    _event,
    payload: { tmckButnCd: "IN" | "OUT"; eventName?: string; reason?: string; isLeaveSeat?: boolean }
  ): Promise<ActionResult> => {
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
        if (payload.isLeaveSeat) {
          const hasReason = Boolean(payload.reason?.trim());
          await logger.write(LOG_CODES.LEAVE_SEAT_UNLOCK, "INFO", {
            hasReason,
            reason: payload.reason ?? ""
          });
          if (hasReason) {
            await logger.write(LOG_CODES.LEAVE_SEAT_REASON_SUBMITTED, "INFO", {
              reason: payload.reason
            });
          }
        }
        if (localLeaveSeatDetectedAt) {
          await logger.write(LOG_CODES.LEAVE_SEAT_RELEASED, "INFO", {
            reason: localLeaveSeatReason ?? "unknown"
          });
          localLeaveSeatDetectedAt = null;
          localLeaveSeatReason = null;
        }
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
