import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, globalShortcut, protocol } from "electron";
import type { LeaveSeatDetectedReason } from "../core/leave-seat-detector.js";
import { LeaveSeatDetector } from "../core/leave-seat-detector.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, LOG_CODES, PATHS } from "../core/constants.js";

// ESM에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 맥 패키징 시 file:// 로 asar 내부 로드가 차단되므로 app:// 프로토콜 사용 (app.ready 전 등록)
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { secure: true, supportFetchAPI: true } }
]);

import { FeatureStateMachine } from "../core/state-machine.js";
import { TelemetryLogger } from "../core/telemetry-log.js";
import { UpdateManager } from "../core/update-manager.js";
import { OpsObserver } from "../core/ops-observer.js";
import { OfflineManager, type ConnectivityState } from "../core/offline-manager.js";
import { EmergencyUnlockManager } from "../core/emergency-unlock.js";
import { AuthPolicy } from "../core/auth-policy.js";
import { AgentGuard, readIsolationState } from "../core/agent-guard.js";
import { PcOffApiClient, PcOffAuthClient, type WorkTimeResponse, type TenantLockPolicy } from "../core/api-client.js";
import { resolveScreenType } from "../core/screen-display-logic.js";
import {
  loadRuntimeConfig,
  getApiBaseUrl,
  saveLoginState,
  clearLoginState,
  getLoginUserDisplay,
  saveTempExtendState,
  loadTempExtendState,
  type RuntimeConfig
} from "../core/runtime-config.js";
import {
  loadOrCreateInstallerRegistry,
  syncInstallerRegistry
} from "../core/installer-registry.js";
import { LeaveSeatReporter } from "../core/leave-seat-reporter.js";
import { readJson } from "../core/storage.js";

/** 개발 시: 프로젝트 디렉터리, 설치 앱: userData(설치 앱 전용 상태·로그 분리) */
let baseDir = process.cwd();

// 윈도우 관리: 메인 창(작동정보·로그인·잠금 시 주 디스플레이), 다중 디스플레이 시 보조 잠금창 (§7·§11)
let mainWindow: BrowserWindow | null = null;
/** 디스플레이당 잠금 전용 창 (주 디스플레이 제외). display.id → BrowserWindow */
const lockWindowsByDisplayId = new Map<number, BrowserWindow>();
let tray: Tray | null = null;

// 현재 화면 상태 추적 (닫기 방지 정책 결정에 사용)
type ScreenType = "login" | "lock" | "tray-info";
let currentScreen: ScreenType = "login";

/** 강제 종료(Ctrl+Shift+Q) 시 true. close 이벤트에서 preventDefault 하지 않고 창 닫기 허용 */
let isForceQuit = false;

/** FR-19: 격리 모드(복구 실패 시) — 잠금 유지, 운영팀 조치 대기 */
let isolationModeActive = false;

/** macOS 다중 디스플레이: blur 시 재포커스 디바운스 (본/보조 간 무한 이동 방지) */
let lastLockBlurRefocusAt = 0;
const LOCK_BLUR_REFOCUS_DEBOUNCE_MS = 500;

// 현재 운영 모드
type OperationMode = "NORMAL" | "TEMP_EXTEND" | "EMERGENCY_USE" | "EMERGENCY_RELEASE";
let currentMode: OperationMode = "NORMAL";
let lastWorkTimeData: Record<string, unknown> = {};
let lastWorkTimeFetchedAt: string | null = null;

/** FR-12: LeaveSeatReporter 컨텍스트용 캐시 (loadRuntimeConfig에서 갱신) */
let cachedApiBaseUrl: string | null = null;
let cachedUserServareaId = "";
let cachedUserStaffId = "";

/** FR-14: 잠금 정책 캐시 (Draft/Publish/Rollback 배포 — 30분 TTL, 주기 폴링으로 갱신) */
const LOCK_POLICY_CACHE_TTL_MS = 30 * 60 * 1000; // 30분
let lastCachedLockPolicy: TenantLockPolicy | null = null;
let lastCachedLockPolicyAt = 0;
let policyPollingIntervalId: ReturnType<typeof setInterval> | null = null;

/** getApiClient 호출 시 반복 파일 I/O 방지 (state.json, config.json). 로그아웃 시 무효화 */
const RUNTIME_CONFIG_CACHE_MS = 60_000; // 1분
let cachedRuntimeConfig: { config: RuntimeConfig; at: number } | null = null;

function invalidateRuntimeConfigCache(): void {
  cachedRuntimeConfig = null;
  cachedApiBaseUrl = null;
  cachedUserServareaId = "";
  cachedUserStaffId = "";
  lastCachedLockPolicy = null;
  lastCachedLockPolicyAt = 0;
  if (policyPollingIntervalId) {
    clearInterval(policyPollingIntervalId);
    policyPollingIntervalId = null;
  }
}

/** 로컬 이석 감지(유휴/절전)로 잠금된 경우: 감지 시각·사유. PC-ON 해제 시 클리어 */
let localLeaveSeatDetectedAt: Date | null = null;
let localLeaveSeatReason: LeaveSeatDetectedReason | null = null;
const leaveSeatDetector = new LeaveSeatDetector();

/** FR-13: exCountRenewal(옵션 1227) 기준으로 시업/종업 화면 타입 적용 */
function applyResolvedScreenType(work: Record<string, unknown>): void {
  if (Object.keys(work).length === 0) return;
  work.screenType = resolveScreenType(work, new Date(), !!localLeaveSeatDetectedAt);
}

const machine = new FeatureStateMachine();
/** whenReady()에서 baseDir 설정 후 초기화됨 (설치 앱은 userData 사용) */
let logger: TelemetryLogger;
let updater: UpdateManager;
let observer: OpsObserver;
let authPolicy: AuthPolicy;
let guard: AgentGuard;
let leaveSeatReporter: LeaveSeatReporter;
let offlineManager: OfflineManager;
let emergencyUnlockManager: EmergencyUnlockManager;

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

/** Date → HHmm (4자, callCmmPcOnOffLogPrc emergencyYn 이석 시작/종료 시각용) */
function formatHm(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${h}${min}`;
}

/**
 * 이석 해제 시 emergencyYn 값 생성 (PC_OFF_AGENT_API §2.4).
 * N/이석시간(시간단위,소수점)/이석시작(HHMM)/이석종료(HHMM)/이석중비근무시간
 * leaveinputmethod: UI 미구현 시 0 전달.
 */
function buildLeaveSeatEmergencyYn(startAt: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - startAt.getTime();
  const diffHours = Math.max(0, diffMs / (60 * 60 * 1000));
  const diffStr = diffHours.toFixed(7).replace(/\.?0+$/, "") || "0";
  const startHM = formatHm(startAt);
  const endHM = formatHm(now);
  // leaveSeatOffInputMath 1/3 사용자 입력 UI 미구현 시 0. 2는 근무중 이석시간 자동 → 0
  const leaveinputmethod = "0";
  return `N/${diffStr}/${startHM}/${endHM}/${leaveinputmethod}`;
}

/** YYYYMMDDHH24MI(12자) → Date. 백엔드 pcOnYmdTime/pcOffYmdTime 파싱용. */
function parseYmdHm(value: string | undefined): Date | null {
  if (!value || String(value).length < 12) return null;
  const s = String(value);
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(4, 6), 10) - 1;
  const d = parseInt(s.slice(6, 8), 10);
  const h = parseInt(s.slice(8, 10), 10);
  const min = parseInt(s.slice(10, 12), 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d) || Number.isNaN(h) || Number.isNaN(min))
    return null;
  const date = new Date(y, m, d, h, min, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
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
    pcoffEmergencyYesNo: "YES",
    // FR-15: mock에서 긴급해제 버튼이 동작하도록 플래그 추가 (서버 연동 시에는 getPcOffWorkTime 응답에서 내려줌)
    emergencyUnlockUseYn: "YES",
    emergencyUnlockPasswordSetYn: "Y"
  };
}

type ActionResult = {
  source: "api" | "mock" | "fallback";
  success: boolean;
  data?: unknown;
  error?: string;
  /** PC-ON 성공했으나 아직 시업 전 등으로 잠금 유지 시 true. 잠금화면에서 "불가" 메시지 표시용 */
  stillLocked?: boolean;
};

async function getApiClient(): Promise<PcOffApiClient | null> {
  const now = Date.now();
  let runtimeConfig: RuntimeConfig | null =
    cachedRuntimeConfig && now - cachedRuntimeConfig.at < RUNTIME_CONFIG_CACHE_MS
      ? cachedRuntimeConfig.config
      : null;
  if (!runtimeConfig) {
    runtimeConfig = await loadRuntimeConfig(baseDir);
    if (!runtimeConfig) return null;
    cachedRuntimeConfig = { config: runtimeConfig, at: now };
  }
  cachedApiBaseUrl = runtimeConfig.apiBaseUrl;
  cachedUserServareaId = runtimeConfig.userServareaId;
  cachedUserStaffId = runtimeConfig.userStaffId;
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
  const cwd = process.cwd();
  // 개발 시(npm run build && electron .): dist에서 실행되므로 build/ 또는 app/renderer/ 사용. build가 있으면 우선(동기화된 복사본).
  const candidates = app.isPackaged
    ? [
        join(appPath, "app/renderer", htmlFile),
        join(appPath, "build", htmlFile),
        join(__dirname, `../../../app/renderer/${htmlFile}`)
      ]
    : [
        join(cwd, "build", htmlFile),
        join(__dirname, `../../../app/renderer/${htmlFile}`),
        join(cwd, "app/renderer", htmlFile),
        join(appPath, "app/renderer", htmlFile)
      ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  const fallback = join(appPath, "app/renderer", htmlFile);
  console.warn("[PCOFF] Renderer path not found, using fallback:", fallback);
  return fallback;
}

/** 맥 패키징 시 file:// 차단 우회용 app:// URL */
function getRendererUrl(htmlFile: string): string {
  return `app://./app/renderer/${htmlFile}`;
}

/** 창에 HTML 로드 — 맥 패키징 시 app://, 그 외 loadFile. 반환 Promise로 catch 가능 */
function loadRendererInWindow(win: BrowserWindow, htmlFile: string): Promise<void> {
  const pathOrUrl = process.platform === "darwin" && app.isPackaged
    ? getRendererUrl(htmlFile)
    : getRendererPath(htmlFile);
  const p = process.platform === "darwin" && app.isPackaged
    ? win.loadURL(pathOrUrl as string)
    : win.loadFile(pathOrUrl as string);
  return p.catch((err) => {
    console.error("[PCOFF] loadRendererInWindow failed:", htmlFile, pathOrUrl, err);
    throw err;
  });
}

/** main.html 로드 실패 시 재시도(흰 화면 방지) */
function loadMainHtmlWithRetry(win: BrowserWindow, maxAttempts = 3): Promise<void> {
  if (!win || win.isDestroyed()) return Promise.resolve();
  const tryLoad = (attempt: number): Promise<void> => {
    return loadRendererInWindow(win, "main.html").catch((err) => {
      if (attempt >= maxAttempts) throw err;
      const delay = attempt === 1 ? 250 : 500;
      return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          tryLoad(attempt + 1).then(resolve).catch(reject);
        }, delay);
      });
    });
  };
  return tryLoad(1);
}

/**
 * mainWindow close 이벤트 핸들러 부착
 * - lock 화면: 닫기 완전 차단 (잠금 우회 방지)
 * - tray-info 화면: 트레이로 숨김 (앱 유지)
 * - login 화면: 일반 닫기 허용
 * - isForceQuit(강제 종료 핫키) 시: 모든 화면에서 preventDefault 하지 않음 → 앱 종료
 */
function attachMainWindowCloseHandler(win: BrowserWindow): void {
  win.on("close", (e) => {
    if (isForceQuit) {
      // 강제 종료: 창 닫기 허용하여 app.quit() 완료
      return;
    }
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
  // 잠금화면 중에는 ESC 등으로 전체 화면 해제 불가 — 즉시 다시 전체 화면
  win.on("leave-full-screen", () => {
    if (currentScreen === "lock" && !win.isDestroyed()) {
      win.setFullScreen(true);
    }
  });
  // 잠금화면 중 Cmd+Tab(앱 전환) 등으로 포커스가 빠지면 다시 맨 앞으로 가져옴
  win.on("blur", () => {
    if (currentScreen !== "lock" || win.isDestroyed()) return;
    if (process.platform === "darwin" && lockWindowsByDisplayId.size > 0) {
      const now = Date.now();
      if (now - lastLockBlurRefocusAt < LOCK_BLUR_REFOCUS_DEBOUNCE_MS) return;
      lastLockBlurRefocusAt = now;
    }
    setTimeout(() => {
      if (currentScreen !== "lock" || !win || win.isDestroyed()) return;
      app.focus({ steal: true });
      setTimeout(() => {
        if (currentScreen !== "lock" || !win || win.isDestroyed()) return;
        win.moveTop();
        win.show();
        win.setAlwaysOnTop(false);
        win.setAlwaysOnTop(true, "screen-saver");
        win.setFullScreen(true);
        win.focus();
      }, 50);
    }, 100);
  });
}

/** 보조 잠금창 전부 닫기 (해제/로그인 전환 시 호출). destroy()로 강제 제거(close 방지 우회).
 * Windows: 풀스크린 해제 후 hide()로 즉시 화면에서 제거한 뒤 destroy()하여 보조 모니터에 잠금이 남는 현상 방지. */
function closeAllLockWindows(): void {
  for (const win of lockWindowsByDisplayId.values()) {
    if (win.isDestroyed()) continue;
    try {
      win.setFullScreen(false);
      win.hide();
    } catch {
      // 이미 파괴 중이거나 오류 시 무시
    }
    if (!win.isDestroyed()) win.destroy();
  }
  lockWindowsByDisplayId.clear();
}

/** 잠금화면 동작 부착 (닫기 차단, leave-full-screen 시 재진입, blur 시 재포커스) — 보조 잠금창용 */
function attachLockWindowBehavior(win: BrowserWindow): void {
  win.on("close", (e) => {
    if (!isForceQuit && currentScreen === "lock") e.preventDefault();
  });
  win.on("leave-full-screen", () => {
    if (currentScreen === "lock" && !win.isDestroyed()) win.setFullScreen(true);
  });
  if (process.platform !== "darwin") {
    win.on("blur", () => {
      if (currentScreen !== "lock" || win.isDestroyed()) return;
      setTimeout(() => {
        if (currentScreen !== "lock" || !win || win.isDestroyed()) return;
        app.focus({ steal: true });
        setTimeout(() => {
          if (currentScreen !== "lock" || !win || win.isDestroyed()) return;
          win.moveTop();
          win.show();
          win.setAlwaysOnTop(false);
          win.setAlwaysOnTop(true, "screen-saver");
          win.setFullScreen(true);
          win.focus();
        }, 50);
      }, 100);
    });
  }
}

/** 다중 디스플레이: 주 디스플레이 제외 보조 디스플레이마다 잠금창 1개 생성·동기화 (§7·§11) */
async function ensureLockWindowsForAllDisplays(): Promise<void> {
  if (currentScreen !== "lock") return;
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const secondaries = displays.filter((d) => d.id !== primaryDisplay.id);

  // 제거된 디스플레이에 해당하는 창 닫기
  for (const [displayId, win] of lockWindowsByDisplayId.entries()) {
    if (!secondaries.some((d) => d.id === displayId)) {
      if (!win.isDestroyed()) win.destroy();
      lockWindowsByDisplayId.delete(displayId);
    }
  }

  for (const display of secondaries) {
    if (lockWindowsByDisplayId.has(display.id)) {
      const existing = lockWindowsByDisplayId.get(display.id)!;
      if (existing.isDestroyed()) lockWindowsByDisplayId.delete(display.id);
      else {
        try {
          existing.webContents.send("pcoff:lock-initial-work", lastWorkTimeData);
        } catch {
          // 이미 파괴 중이면 무시
        }
        continue;
      }
    }
    const win = new BrowserWindow({
      width: display.bounds.width,
      height: display.bounds.height,
      x: display.bounds.x,
      y: display.bounds.y,
      show: false,
      fullscreenable: true,
      resizable: false,
      minimizable: true,
      closable: false,
      alwaysOnTop: true,
      title: "PCOFF 잠금화면",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: getPreloadPath()
      }
    });
    win.setVisibleOnAllWorkspaces(true);
    attachLockWindowBehavior(win);
    win.on("closed", () => lockWindowsByDisplayId.delete(display.id));
    win.webContents.once("did-finish-load", () => {
      if (win.isDestroyed() || currentScreen !== "lock") return;
      win.webContents.send("pcoff:lock-initial-work", lastWorkTimeData);
    });
    await loadRendererInWindow(win, "lock.html").catch((err) => {
      console.error("[PCOFF] 보조 잠금창 로드 실패:", display.id, err);
    });
    if (!win.isDestroyed() && currentScreen === "lock") {
      win.setBounds(display.bounds);
      win.setAlwaysOnTop(true, "screen-saver");
      win.show();
      // 보조 디스플레이에 먼저 배치·표시한 뒤 풀스크린 → 해당 디스플레이에서 풀스크린됨 (macOS 포함)
      win.setFullScreen(true);
    }
    lockWindowsByDisplayId.set(display.id, win);
  }
}

/** 창 포커스 시에도 핫키 동작하도록 before-input-event로 처리 (globalShortcut은 창 포커스 시 미동작할 수 있음) */
function attachWindowHotkeys(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    const mod = input.control || input.meta;
    if (!mod || !input.shift) return;
    const key = input.key?.toLowerCase();
    if (key === "i") {
      event.preventDefault();
      showTrayInfoInCurrentWindow();
    } else if (key === "k") {
      event.preventDefault();
      void createLockWindow();
    } else if (key === "l") {
      event.preventDefault();
      void doGlobalLogout();
    } else if (key === "q" && input.control) {
      // 개발자 전용: 강제 종료. 맥에서 Cmd+Shift+Q(시스템 동작) 방지 → Control+Shift+Q만 사용
      event.preventDefault();
      isForceQuit = true;
      app.quit();
    }
  });
}

/**
 * 현재 창을 작동정보(main.html)로 전환. 잠금 검사 없음.
 * macOS: 풀스크린 잠금창 재사용 시 setFullScreen(false)/setSize가 적용되지 않아
 * 기존 창을 닫고 새 창(620×840)을 열어 에이전트 기본 크기로 표시.
 * Windows: 같은 창에서 hide → 로드 → show(620×840).
 * @param onDisplay - 지정 시 해당 디스플레이에 창 배치 (보조 모니터에서 긴급해제 시 반응 보장)
 */
function showTrayInfoInCurrentWindow(onDisplay?: Electron.Display): void {
  if (isolationModeActive) return;
  currentScreen = "tray-info";
  closeAllLockWindows();
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createTrayInfoWindow();
    return;
  }
  if (process.platform === "darwin") {
    const win = mainWindow;
    currentScreen = "login";
    win.destroy();
    void createTrayInfoWindow();
    return;
  }
  mainWindow.setFullScreen(false);
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setVisibleOnAllWorkspaces(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  currentScreen = "tray-info";
  mainWindow.setSize(620, 840);
  mainWindow.setTitle("PCOFF 작동정보");
  mainWindow.hide();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.setAlwaysOnTop(false);
  const win = mainWindow;
  const showWhenReady = () => {
    if (win.isDestroyed() || currentScreen !== "tray-info") return;
    if (win.isMaximized()) win.unmaximize();
    win.setSize(620, 840);
    if (onDisplay?.workArea) {
      const wa = onDisplay.workArea;
      const w = 620;
      const h = 840;
      win.setBounds({
        x: wa.x + Math.max(0, Math.floor((wa.width - w) / 2)),
        y: wa.y + Math.max(0, Math.floor((wa.height - h) / 2)),
        width: w,
        height: h
      });
    } else {
      win.center();
    }
    win.show();
    win.focus();
    if (process.platform === "win32") {
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
      win.focus();
    }
  };
  setImmediate(() => {
    if (!win || win.isDestroyed()) return;
    void loadMainHtmlWithRetry(win).then(() => {
      if (win.isDestroyed() || currentScreen !== "tray-info") return;
      if (win.isMaximized()) win.unmaximize();
      win.setSize(620, 840);
      win.center();
      setTimeout(() => {
        if (win.isDestroyed() || currentScreen !== "tray-info") return;
        win.webContents.executeJavaScript("document.body && document.querySelector('.dashboard') ? true : false").catch(() => false).then((hasContent) => {
          if (hasContent === true) {
            showWhenReady();
          } else if (!win.isDestroyed() && currentScreen === "tray-info") {
            loadMainHtmlWithRetry(win).then(() => showWhenReady()).catch(() => showWhenReady());
          } else {
            showWhenReady();
          }
        });
      }, 200);
    }).catch(() => {
      showWhenReady();
    });
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

  console.info("[PCOFF] Opening tray info window (main.html)");

  if (mainWindow && !mainWindow.isDestroyed()) {
    currentScreen = "tray-info";
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setSize(620, 840);
    mainWindow.setTitle("PCOFF 작동정보");
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === "win32") {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.focus();
    }
    void loadMainHtmlWithRetry(mainWindow);
    return;
  }

  const win = new BrowserWindow({
    width: 620,
    height: 840,
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
  attachWindowHotkeys(win);
  win.once("ready-to-show", () => {
    if (win.isMaximized()) win.unmaximize();
    win.setSize(620, 840);
    win.show();
    win.focus();
    if (process.platform === "win32") {
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
      win.focus();
    }
  });
  loadMainHtmlWithRetry(win).catch((err) => {
    console.error("[PCOFF] Failed to load main.html:", err);
    if (win.isMaximized()) win.unmaximize();
    win.setSize(620, 840);
    win.show();
    win.focus();
    if (process.platform === "win32") {
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
      win.focus();
    }
  });
  void logger.write(LOG_CODES.TRAY_INFO_OPENED, "INFO", {});
  } catch (err) {
    console.error("[PCOFF] createTrayInfoWindow failed:", err);
  }
}

/** WebView getScreenInfo.php 형식: POST [{ userServareaId }] → { status, send_data } */
async function fetchLockScreenFromUrl(
  url: string,
  userServareaId: string
): Promise<Partial<WorkTimeResponse>> {
  const body = JSON.stringify([{ userServareaId }]);
  const res = await fetch(url.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const json = (await res.json()) as {
    status?: string;
    send_data?: Array<{ ScreenType?: string; LockTitle?: string; LockMessage?: string; Background?: string; Logo?: string }>;
  };
  const list = json?.send_data ?? [];
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

/**
 * 원본 WebView sendPcOnPass.php 호출 (lockScreenApiUrl과 동일 방식).
 * POST application/x-www-form-urlencoded: ServAreaID, UserID, PcOnPass.
 * 응답: JSON 배열, result[0].code == 1 이면 성공.
 */
async function verifyLeaveSeatUnlockViaUrl(
  url: string,
  userServareaId: string,
  userStaffId: string,
  password: string
): Promise<{ success: boolean; message?: string }> {
  const body = new URLSearchParams({
    ServAreaID: userServareaId,
    UserID: userStaffId,
    PcOnPass: password
  }).toString();
  const res = await fetch(url.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) return { success: false, message: `요청 실패: ${res.status}` };
  const json = (await res.json()) as Array<{ code?: number | string }> | { code?: number | string };
  const first = Array.isArray(json) ? json[0] : json;
  const code = first?.code;
  if (code === 1 || code === "1") return { success: true };
  return { success: false, message: "비밀번호가 맞지 않습니다." };
}

/** FR-14: 정책 객체를 WorkTimeResponse 형태로 병합 (lockScreen.screens, leaveSeatUnlockRequirePassword) */
function mergeLockPolicyIntoData(data: WorkTimeResponse, policy: TenantLockPolicy): WorkTimeResponse {
  const merged = { ...data } as Record<string, unknown>;
  const screens = policy.lockScreen?.screens;
  if (screens?.before) {
    if (screens.before.title != null) merged.lockScreenBeforeTitle = screens.before.title;
    if (screens.before.message != null) merged.lockScreenBeforeMessage = screens.before.message;
  }
  if (screens?.off) {
    if (screens.off.title != null) merged.lockScreenOffTitle = screens.off.title;
    if (screens.off.message != null) merged.lockScreenOffMessage = screens.off.message;
  }
  if (screens?.leave) {
    if (screens.leave.title != null) merged.lockScreenLeaveTitle = screens.leave.title;
    if (screens.leave.message != null) merged.lockScreenLeaveMessage = screens.leave.message;
  }
  if (policy.unlockPolicy?.leaveSeatUnlockRequirePassword !== undefined) {
    merged.leaveSeatUnlockRequirePassword = policy.unlockPolicy.leaveSeatUnlockRequirePassword;
  }
  return merged as WorkTimeResponse;
}

/** 잠금화면 문구 포함 근태 조회 (getPcOffWorkTime + getLockScreenInfo / lockScreenApiUrl + config.json 병합). 핫키/잠금창 오픈 시 선호출용 */
async function fetchWorkTimeWithLockScreen(api: PcOffApiClient): Promise<WorkTimeResponse> {
  const config = await readJson<{
    lockScreen?: {
      before?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string };
      off?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string };
      leave?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string };
    };
    /** WebView와 동일한 잠금화면 API URL (예: https://5240.work/LockScreen/getScreenInfo.php). 설정 시 getLockScreenInfo.do 실패해도 이 URL로 문구 조회 */
    lockScreenApiUrl?: string;
  }>(join(baseDir, PATHS.config), {});

  let data = await api.getPcOffWorkTime();

  // FR-14: 전용 정책 API — 캐시 유효 시 캐시 사용, 아니면 조회 후 캐시 갱신 (30분 TTL, 주기 폴링)
  if (cachedUserServareaId) {
    const now = Date.now();
    const cacheFresh = lastCachedLockPolicy != null && (now - lastCachedLockPolicyAt) < LOCK_POLICY_CACHE_TTL_MS;
    let policy: TenantLockPolicy | null = cacheFresh ? lastCachedLockPolicy : null;
    if (!policy) {
      try {
        policy = await api.getLockPolicy(cachedUserServareaId);
        if (policy?.lockScreen?.screens || policy?.unlockPolicy) {
          lastCachedLockPolicy = policy;
          lastCachedLockPolicyAt = now;
        }
      } catch (e) {
        console.info("[PCOFF] lock-policy API 미사용:", String(e));
      }
    }
    if (policy && (policy.lockScreen?.screens || policy.unlockPolicy)) {
      data = mergeLockPolicyIntoData(data, policy);
      if (!cacheFresh) console.info("[PCOFF] 잠금화면 문구 — lock-policy API 적용됨");
    }
  }

  const hasLockScreenFromWorkTime =
    (data.lockScreenBeforeTitle ?? data.lockScreenOffTitle ?? data.lockScreenLeaveTitle) != null &&
    (String(data.lockScreenBeforeTitle ?? data.lockScreenOffTitle ?? data.lockScreenLeaveTitle).trim() !== "");

  if (!hasLockScreenFromWorkTime) {
    let screenInfo: Partial<WorkTimeResponse> | null = null;
    try {
      screenInfo = await api.getLockScreenInfo();
    } catch (e) {
      console.info("[PCOFF] 잠금화면 문구 — getLockScreenInfo.do 미사용:", String(e));
    }
    const hasFromDo =
      screenInfo != null &&
      (screenInfo.lockScreenBeforeTitle ?? screenInfo.lockScreenOffTitle ?? screenInfo.lockScreenLeaveTitle) != null;
    if (hasFromDo && screenInfo) {
      const merged = { ...data } as Record<string, unknown>;
      if (screenInfo.lockScreenBeforeTitle != null) merged.lockScreenBeforeTitle = screenInfo.lockScreenBeforeTitle;
      if (screenInfo.lockScreenBeforeMessage != null) merged.lockScreenBeforeMessage = screenInfo.lockScreenBeforeMessage;
      if (screenInfo.lockScreenOffTitle != null) merged.lockScreenOffTitle = screenInfo.lockScreenOffTitle;
      if (screenInfo.lockScreenOffMessage != null) merged.lockScreenOffMessage = screenInfo.lockScreenOffMessage;
      if (screenInfo.lockScreenLeaveTitle != null) merged.lockScreenLeaveTitle = screenInfo.lockScreenLeaveTitle;
      if (screenInfo.lockScreenLeaveMessage != null) merged.lockScreenLeaveMessage = screenInfo.lockScreenLeaveMessage;
      if (screenInfo.lockScreenBeforeBackground != null) merged.lockScreenBeforeBackground = screenInfo.lockScreenBeforeBackground;
      if (screenInfo.lockScreenBeforeLogo != null) merged.lockScreenBeforeLogo = screenInfo.lockScreenBeforeLogo;
      if (screenInfo.lockScreenOffBackground != null) merged.lockScreenOffBackground = screenInfo.lockScreenOffBackground;
      if (screenInfo.lockScreenOffLogo != null) merged.lockScreenOffLogo = screenInfo.lockScreenOffLogo;
      if (screenInfo.lockScreenLeaveBackground != null) merged.lockScreenLeaveBackground = screenInfo.lockScreenLeaveBackground;
      if (screenInfo.lockScreenLeaveLogo != null) merged.lockScreenLeaveLogo = screenInfo.lockScreenLeaveLogo;
      data = merged as WorkTimeResponse;
      console.info("[PCOFF] 잠금화면 문구 — getLockScreenInfo.do 적용됨");
    } else if (config.lockScreenApiUrl?.trim() && cachedUserServareaId) {
      try {
        const fromUrl = await fetchLockScreenFromUrl(config.lockScreenApiUrl.trim(), cachedUserServareaId);
        const hasFromUrl =
          (fromUrl.lockScreenBeforeTitle ?? fromUrl.lockScreenOffTitle ?? fromUrl.lockScreenLeaveTitle) != null;
        if (hasFromUrl) {
          const merged = { ...data } as Record<string, unknown>;
          if (fromUrl.lockScreenBeforeTitle != null) merged.lockScreenBeforeTitle = fromUrl.lockScreenBeforeTitle;
          if (fromUrl.lockScreenBeforeMessage != null) merged.lockScreenBeforeMessage = fromUrl.lockScreenBeforeMessage;
          if (fromUrl.lockScreenOffTitle != null) merged.lockScreenOffTitle = fromUrl.lockScreenOffTitle;
          if (fromUrl.lockScreenOffMessage != null) merged.lockScreenOffMessage = fromUrl.lockScreenOffMessage;
          if (fromUrl.lockScreenLeaveTitle != null) merged.lockScreenLeaveTitle = fromUrl.lockScreenLeaveTitle;
          if (fromUrl.lockScreenLeaveMessage != null) merged.lockScreenLeaveMessage = fromUrl.lockScreenLeaveMessage;
          if (fromUrl.lockScreenBeforeBackground != null) merged.lockScreenBeforeBackground = fromUrl.lockScreenBeforeBackground;
          if (fromUrl.lockScreenBeforeLogo != null) merged.lockScreenBeforeLogo = fromUrl.lockScreenBeforeLogo;
          if (fromUrl.lockScreenOffBackground != null) merged.lockScreenOffBackground = fromUrl.lockScreenOffBackground;
          if (fromUrl.lockScreenOffLogo != null) merged.lockScreenOffLogo = fromUrl.lockScreenOffLogo;
          if (fromUrl.lockScreenLeaveBackground != null) merged.lockScreenLeaveBackground = fromUrl.lockScreenLeaveBackground;
          if (fromUrl.lockScreenLeaveLogo != null) merged.lockScreenLeaveLogo = fromUrl.lockScreenLeaveLogo;
          data = merged as WorkTimeResponse;
          console.info("[PCOFF] 잠금화면 문구 — lockScreenApiUrl 적용됨");
        }
      } catch (e) {
        console.info("[PCOFF] 잠금화면 문구 — lockScreenApiUrl 호출 실패:", String(e));
      }
    }
    const ls = config.lockScreen;
    if (ls) {
      const merged = { ...data } as Record<string, unknown>;
      let applied = false;
      if (!merged.lockScreenBeforeTitle && ls.before?.title) {
        merged.lockScreenBeforeTitle = ls.before.title;
        if (ls.before.message) merged.lockScreenBeforeMessage = ls.before.message;
        if (ls.before.backgroundUrl) merged.lockScreenBeforeBackground = ls.before.backgroundUrl;
        if (ls.before.logoUrl) merged.lockScreenBeforeLogo = ls.before.logoUrl;
        applied = true;
      }
      if (!merged.lockScreenOffTitle && ls.off?.title) {
        merged.lockScreenOffTitle = ls.off.title;
        if (ls.off.message) merged.lockScreenOffMessage = ls.off.message;
        if (ls.off.backgroundUrl) merged.lockScreenOffBackground = ls.off.backgroundUrl;
        if (ls.off.logoUrl) merged.lockScreenOffLogo = ls.off.logoUrl;
        applied = true;
      }
      if (!merged.lockScreenLeaveTitle && ls.leave?.title) {
        merged.lockScreenLeaveTitle = ls.leave.title;
        if (ls.leave.message) merged.lockScreenLeaveMessage = ls.leave.message;
        if (ls.leave.backgroundUrl) merged.lockScreenLeaveBackground = ls.leave.backgroundUrl;
        if (ls.leave.logoUrl) merged.lockScreenLeaveLogo = ls.leave.logoUrl;
        applied = true;
      }
      if (!merged.lockScreenBeforeBackground && ls.before?.backgroundUrl) { merged.lockScreenBeforeBackground = ls.before.backgroundUrl; applied = true; }
      if (!merged.lockScreenBeforeLogo && ls.before?.logoUrl) { merged.lockScreenBeforeLogo = ls.before.logoUrl; applied = true; }
      if (!merged.lockScreenOffBackground && ls.off?.backgroundUrl) { merged.lockScreenOffBackground = ls.off.backgroundUrl; applied = true; }
      if (!merged.lockScreenOffLogo && ls.off?.logoUrl) { merged.lockScreenOffLogo = ls.off.logoUrl; applied = true; }
      if (!merged.lockScreenLeaveBackground && ls.leave?.backgroundUrl) { merged.lockScreenLeaveBackground = ls.leave.backgroundUrl; applied = true; }
      if (!merged.lockScreenLeaveLogo && ls.leave?.logoUrl) { merged.lockScreenLeaveLogo = ls.leave.logoUrl; applied = true; }
      if (applied) {
        data = merged as WorkTimeResponse;
        console.info("[PCOFF] 잠금화면 문구 — config.json lockScreen 적용됨");
      }
    }
  } else {
    const ls = config.lockScreen;
    if (ls) {
      const merged = { ...data } as Record<string, unknown>;
      let applied = false;
      if (!merged.lockScreenBeforeTitle && ls.before?.title) {
        merged.lockScreenBeforeTitle = ls.before.title;
        if (ls.before.message) merged.lockScreenBeforeMessage = ls.before.message;
        if (ls.before.backgroundUrl) merged.lockScreenBeforeBackground = ls.before.backgroundUrl;
        if (ls.before.logoUrl) merged.lockScreenBeforeLogo = ls.before.logoUrl;
        applied = true;
      }
      if (!merged.lockScreenOffTitle && ls.off?.title) {
        merged.lockScreenOffTitle = ls.off.title;
        if (ls.off.message) merged.lockScreenOffMessage = ls.off.message;
        if (ls.off.backgroundUrl) merged.lockScreenOffBackground = ls.off.backgroundUrl;
        if (ls.off.logoUrl) merged.lockScreenOffLogo = ls.off.logoUrl;
        applied = true;
      }
      if (!merged.lockScreenLeaveTitle && ls.leave?.title) {
        merged.lockScreenLeaveTitle = ls.leave.title;
        if (ls.leave.message) merged.lockScreenLeaveMessage = ls.leave.message;
        if (ls.leave.backgroundUrl) merged.lockScreenLeaveBackground = ls.leave.backgroundUrl;
        if (ls.leave.logoUrl) merged.lockScreenLeaveLogo = ls.leave.logoUrl;
        applied = true;
      }
      if (!merged.lockScreenBeforeBackground && ls.before?.backgroundUrl) { merged.lockScreenBeforeBackground = ls.before.backgroundUrl; applied = true; }
      if (!merged.lockScreenBeforeLogo && ls.before?.logoUrl) { merged.lockScreenBeforeLogo = ls.before.logoUrl; applied = true; }
      if (!merged.lockScreenOffBackground && ls.off?.backgroundUrl) { merged.lockScreenOffBackground = ls.off.backgroundUrl; applied = true; }
      if (!merged.lockScreenOffLogo && ls.off?.logoUrl) { merged.lockScreenOffLogo = ls.off.logoUrl; applied = true; }
      if (!merged.lockScreenLeaveBackground && ls.leave?.backgroundUrl) { merged.lockScreenLeaveBackground = ls.leave.backgroundUrl; applied = true; }
      if (!merged.lockScreenLeaveLogo && ls.leave?.logoUrl) { merged.lockScreenLeaveLogo = ls.leave.logoUrl; applied = true; }
      if (applied) data = merged as WorkTimeResponse;
    }
  }
  return data;
}

/**
 * 잠금화면 (lock.html)
 * 핫키/트레이로 열 때 문구 데이터를 먼저 불러온 뒤 로드해, 설정된 문구가 항상 적용되도록 함.
 */
async function createLockWindow(): Promise<void> {
  // 잠금창을 띄우기 전에 근태·잠금화면 문구 선로드 (핫키로 잠글 때도 호출 보장)
  const api = await getApiClient();
  if (api) {
    try {
      const data = await fetchWorkTimeWithLockScreen(api);
      const dataRecord = data as Record<string, unknown>;
      preserveLocalPcExCountIfHigher(dataRecord);
      lastWorkTimeData = dataRecord;
      applyResolvedScreenType(lastWorkTimeData);
      lastWorkTimeFetchedAt = new Date().toISOString();
      leaveSeatDetector.updatePolicy({
        leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
        leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
      });
      emergencyUnlockManager?.updatePolicy({
        unlockTimeMinutes: Number(data.emergencyUnlockTime ?? 0) || undefined,
        maxFailures: Number(data.emergencyUnlockMaxFailures ?? 0) || undefined,
        lockoutSeconds: Number(data.emergencyUnlockLockoutSeconds ?? 0) || undefined
      });
    } catch (e) {
      console.info("[PCOFF] 잠금화면 문구 선로드 실패:", String(e));
    }
  }
  // 이석 감지로 연 잠금창이면 fetch 실패 여부와 관계없이 이석 화면(empty)으로 고정, config 기준 비밀번호·설정된 이석 잠금화면 문구 반영
  if (localLeaveSeatDetectedAt) {
    lastWorkTimeData.screenType = "empty";
    lastWorkTimeData.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
    const config = await readJson<{
      leaveSeatUnlockRequirePassword?: boolean;
      lockScreen?: { leave?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string } };
    }>(join(baseDir, PATHS.config), {});
    applyLeaveSeatUnlockRequirePasswordFromConfig(lastWorkTimeData, config);
    applyLockScreenLeaveFromConfig(lastWorkTimeData, config);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    currentScreen = "lock";
    mainWindow.setTitle("PCOFF 잠금화면");
    mainWindow.setVisibleOnAllWorkspaces(true);
    const primaryDisplay = screen.getPrimaryDisplay();
    mainWindow.setBounds(primaryDisplay.bounds);
    mainWindow.webContents.once("did-finish-load", () => {
      if (mainWindow && !mainWindow.isDestroyed() && currentScreen === "lock") {
        try {
          mainWindow.webContents.send("pcoff:lock-initial-work", lastWorkTimeData);
        } catch {
          // 이미 파괴 중이면 무시
        }
      }
    });
    await loadRendererInWindow(mainWindow, "lock.html").catch((err) => {
      console.error("[PCOFF] 잠금화면 로드 실패:", err);
    });
    if (mainWindow && !mainWindow.isDestroyed() && currentScreen === "lock") {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true, "screen-saver");
      mainWindow.setFullScreen(true);
    }
    setImmediate(() => {
      if (mainWindow && !mainWindow.isDestroyed() && currentScreen === "lock") {
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true, "screen-saver");
      }
    });
    await ensureLockWindowsForAllDisplays();
    // 디스플레이 목록 지연 대비: 500ms 후 보조 창 한 번 더 시도
    setTimeout(() => {
      if (currentScreen === "lock") void ensureLockWindowsForAllDisplays();
    }, 500);
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: primaryDisplay.bounds.width,
    height: primaryDisplay.bounds.height,
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    resizable: false,
    minimizable: true,
    closable: false,
    alwaysOnTop: true,
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
  attachWindowHotkeys(win);
  win.setVisibleOnAllWorkspaces(true);
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed() && currentScreen === "lock") {
      try {
        win.webContents.send("pcoff:lock-initial-work", lastWorkTimeData);
      } catch {
        // 이미 파괴 중이면 무시
      }
    }
  });
  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    if (currentScreen === "lock" && url && (url.includes("lock.html") || url.includes("lock"))) {
      console.error("[PCOFF] 잠금창 did-fail-load:", code, desc, url);
    }
  });
  await loadRendererInWindow(win, "lock.html").catch((err) => {
    console.error("[PCOFF] 잠금화면 로드 실패:", err);
  });
  if (win && !win.isDestroyed() && currentScreen === "lock") {
    win.show();
    win.focus();
    win.setFullScreen(true);
  }
  setImmediate(() => {
    if (win && !win.isDestroyed() && currentScreen === "lock") {
      win.focus();
      win.setAlwaysOnTop(true, "screen-saver");
    }
  });
  await ensureLockWindowsForAllDisplays();
  // 디스플레이 목록 지연(연결 직후 등) 대비: 잠금화면 표시 후 한 번 더 보조 창 생성 시도
  setTimeout(() => {
    if (currentScreen === "lock") void ensureLockWindowsForAllDisplays();
  }, 500);
}

/** 같은 창에 잠금 화면 로드. 문구 데이터 선로드 후 로드 (핫키와 동일하게 호출 보장) */
async function showLockInWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  const api = await getApiClient();
  if (api) {
    try {
      const data = await fetchWorkTimeWithLockScreen(api);
      const dataRecord = data as Record<string, unknown>;
      preserveLocalPcExCountIfHigher(dataRecord);
      lastWorkTimeData = dataRecord;
      applyResolvedScreenType(lastWorkTimeData);
      lastWorkTimeFetchedAt = new Date().toISOString();
      leaveSeatDetector.updatePolicy({
        leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
        leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
      });
      emergencyUnlockManager?.updatePolicy({
        unlockTimeMinutes: Number(data.emergencyUnlockTime ?? 0) || undefined,
        maxFailures: Number(data.emergencyUnlockMaxFailures ?? 0) || undefined,
        lockoutSeconds: Number(data.emergencyUnlockLockoutSeconds ?? 0) || undefined
      });
    } catch {
      // 선로드 실패 시 무시, getWorkTime에서 다시 시도
    }
  }
  // 이석 감지로 연 잠금창이면 fetch 실패 여부와 관계없이 이석 화면(empty)으로 고정, config 기준 비밀번호·설정된 이석 잠금화면 문구 반영
  if (localLeaveSeatDetectedAt) {
    lastWorkTimeData.screenType = "empty";
    lastWorkTimeData.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
    const config = await readJson<{
      leaveSeatUnlockRequirePassword?: boolean;
      lockScreen?: { leave?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string } };
    }>(join(baseDir, PATHS.config), {});
    applyLeaveSeatUnlockRequirePasswordFromConfig(lastWorkTimeData, config);
    applyLockScreenLeaveFromConfig(lastWorkTimeData, config);
  }
  mainWindow = win;
  currentScreen = "lock";
  win.setTitle("PCOFF 잠금화면");
  win.setVisibleOnAllWorkspaces(true);
  const primaryDisplay = screen.getPrimaryDisplay();
  win.setBounds(primaryDisplay.bounds);
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed() && currentScreen === "lock") {
      try {
        win.webContents.send("pcoff:lock-initial-work", lastWorkTimeData);
      } catch {
        // 이미 파괴 중이면 무시
      }
    }
  });
  await loadRendererInWindow(win, "lock.html").catch((err) => {
    console.error("[PCOFF] 잠금화면 로드 실패 (showLockInWindow):", err);
  });
  if (win && !win.isDestroyed() && currentScreen === "lock") {
    win.show();
    win.focus();
    win.setAlwaysOnTop(true, "screen-saver");
    win.setFullScreen(true);
  }
  setImmediate(() => {
    if (win && !win.isDestroyed() && currentScreen === "lock") {
      win.focus();
      win.setAlwaysOnTop(true, "screen-saver");
    }
  });
  await ensureLockWindowsForAllDisplays();
  // 디스플레이 목록 지연(연결 직후 등) 대비: 잠금화면 표시 후 한 번 더 보조 창 생성 시도
  setTimeout(() => {
    if (currentScreen === "lock") void ensureLockWindowsForAllDisplays();
  }, 500);
}

/** 이미 잠금화면(종업/시업 전)이면 true. 이석은 잠금 해제된 상태에서만 체크. */
function isAlreadyLockedByWorkHours(): boolean {
  const base = resolveScreenType(
    lastWorkTimeData as Partial<WorkTimeResponse> & { screenType?: string },
    new Date(),
    false
  );
  return base === "off" || base === "before";
}

/** 로컬 이석 감지(유휴/절전) 시 잠금화면 표시. 잠금 해제된 에이전트 화면에서만 동작. 긴급해제(EMERGENCY_RELEASE) 중에만 이석 체크 제외, 임시연장·긴급사용은 이석 체크 적용. */
function showLockForLocalLeaveSeat(
  detectedAt: Date,
  reason: LeaveSeatDetectedReason,
  workSessionType?: "NORMAL" | "TEMP_EXTEND" | "EMERGENCY_USE"
): void {
  if (currentMode === "EMERGENCY_RELEASE") return;
  // 임시연장·긴급사용 중에는 resolveScreenType이 서버 기준이라 off로 나올 수 있음 → 이석 체크는 적용하므로 여기서는 스킵하지 않음
  if (currentMode !== "TEMP_EXTEND" && currentMode !== "EMERGENCY_USE" && isAlreadyLockedByWorkHours()) return;
  const wsType = workSessionType ?? "NORMAL";
  void leaveSeatReporter.reportStart(reason, wsType, detectedAt);
  localLeaveSeatDetectedAt = detectedAt;
  localLeaveSeatReason = reason;

  if (mainWindow && !mainWindow.isDestroyed()) {
    void showLockInWindow(mainWindow).then(() => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } else {
    void createLockWindow().then(() => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  }
}

/** 전역 핫키용 로그아웃: 로그인 정보 삭제 후 로그인 창 전환 */
async function doGlobalLogout(): Promise<void> {
  stopLockCheckInterval();
  leaveSeatReporter.stop();
  await clearLoginState(baseDir);
  lastWorkTimeData = {};
  lastWorkTimeFetchedAt = null;
  invalidateRuntimeConfigCache();
  await logger.write(LOG_CODES.LOGOUT, "INFO", { source: "globalShortcut" });
  createLoginWindow();
}

/**
 * 로그인 화면 (index.html)
 * 잠금화면과 같은 창(mainWindow) 재사용 — 로그인 후 잠금 시 같은 창에서 전환
 */
function createLoginWindow(): void {
  currentScreen = "login";
  closeAllLockWindows();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(false);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    currentScreen = "login";
    mainWindow.setSize(520, 620);
    mainWindow.setTitle("PCOFF 로그인");
    loadRendererInWindow(mainWindow, "index.html");
    mainWindow.show();
    mainWindow.focus();
    setImmediate(() => {
      if (mainWindow && !mainWindow.isDestroyed() && currentScreen === "login") {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        mainWindow.setSize(520, 620);
        mainWindow.focus();
      }
    });
    return;
  }

  const win = new BrowserWindow({
    width: 520,
    height: 620,
    resizable: false,
    maximizable: false,
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
  attachWindowHotkeys(win);
  loadRendererInWindow(win, "index.html");
}

/** 트레이용 fallback: 16x16 밝은 색(어두운 작업표시줄에서도 보이도록) */
function createTrayFallbackIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = 0xc0;
    buf[i * 4 + 1] = 0xc0;
    buf[i * 4 + 2] = 0xc0;
    buf[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

/**
 * 시스템 트레이 생성
 */
function createTray(): void {
  if (tray) return;

  // 트레이 아이콘 (Windows 패키징 시 app.asar 내 경로가 비어 보일 수 있음 → extraResources로 복사한 경로 우선)
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath;
  const baseCandidates = app.isPackaged
    ? [
        join(resourcesPath, "assets", "tray-icon.png"),
        join(appPath, "assets", "tray-icon.png"),
        join(__dirname, "../../../assets/tray-icon.png")
      ]
    : [join(__dirname, "../../../assets/tray-icon.png"), join(process.cwd(), "assets/tray-icon.png")];
  // Windows: ICO 권장(다중 해상도 포함 시 트레이 표시 안정)
  const winIco =
    process.platform === "win32"
      ? [
          join(resourcesPath, "assets", "icon.ico"),
          join(appPath, "assets", "icon.ico"),
          join(__dirname, "../../../assets/icon.ico")
        ]
      : [];
  const iconCandidates = [...baseCandidates, ...winIco];
  const iconPath = iconCandidates.find((p) => existsSync(p));
  let icon: Electron.NativeImage;
  if (iconPath) {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = createTrayFallbackIcon();
  } else {
    icon = createTrayFallbackIcon();
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
    showTrayInfoInCurrentWindow();
  });
  tray.on("double-click", () => {
    showTrayInfoInCurrentWindow();
  });
}

function updateTrayMenu(): void {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "PCOFF 작동정보",
      click: () => showTrayInfoInCurrentWindow()
    },
    {
      label: "잠금화면 열기",
      click: () => void createLockWindow()
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
  void logger.write(LOG_CODES.TRAY_MODE_CHANGED, "INFO", { from: prevMode, to: mode });
  updateTrayMenu();
  
  // 모드 변경 시 모든 창에 알림
  const windows = mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : [];
  for (const win of windows) {
    win?.webContents.send("pcoff:mode-changed", { mode });
  }
}

/** 서버에서 근태 조회 후 lastWorkTimeData·정책 갱신(긴급사용 완료 후 근태정보 반영용) */
async function refreshWorkTimeFromApi(): Promise<void> {
  const api = await getApiClient();
  if (!api) return;
  try {
    const data = await api.getPcOffWorkTime();
    const dataRecord = data as unknown as Record<string, unknown>;
    preserveLocalPcExCountIfHigher(dataRecord);
    lastWorkTimeData = dataRecord;
    applyResolvedScreenType(lastWorkTimeData);
    lastWorkTimeFetchedAt = new Date().toISOString();
    leaveSeatDetector.updatePolicy({
      leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
      leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
    });
    emergencyUnlockManager?.updatePolicy({
      unlockTimeMinutes: Number(data.emergencyUnlockTime ?? 0) || undefined,
      maxFailures: Number(data.emergencyUnlockMaxFailures ?? 0) || undefined,
      lockoutSeconds: Number(data.emergencyUnlockLockoutSeconds ?? 0) || undefined
    });
  } catch (e) {
    console.info("[PCOFF] refreshWorkTimeFromApi 실패:", String(e));
  }
  if (currentScreen === "lock") broadcastWorkTimeToLockWindows();
}

/** 잠금화면 표시 중일 때 모든 잠금창(주·보조)에 최신 근태 데이터 전송 — 임시연장 카운트 등 동기화 */
function broadcastWorkTimeToLockWindows(): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pcoff:lock-initial-work", lastWorkTimeData);
    }
    for (const win of lockWindowsByDisplayId.values()) {
      if (!win.isDestroyed()) win.webContents.send("pcoff:lock-initial-work", lastWorkTimeData);
    }
  } catch (e) {
    console.info("[PCOFF] broadcastWorkTimeToLockWindows:", String(e));
  }
}

/**
 * 서버가 pcExCount를 0으로 주어도, 이미 사용한 연장 횟수는 로컬 lastWorkTimeData를 유지해 덮어쓰지 않음.
 * API 응답 객체를 인자로 받아 필요 시 해당 객체를 mutate함. (createLockWindow, showLockInWindow, isLockRequired, getWorkTime 등에서 사용)
 */
function preserveLocalPcExCountIfHigher(apiData: Record<string, unknown>): void {
  const apiExCount = Number(apiData.pcExCount ?? 0);
  const localExCount = Number(lastWorkTimeData?.pcExCount ?? 0);
  if (localExCount >= 1 && apiExCount < localExCount) {
    apiData.pcExCount = lastWorkTimeData!.pcExCount;
    apiData.pcOffYmdTime = lastWorkTimeData!.pcOffYmdTime;
  }
}

/**
 * 서버 근태 기준 잠금 필요 여부.
 * 백엔드 정책: 잠금/잠금해제는 pcOnYmdTime(PC-ON 시각), pcOffYmdTime(PC-OFF 시각, 임시연장 반영) 두 값으로만 판단.
 * - 현재 시각 < pcOnYmdTime → 잠금(시업 전)
 * - 현재 시각 >= pcOffYmdTime → 잠금(종업 후)
 * - pcOnYmdTime <= 현재 시각 < pcOffYmdTime → 잠금 해제(사용 가능)
 * (pcOnYn은 해당 일자의 PC 사용 가능 여부일 뿐, 실시간 잠금 기준이 아님)
 * 임시연장(TEMP_EXTEND) 중에는 연장된 pcOffYmdTime 시각이 지나기 전까지 로컬 lastWorkTimeData로만 판단(서버 반영 지연 시에도 60분 유지).
 */
async function isLockRequired(): Promise<boolean> {
  // FR-15: 긴급해제 활성 중이면 잠금 스킵
  if (emergencyUnlockManager?.isActive) return false;

  // 긴급사용(EMERGENCY_USE) 중: 서버 근태 갱신 후, 긴급사용 종료 시각(emergencyEndDate)이 있으면 그 시각 전까지 잠금 스킵; 없으면 구간 동안 재잠금 안 함
  if (currentMode === "EMERGENCY_USE") {
    const api = await getApiClient();
    if (api) {
      try {
        const data = await api.getPcOffWorkTime();
        const dataRecord = data as unknown as Record<string, unknown>;
        preserveLocalPcExCountIfHigher(dataRecord);
        lastWorkTimeData = dataRecord;
        applyResolvedScreenType(lastWorkTimeData);
        lastWorkTimeFetchedAt = new Date().toISOString();
        leaveSeatDetector.updatePolicy({
          leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
          leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
        });
        const endStr = String((lastWorkTimeData as Record<string, unknown>).emergencyEndDate ?? "").trim();
        if (endStr && endStr !== "N" && endStr !== "null") {
          const endTime = parseYmdHm(endStr);
          if (endTime && new Date() < endTime) return false;
          if (endTime && new Date() >= endTime) {
            currentMode = "NORMAL";
            void logger.write(LOG_CODES.TRAY_MODE_CHANGED, "INFO", { from: "EMERGENCY_USE", to: "NORMAL", reason: "emergencyEndDate_passed" });
          }
        } else {
          return false;
        }
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }

  // 이석(로컬 감지 또는 서버 screenType=empty)이면 무조건 잠금
  if (localLeaveSeatDetectedAt !== null) return true;
  if ((lastWorkTimeData.screenType ?? "") === "empty") return true;

  const now = new Date();
  if (currentMode === "TEMP_EXTEND" && Object.keys(lastWorkTimeData).length > 0) {
    // 주기 잠금 검사에서도 서버 이석(screenType=empty) 반영: 최신 근태 조회 후 병합
    const api = await getApiClient();
    if (api) {
      try {
        const data = await api.getPcOffWorkTime();
        const extendedEnd = parseYmdHm(String(lastWorkTimeData.pcOffYmdTime ?? ""));
        if (extendedEnd && extendedEnd > new Date()) {
          const merged = { ...data } as Record<string, unknown>;
          merged.pcOffYmdTime = lastWorkTimeData.pcOffYmdTime;
          merged.pcExCount = lastWorkTimeData.pcExCount;
          merged.screenType = resolveScreenType(merged, new Date(), !!localLeaveSeatDetectedAt);
          lastWorkTimeData = { ...merged };
          leaveSeatDetector.updatePolicy({
            leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
            leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
          });
          if ((merged.screenType ?? "") === "empty") return true;
        }
      } catch {
        // 통신 실패 시 기존 lastWorkTimeData로 시간 기준만 판단
      }
    }
    const pcOnTime = parseYmdHm(String(lastWorkTimeData.pcOnYmdTime ?? ""));
    const pcOffTime = parseYmdHm(String(lastWorkTimeData.pcOffYmdTime ?? ""));
    if (pcOnTime && pcOffTime && now < pcOffTime) {
      const locked = now < pcOnTime || now >= pcOffTime;
      return locked;
    }
  }

  const api = await getApiClient();
  if (!api) {
    return false;
  }
  try {
    const data = await api.getPcOffWorkTime();
    const dataRecord = data as unknown as Record<string, unknown>;
    preserveLocalPcExCountIfHigher(dataRecord);
    lastWorkTimeData = dataRecord;
    applyResolvedScreenType(lastWorkTimeData);
    lastWorkTimeFetchedAt = new Date().toISOString();
    leaveSeatDetector.updatePolicy({
      leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
      leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
    });
    // FR-15: 서버 정책으로 긴급해제 시간·시도제한·차단시간 갱신
    emergencyUnlockManager?.updatePolicy({
      unlockTimeMinutes: Number(data.emergencyUnlockTime ?? 0) || undefined,
      maxFailures: Number(data.emergencyUnlockMaxFailures ?? 0) || undefined,
      lockoutSeconds: Number(data.emergencyUnlockLockoutSeconds ?? 0) || undefined
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
      pcoffEmergencyYesNo: data.pcoffEmergencyYesNo,
      emergencyUnlockTime: data.emergencyUnlockTime,
      emergencyUnlockMaxFailures: data.emergencyUnlockMaxFailures
    });
    void offlineManager.reportApiSuccess();

    // 이석(서버 screenType=empty)이면 잠금
    if ((lastWorkTimeData.screenType ?? "") === "empty") return true;

    // 잠금 기준: pcOnYmdTime / pcOffYmdTime 시각 비교 (백엔드 정책)
    const pcOnTime = parseYmdHm(data.pcOnYmdTime);
    const pcOffTime = parseYmdHm(data.pcOffYmdTime);
    const now = new Date();
    if (pcOnTime && pcOffTime) {
      const locked = now < pcOnTime || now >= pcOffTime;
      return locked;
    }
    // 파싱 불가 시 기존 pcOnYn fallback (하위 호환)
    return data.pcOnYn === "N";
  } catch (err) {
    // 서버 HTTP 4xx/5xx는 통신 성공 → 오프라인 아님. 네트워크 오류일 때만 오프라인으로 보고
    const msg = err instanceof Error ? err.message : String(err);
    const isHttpError = /\bfailed:\s*[45]\d{2}\b/.test(msg);
    if (!isHttpError) void offlineManager.reportApiFailure("api");
    return false;
  }
}

/** 잠금 필요 시 잠금화면 표시. reuseWindow 있으면 그 창에 로드(새 창 X). 이미 잠금화면이면 reload 하지 않음(팝업 유지). */
async function checkLockAndShowLockWindow(reuseWindow?: BrowserWindow | null): Promise<boolean> {
  const locked = await isLockRequired();
  if (!locked) return false;
  const screenType = (lastWorkTimeData.screenType ?? "off") as string;
  if (screenType === "before") void logger.write(LOG_CODES.SCREEN_TYPE_BEFORE, "INFO", {});
  else if (screenType === "off") void logger.write(LOG_CODES.SCREEN_TYPE_OFF, "INFO", {});
  else if (screenType === "empty") { /* 이석은 LEAVE_SEAT_* 로그로 기록됨 */ }
  if (reuseWindow && !reuseWindow.isDestroyed()) {
    if (currentScreen === "lock" && mainWindow === reuseWindow) {
      return true;
    }
    await showLockInWindow(reuseWindow);
    void logger.write(LOG_CODES.LOCK_TRIGGERED, "INFO", { reason: "usage_time_ended" });
    return true;
  }
  if (currentScreen === "lock" && mainWindow && !mainWindow.isDestroyed()) {
    return true;
  }
  void createLockWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    void logger.write(LOG_CODES.LOCK_TRIGGERED, "INFO", { reason: "usage_time_ended" });
  }
  return true;
}

let lockCheckIntervalId: ReturnType<typeof setInterval> | null = null;
const LOCK_CHECK_INTERVAL_MS = 60_000; // 1분

/** 재시작 후 state.json에 저장된 임시연장이 만료 전이면 lastWorkTimeData·currentMode 복원 */
async function restoreTempExtendState(): Promise<void> {
  const loaded = await loadTempExtendState(baseDir);
  if (!loaded) return;
  const untilTime = parseYmdHm(loaded.until);
  if (!untilTime || untilTime <= new Date()) return;
  lastWorkTimeData = { ...loaded.snapshot };
  applyResolvedScreenType(lastWorkTimeData);
  lastWorkTimeFetchedAt = new Date().toISOString();
  setOperationMode("TEMP_EXTEND");
}

let lockCheckRestorePending = false;
function startLockCheckInterval(): void {
  if (lockCheckIntervalId || lockCheckRestorePending) return;
  lockCheckRestorePending = true;
  void (async () => {
    await restoreTempExtendState();
    lockCheckRestorePending = false;
    if (lockCheckIntervalId) return;
    lockCheckIntervalId = setInterval(() => {
      void checkLockAndShowLockWindow(mainWindow ?? undefined);
    }, LOCK_CHECK_INTERVAL_MS);
    startLockPolicyPolling();
  })();
}

/** FR-14: 30분 주기 정책 폴링 — Publish/Rollback 반영. 버전 비교 후 변경 시 캐시 갱신 */
function startLockPolicyPolling(): void {
  if (policyPollingIntervalId || !cachedUserServareaId) return;
  policyPollingIntervalId = setInterval(() => {
    void (async () => {
      try {
        const api = await getApiClient();
        if (!api || !cachedUserServareaId) return;
        const policy = await api.getLockPolicy(cachedUserServareaId);
        if (!policy?.lockScreen?.screens && !policy?.unlockPolicy) return;
        const versionChanged =
          policy.version !== lastCachedLockPolicy?.version ||
          lastCachedLockPolicy == null;
        if (versionChanged) {
          lastCachedLockPolicy = policy;
          lastCachedLockPolicyAt = Date.now();
          console.info("[PCOFF] 잠금 정책 폴링 — 캐시 갱신, version:", policy.version);
        }
      } catch {
        // 서버 미구현/네트워크 시 무시
      }
    })();
  }, LOCK_POLICY_CACHE_TTL_MS);
}

function stopLockCheckInterval(): void {
  if (lockCheckIntervalId) {
    clearInterval(lockCheckIntervalId);
    lockCheckIntervalId = null;
  }
}

app.whenReady().then(async () => {
  // 맥 패키징 시 asar 내부 file:// 차단 우회: app:// 로 리소스 제공
  if (process.platform === "darwin" && app.isPackaged) {
    const MIME: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".svg": "image/svg+xml"
    };
    protocol.handle("app", async (request) => {
      const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, "");
      const filePath = join(app.getAppPath(), pathname);
      try {
        const buf = await readFile(filePath);
        const mime = MIME[extname(filePath)] ?? "application/octet-stream";
        return new Response(buf, { headers: { "Content-Type": mime } });
      } catch (e) {
        console.error("[PCOFF] app protocol failed:", filePath, e);
        return new Response("Not Found", { status: 404 });
      }
    });
  }

  app.setName(APP_NAME);
  // 설치 앱: userData 사용(개발 시 state와 분리). 개발: process.cwd()
  baseDir = app.isPackaged ? app.getPath("userData") : process.cwd();
  // 로그·설정 폴더가 없으면 생성 (폴더 경로 확인 시 해당 경로가 존재하도록)
  try {
    mkdirSync(join(baseDir, PATHS.logsDir), { recursive: true });
  } catch { /* ignore */ }
  if (app.isPackaged) {
    const userConfigPath = join(baseDir, "config.json");
    const bundledConfigPath = join(process.resourcesPath, "config.json");
    if (!existsSync(userConfigPath) && existsSync(bundledConfigPath)) {
      // 첫 실행: 번들에서 apiBaseUrl + 잠금화면 설정(lockScreen, lockScreenApiUrl) 복사. 로그인 정보는 제외.
      try {
        mkdirSync(baseDir, { recursive: true });
        const raw = readFileSync(bundledConfigPath, "utf-8");
        const bundled = JSON.parse(raw) as Record<string, unknown>;
        const safeConfig: Record<string, unknown> = {};
        if (bundled.apiBaseUrl) safeConfig.apiBaseUrl = bundled.apiBaseUrl;
        if (bundled.lockScreenApiUrl != null) safeConfig.lockScreenApiUrl = bundled.lockScreenApiUrl;
        if (bundled.sendLockPassUrl != null) safeConfig.sendLockPassUrl = bundled.sendLockPassUrl;
        if (bundled.lockScreen != null && typeof bundled.lockScreen === "object" && !Array.isArray(bundled.lockScreen)) {
          safeConfig.lockScreen = bundled.lockScreen;
        }
        writeFileSync(userConfigPath, JSON.stringify(safeConfig, null, 2), "utf-8");
        console.info("[PCOFF] config.json created in userData (apiBaseUrl, lockScreen, lockScreenApiUrl)");
      } catch (e) {
        console.warn("[PCOFF] Failed to create config from bundle:", e);
      }
    } else if (existsSync(userConfigPath)) {
      // 기존 설치: 로그인 정보 제거(마이그레이션) + 잠금화면 설정 없으면 번들에서 보강
      try {
        const raw = readFileSync(userConfigPath, "utf-8");
        const cfg = JSON.parse(raw) as Record<string, unknown>;
        let changed = false;
        if (cfg.userServareaId || cfg.userStaffId) {
          const { userServareaId: _a, userStaffId: _b, ...clean } = cfg;
          Object.assign(cfg, clean);
          changed = true;
        }
        const bundledConfigPath = join(process.resourcesPath, "config.json");
        if (existsSync(bundledConfigPath)) {
          const bundled = JSON.parse(readFileSync(bundledConfigPath, "utf-8")) as Record<string, unknown>;
          if (cfg.lockScreen == null && bundled.lockScreen != null && typeof bundled.lockScreen === "object" && !Array.isArray(bundled.lockScreen)) {
            cfg.lockScreen = bundled.lockScreen;
            changed = true;
          }
          if (cfg.lockScreenApiUrl == null && bundled.lockScreenApiUrl != null) {
            cfg.lockScreenApiUrl = bundled.lockScreenApiUrl;
            changed = true;
          }
          if (cfg.sendLockPassUrl == null && bundled.sendLockPassUrl != null) {
            cfg.sendLockPassUrl = bundled.sendLockPassUrl;
            changed = true;
          }
        }
        if (changed) {
          writeFileSync(userConfigPath, JSON.stringify(cfg, null, 2), "utf-8");
          console.info("[PCOFF] config.json: migration applied (login fields removed and/or lockScreen from bundle)");
        }
      } catch { /* ignore parse errors */ }
    }
  }
  logger = new TelemetryLogger(baseDir, machine.getSessionId(), process.platform);
  updater = new UpdateManager(baseDir, logger, app.getVersion());
  observer = new OpsObserver(logger, () => getApiBaseUrl(baseDir));
  authPolicy = new AuthPolicy(logger);
  guard = new AgentGuard(baseDir, logger);
  leaveSeatReporter = new LeaveSeatReporter(
    baseDir,
    logger,
    () => cachedApiBaseUrl,
    () => ({
      workYmd: getTodayYmd(),
      userServareaId: cachedUserServareaId,
      userStaffId: cachedUserStaffId,
      deviceId: machine.getSessionId(),
      clientVersion: app.getVersion()
    })
  );

  await logger.write(LOG_CODES.APP_START, "INFO", { platform: process.platform });

  // FR-09: 설치자 레지스트리 초기화 및 서버 동기화 시도 (FR-19 인스톨 감사 로그)
  void (async () => {
    try {
      const userDisplay = await getLoginUserDisplay(baseDir);
      const appVersion = app.getVersion();
      const { registry, created } = await loadOrCreateInstallerRegistry(
        baseDir,
        appVersion,
        userDisplay.loginUserId ?? "unknown"
      );
      if (created) {
        await logger.write(LOG_CODES.INSTALL_START, "INFO", { deviceId: registry.deviceId });
        await logger.write(LOG_CODES.INSTALL_SUCCESS, "INFO", {
          deviceId: registry.deviceId,
          installedAt: registry.installedAt
        });
      }
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
          if (created) {
            await logger.write(LOG_CODES.INSTALL_FAIL, "WARN", {
              deviceId: registry.deviceId,
              reason: "server_sync_failed"
            });
          }
        }
      }
    } catch (err) {
      await logger.write(LOG_CODES.INSTALLER_REGISTRY_FAIL, "WARN", {
        reason: String(err)
      });
    }
  })();

  // FR-15: Emergency Unlock Manager 초기화
  emergencyUnlockManager = new EmergencyUnlockManager(baseDir, logger);
  emergencyUnlockManager.setCallback((event) => {
    if (event === "expired") {
      setOperationMode("NORMAL");
      // 긴급해제 만료 → 잠금 필요 여부 재확인
      void checkLockAndShowLockWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("pcoff:emergency-unlock-expired", {});
      }
    } else if (event === "expiry_warning") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("pcoff:emergency-unlock-expiring", { remainingSec: 300 });
      }
    }
  });
  await emergencyUnlockManager.restore();

  // FR-17: Offline Manager 초기화 — heartbeat/API 실패 기반 오프라인 감지·유예·잠금
  offlineManager = new OfflineManager(baseDir, logger);
  offlineManager.setOnStateChange((state: ConnectivityState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pcoff:connectivity-changed", { state });
    }
    if (state === "OFFLINE_GRACE" || state === "OFFLINE_LOCKED") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        void showLockInWindow(mainWindow).then(() => {
          mainWindow?.show();
          mainWindow?.focus();
        });
      } else {
        void createLockWindow().then(() => {
          mainWindow?.show();
          mainWindow?.focus();
        });
      }
    } else if (state === "ONLINE") {
      if (currentScreen === "lock" && !isolationModeActive) {
        showTrayInfoInCurrentWindow();
      }
    }
  });
  await offlineManager.restore();

  // FR-08: Ops Observer 시작 (heartbeat + 로그 서버 전송)
  observer.setCallbacks({
    onHeartbeatFail: () => void offlineManager.reportApiFailure("heartbeat"),
    onHeartbeatSuccess: () => void offlineManager.reportApiSuccess()
  });
  observer.start();
  // FR-07: Agent Guard 시작 (무결성 감시)
  await guard.start();
  const isolationState = await readIsolationState(baseDir);
  isolationModeActive = !!isolationState;
  if (isolationModeActive) {
    console.warn("[PCOFF] 격리 모드 활성 — 복구 실패로 진입. 잠금 유지.", isolationState?.enteredAt);
  }

  // 시스템 트레이 생성 (실패 시에도 앱은 계속 실행, Windows에서 아이콘 경로 등 이슈 대비)
  try {
    createTray();
  } catch (err) {
    console.error("[PCOFF] Tray creation failed:", err);
  }

  // §7·§11 다중 디스플레이: 핫플러그 시 보조 잠금창 동기화
  screen.on("display-added", () => {
    if (currentScreen === "lock") void ensureLockWindowsForAllDisplays();
  });
  screen.on("display-removed", (_event, display) => {
    const win = lockWindowsByDisplayId.get(display.id);
    if (win && !win.isDestroyed()) win.destroy();
    lockWindowsByDisplayId.delete(display.id);
  });

  // 개발자용 전역 핫키 — 강제로 등록. macOS: 손쉬운 사용 허용 필요, Windows: 앱 포커스 없어도 동작하도록 즉시+지연 재등록
  const hotkeys: [string, () => void][] = [
    ["CommandOrControl+Shift+L", () => void doGlobalLogout()],
    ["CommandOrControl+Shift+I", () => showTrayInfoInCurrentWindow()],
    ["CommandOrControl+Shift+K", () => void createLockWindow()],
    ["Ctrl+Shift+Q", () => {
      isForceQuit = true;
      app.quit();
    }] // 개발자 전용 강제 종료. 맥은 Control(^)+Shift+Q만 사용 (Cmd+Shift+Q는 시스템과 겹침 방지)
  ];
  const registerHotkeys = () => {
    for (const [accel, fn] of hotkeys) {
      try {
        globalShortcut.unregister(accel);
        const ok = globalShortcut.register(accel, fn);
        if (ok) console.info("[PCOFF] 핫키 등록:", accel);
        else console.warn("[PCOFF] 핫키 등록 실패(이미 사용 중?):", accel);
      } catch (e) {
        console.warn("[PCOFF] 핫키 등록 실패:", accel, e, "(macOS: 손쉬운 사용 허용 확인)");
      }
    }
  };
  registerHotkeys();
  if (process.platform === "win32") {
    setTimeout(registerHotkeys, 500);
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

  if (isolationModeActive) {
    await createLockWindow();
    mainWindow?.show();
    mainWindow?.focus();
  } else if (hasLogin) {
    cachedApiBaseUrl = config?.apiBaseUrl ?? null;
    cachedUserServareaId = config?.userServareaId ?? "";
    cachedUserStaffId = config?.userStaffId ?? "";

    // 재시작 시 임시연장 복원을 먼저 적용해 lastWorkTimeData·currentMode 설정 후 잠금 검사 (복원 전에 checkLock이 돌면 연장 횟수 0으로 보임)
    await restoreTempExtendState();
    startLockCheckInterval();
    leaveSeatReporter.start();

    leaveSeatDetector.start({
      isLeaveSeatActive: () => localLeaveSeatDetectedAt !== null,
      onIdleDetected: (detectedAt, idleSeconds) => {
        void logger.write(LOG_CODES.LEAVE_SEAT_IDLE_DETECTED, "INFO", {
          detectedAt: detectedAt.toISOString(),
          idleSeconds,
          leaveSeatTimeMinutes: lastWorkTimeData?.leaveSeatTime ?? 0
        });
        const wsType = currentMode === "TEMP_EXTEND" ? "TEMP_EXTEND"
          : currentMode === "EMERGENCY_USE" ? "EMERGENCY_USE" : "NORMAL";
        showLockForLocalLeaveSeat(detectedAt, "INACTIVITY", wsType);
      },
      onSleepDetected: (detectedAt, sleepElapsedSeconds) => {
        void logger.write(LOG_CODES.LEAVE_SEAT_SLEEP_DETECTED, "INFO", {
          detectedAt: detectedAt.toISOString(),
          sleepElapsedSeconds,
          leaveSeatTimeMinutes: lastWorkTimeData?.leaveSeatTime ?? 0
        });
        const wsType = currentMode === "TEMP_EXTEND" ? "TEMP_EXTEND"
          : currentMode === "EMERGENCY_USE" ? "EMERGENCY_USE" : "NORMAL";
        showLockForLocalLeaveSeat(detectedAt, "SLEEP_EXCEEDED", wsType);
      },
      onSleepEntered: () => void logger.write(LOG_CODES.SLEEP_ENTERED, "INFO", {}),
      onSleepResumed: () => void logger.write(LOG_CODES.SLEEP_RESUMED, "INFO", {})
    });
    leaveSeatDetector.updatePolicy({
      leaveSeatUseYn: normalizeLeaveSeatUseYn(lastWorkTimeData?.leaveSeatUseYn),
      leaveSeatTimeMinutes: Number(lastWorkTimeData?.leaveSeatTime ?? 0) || 0
    });

    const lockOpened = await checkLockAndShowLockWindow();
    if (!lockOpened) showTrayInfoInCurrentWindow();
  } else {
    // 로그인 필요: 로그인 창 표시
    createLoginWindow();
  }

  // 앱 시작 시 자동 업데이트 검사 (백그라운드, UI 준비 후)
  const STARTUP_UPDATE_CHECK_DELAY_MS = 5000;
  setTimeout(() => {
    void updater.checkAndApplySilently().then((status) => {
      if (status.state === "available" || status.state === "downloading") {
        console.info("[PCOFF] 업데이트 검사: 새 버전 발견", status.version);
      } else if (status.state === "not-available") {
        console.info("[PCOFF] 업데이트 검사: 최신 버전");
      }
    });
  }, STARTUP_UPDATE_CHECK_DELAY_MS);
});

app.on("window-all-closed", () => {
  // 트레이 앱이므로 창이 모두 닫혀도 앱은 종료하지 않음 (macOS Dock 유지)
  // 강제 종료(Ctrl+Shift+Q)로 창이 닫힌 경우에만 실제 종료
  if (isForceQuit) {
    app.exit(0);
  }
});

// macOS: Dock 아이콘 클릭 시 창이 없으면 에이전트 화면 열기 (격리 모드면 잠금 창)
app.on("activate", () => {
  const hasVisibleWindow =
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  if (!hasVisibleWindow) {
    if (isolationModeActive) void createLockWindow();
    else showTrayInfoInCurrentWindow();
  } else {
    const w = mainWindow!;
    if (!w.isFullScreen() && (currentScreen === "tray-info" || currentScreen === "login")) {
      if (w.isMaximized()) w.unmaximize();
      w.setSize(currentScreen === "login" ? 520 : 620, currentScreen === "login" ? 620 : 840);
    }
    w.show();
    w.focus();
  }
});

app.on("before-quit", async (e) => {
  // 다운로드 중/대기 중에는 의도치 않은 종료 방지 (사용자가 '지금 재시작'을 누를 때만 적용)
  const updateStatus = updater.getStatus();
  if (updateStatus.state === "downloading" || updateStatus.state === "available") {
    e.preventDefault();
    return;
  }
  // 업데이트 적용은 '지금 재시작' 버튼(IPC pcoff:quitAndInstallUpdate)으로만 수행. 일반 종료 시에는 설치하지 않음.

  globalShortcut.unregisterAll();
  stopLockCheckInterval();
  leaveSeatDetector.stop();
  leaveSeatReporter?.stop();
  offlineManager?.stop();
  emergencyUnlockManager?.stop();
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
/** 다운로드된 업데이트가 있으면 즉시 종료 후 설치 실행. 트레이 앱은 창만 닫으면 before-quit가 호출되지 않으므로 이 IPC로 명시적 재시작. */
ipcMain.handle("pcoff:quitAndInstallUpdate", async () => {
  if (!updater.hasDownloadedUpdate()) return { applied: false };
  // Windows NSIS: quitAndInstall 직후 설치 프로세스가 스폰되기 전에 앱이 종료되는 이슈 완화를 위해 짧은 지연
  await new Promise((r) => setTimeout(r, 400));
  const applied = updater.quitAndInstallIfDownloaded();
  return { applied };
});
ipcMain.handle("pcoff:getUpdateStatus", async () => updater.getStatus());
ipcMain.handle("pcoff:hasDownloadedUpdate", () => updater.hasDownloadedUpdate());
ipcMain.handle("pcoff:getAppVersion", async () => updater.getAppVersion());
ipcMain.handle("pcoff:getLogsPath", () => join(baseDir, PATHS.logsDir));
ipcMain.handle("pcoff:openLogsFolder", async () => {
  const path = join(baseDir, PATHS.logsDir);
  mkdirSync(path, { recursive: true });
  await shell.openPath(path);
  return { ok: true };
});

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
      await logger.write(LOG_CODES.LOGIN_SUCCESS, "INFO", { loginUserId: payload.loginUserId });
      return {
        success: true,
        userServareaId,
        userStaffId,
        loginUserNm: res.loginUserNm
      };
    } catch (error) {
      await logger.write(LOG_CODES.LOGIN_FAIL, "WARN", { error: String(error) });
      return { success: false, error: String(error) };
    }
  }
);
ipcMain.handle("pcoff:logout", async () => {
  stopLockCheckInterval();
  leaveSeatReporter.stop();
  await clearLoginState(baseDir);
  lastWorkTimeData = {};
  lastWorkTimeFetchedAt = null;
  invalidateRuntimeConfigCache();
  await logger.write(LOG_CODES.LOGOUT, "INFO", {});
  return { success: true };
});
const RECENT_WORKTIME_CACHE_MS = 2500;

/** 이석 화면(screenType=empty)일 때 config.leaveSeatUnlockRequirePassword가 true면 비밀번호 모달 노출용으로 병합 */
function applyLeaveSeatUnlockRequirePasswordFromConfig(
  data: Record<string, unknown>,
  config: { leaveSeatUnlockRequirePassword?: boolean }
): void {
  if (config.leaveSeatUnlockRequirePassword === true && (data.screenType ?? "") === "empty") {
    data.leaveSeatUnlockRequirePassword = true;
  }
}

/** 이석 화면일 때 config.lockScreen.leave(설정된 이석 잠금화면 문구·배경) 병합 */
function applyLockScreenLeaveFromConfig(
  data: Record<string, unknown>,
  config: { lockScreen?: { leave?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string } } }
): void {
  if ((data.screenType ?? "") !== "empty") return;
  const ls = config.lockScreen?.leave;
  if (!ls) return;
  if (!data.lockScreenLeaveTitle && ls.title) data.lockScreenLeaveTitle = ls.title;
  if (!data.lockScreenLeaveMessage && ls.message) data.lockScreenLeaveMessage = ls.message;
  if (!data.lockScreenLeaveBackground && ls.backgroundUrl) data.lockScreenLeaveBackground = ls.backgroundUrl;
  if (!data.lockScreenLeaveLogo && ls.logoUrl) data.lockScreenLeaveLogo = ls.logoUrl;
}

type ConfigForLeave = {
  leaveSeatUnlockRequirePassword?: boolean;
  lockScreen?: { leave?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string } };
};

ipcMain.handle("pcoff:getWorkTime", async () => {
  const config = await readJson<ConfigForLeave>(join(baseDir, PATHS.config), {});
  const api = await getApiClient();
  if (!api) {
    const mockData = buildMockWorkTime() as Record<string, unknown>;
    if (localLeaveSeatDetectedAt) {
      mockData.screenType = "empty";
      mockData.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
      applyLockScreenLeaveFromConfig(mockData, config);
    }
    applyLeaveSeatUnlockRequirePasswordFromConfig(mockData, config);
    logLoadedConfig("근태정보 (getWorkTime IPC, mock)", { source: "mock", pcOnYn: mockData.pcOnYn, screenType: mockData.screenType });
    return { source: "mock", data: mockData };
  }

  // 핫키/잠금창 오픈 시 선로드한 캐시가 있으면 재호출 없이 반환 (문구 데이터 호출 보장)
  if (lastWorkTimeFetchedAt) {
    const age = Date.now() - new Date(lastWorkTimeFetchedAt).getTime();
    if (age >= 0 && age < RECENT_WORKTIME_CACHE_MS) {
      const merged = { ...lastWorkTimeData } as Record<string, unknown>;
      if (localLeaveSeatDetectedAt) {
        merged.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
        merged.screenType = "empty";
        applyLockScreenLeaveFromConfig(merged, config);
      } else {
        merged.screenType = resolveScreenType(merged, new Date(), !!localLeaveSeatDetectedAt);
      }
      applyLeaveSeatUnlockRequirePasswordFromConfig(merged, config);
      return { source: "api", data: merged };
    }
  }

  try {
    const data = await fetchWorkTimeWithLockScreen(api);

    // 임시연장 중 연장 만료 시각이 아직 미래면 서버 재조회로 lastWorkTimeData 덮어쓰지 않음 (재조회 시 다시 잠금 방지)
    if (
      currentMode === "TEMP_EXTEND" &&
      Object.keys(lastWorkTimeData).length > 0
    ) {
      const extendedEnd = parseYmdHm(String(lastWorkTimeData.pcOffYmdTime ?? ""));
      if (extendedEnd && extendedEnd > new Date()) {
        leaveSeatDetector.updatePolicy({
          leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
          leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
        });
        emergencyUnlockManager?.updatePolicy({
          unlockTimeMinutes: Number(data.emergencyUnlockTime ?? 0) || undefined,
          maxFailures: Number(data.emergencyUnlockMaxFailures ?? 0) || undefined,
          lockoutSeconds: Number(data.emergencyUnlockLockoutSeconds ?? 0) || undefined
        });
        const merged = { ...data } as Record<string, unknown>;
        merged.pcOffYmdTime = lastWorkTimeData.pcOffYmdTime;
        merged.pcExCount = lastWorkTimeData.pcExCount;
        if (localLeaveSeatDetectedAt) {
          merged.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
          merged.screenType = "empty";
          applyLockScreenLeaveFromConfig(merged, config);
        } else {
          merged.screenType = resolveScreenType(merged, new Date(), !!localLeaveSeatDetectedAt);
        }
        lastWorkTimeFetchedAt = new Date().toISOString();
        if (data.pwdChgYn === "Y") {
          await authPolicy.onPasswordChangeDetected("getPcOffWorkTime", data.pwdChgMsg);
          const windows = mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : [];
          for (const win of windows) {
            win?.webContents.send("pcoff:password-change-detected", {
              message: data.pwdChgMsg || "비밀번호가 변경되었습니다. 확인 버튼을 눌러주세요.",
            });
          }
        }
        // 서버 이석(screenType=empty) 반영: 주기 잠금 검사·checkLockAndShowLockWindow에서 사용하도록 lastWorkTimeData 갱신 (pcOffYmdTime/pcExCount는 로컬 유지)
        lastWorkTimeData = { ...merged };
        applyLeaveSeatUnlockRequirePasswordFromConfig(merged, config);
        return { source: "api", data: merged };
      }
    }

    // 서버가 pcExCount를 0으로 주어도, 오늘 이미 사용한 연장 횟수는 로컬에서 유지 (잠금화면 배지·작동정보 일치)
    const dataRecord = data as Record<string, unknown>;
    preserveLocalPcExCountIfHigher(dataRecord);

    lastWorkTimeData = dataRecord;
    applyResolvedScreenType(lastWorkTimeData);
    lastWorkTimeFetchedAt = new Date().toISOString();
    leaveSeatDetector.updatePolicy({
      leaveSeatUseYn: normalizeLeaveSeatUseYn(data.leaveSeatUseYn),
      leaveSeatTimeMinutes: Number(data.leaveSeatTime ?? 0) || 0
    });
    emergencyUnlockManager?.updatePolicy({
      unlockTimeMinutes: Number(data.emergencyUnlockTime ?? 0) || undefined,
      maxFailures: Number(data.emergencyUnlockMaxFailures ?? 0) || undefined,
      lockoutSeconds: Number(data.emergencyUnlockLockoutSeconds ?? 0) || undefined
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
      leaveSeatReasonManYn: data.leaveSeatReasonManYn,
      emergencyUnlockTime: data.emergencyUnlockTime
    });

    if (data.pwdChgYn === "Y") {
      await authPolicy.onPasswordChangeDetected("getPcOffWorkTime", data.pwdChgMsg);
      const windows = mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : [];
      for (const win of windows) {
        win?.webContents.send("pcoff:password-change-detected", {
          message: data.pwdChgMsg || "비밀번호가 변경되었습니다. 확인 버튼을 눌러주세요.",
        });
      }
    }

    const merged = { ...data } as Record<string, unknown>;
    if (localLeaveSeatDetectedAt) {
      merged.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
      merged.screenType = "empty";
      applyLockScreenLeaveFromConfig(merged, config);
    } else {
      merged.screenType = resolveScreenType(merged, new Date(), !!localLeaveSeatDetectedAt);
    }
    applyLeaveSeatUnlockRequirePasswordFromConfig(merged, config);
    return { source: "api", data: merged };
  } catch (error) {
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "getPcOffWorkTime", error: String(error) });
    const fallbackData = buildMockWorkTime() as Record<string, unknown>;
    if (localLeaveSeatDetectedAt) {
      fallbackData.screenType = "empty";
      fallbackData.leaveSeatOffInputMath = formatYmdHm(localLeaveSeatDetectedAt);
    }
    // API 실패 시에도 config.json 잠금화면 문구 적용
    try {
      const config = await readJson<{
        lockScreen?: {
          before?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string };
          off?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string };
          leave?: { title?: string; message?: string; backgroundUrl?: string; logoUrl?: string };
        };
      }>(join(baseDir, PATHS.config), {});
      const ls = config.lockScreen;
      if (ls) {
        if (ls.before?.title) fallbackData.lockScreenBeforeTitle = ls.before.title;
        if (ls.before?.message) fallbackData.lockScreenBeforeMessage = ls.before.message;
        if (ls.before?.backgroundUrl) fallbackData.lockScreenBeforeBackground = ls.before.backgroundUrl;
        if (ls.before?.logoUrl) fallbackData.lockScreenBeforeLogo = ls.before.logoUrl;
        if (ls.off?.title) fallbackData.lockScreenOffTitle = ls.off.title;
        if (ls.off?.message) fallbackData.lockScreenOffMessage = ls.off.message;
        if (ls.off?.backgroundUrl) fallbackData.lockScreenOffBackground = ls.off.backgroundUrl;
        if (ls.off?.logoUrl) fallbackData.lockScreenOffLogo = ls.off.logoUrl;
        if (ls.leave?.title) fallbackData.lockScreenLeaveTitle = ls.leave.title;
        if (ls.leave?.message) fallbackData.lockScreenLeaveMessage = ls.leave.message;
        if (ls.leave?.backgroundUrl) fallbackData.lockScreenLeaveBackground = ls.leave.backgroundUrl;
        if (ls.leave?.logoUrl) fallbackData.lockScreenLeaveLogo = ls.leave.logoUrl;
      }
    } catch {
      // ignore
    }
    applyLeaveSeatUnlockRequirePasswordFromConfig(fallbackData, config);
    return { source: "fallback", data: fallbackData, error: String(error) };
  }
});

ipcMain.handle("pcoff:requestPcExtend", async (_event, payload: { pcOffYmdTime?: string }): Promise<ActionResult> => {
  const api = await getApiClient();
  if (!api) return { source: "mock", success: true };
  const maxCount = Number(lastWorkTimeData?.pcExMaxCount ?? 0);
  const currentCount = Number(lastWorkTimeData?.pcExCount ?? 0);
  if (maxCount > 0 && currentCount >= maxCount) {
    return { source: "api", success: false, error: "임시연장 가능 횟수를 모두 사용했습니다." };
  }
  try {
    const pcOffYmdTime = payload.pcOffYmdTime ?? buildMockWorkTime().pcOffYmdTime ?? "";
    const extCount = currentCount + 1;
    const data = await api.callPcOffTempDelay(pcOffYmdTime, extCount);
    console.info("[PCOFF] callPcOffTempDelay 응답:", JSON.stringify(data));
    await logger.write(LOG_CODES.UNLOCK_TRIGGERED, "INFO", {
      action: "pc_extend",
      pcOffYmdTime,
      extCount,
      callPcOffTempDelayResponse: data
    });
    setOperationMode("TEMP_EXTEND");
    const workTime = await api.getPcOffWorkTime();
    const wt = workTime as Record<string, unknown>;
    console.info("[PCOFF] 직후 getPcOffWorkTime 응답 (서버 반영 확인용):", {
      pcExCount: wt.pcExCount,
      pcOffYmdTime: wt.pcOffYmdTime,
      pcOnYmdTime: wt.pcOnYmdTime
    });
    await logger.write(LOG_CODES.UNLOCK_TRIGGERED, "INFO", {
      action: "getPcOffWorkTime_after_extend",
      pcExCount: wt.pcExCount,
      pcOffYmdTime: wt.pcOffYmdTime
    });
    const now = new Date();
    let merged = { ...workTime, pcExCount: extCount } as Record<string, unknown>;
    const pcOffParsed = parseYmdHm(String(merged.pcOffYmdTime ?? ""));
    const pcExTimeMin = Number(merged.pcExTime ?? 60) || 60;
    if (!pcOffParsed || pcOffParsed <= now) {
      const extendedEnd = new Date(now.getTime() + pcExTimeMin * 60 * 1000);
      merged.pcOffYmdTime = formatYmdHm(extendedEnd);
    }
    lastWorkTimeData = merged;
    applyResolvedScreenType(lastWorkTimeData);
    lastWorkTimeFetchedAt = new Date().toISOString();
    const untilYmdHm = String(merged.pcOffYmdTime ?? "");
    if (untilYmdHm) void saveTempExtendState(baseDir, { ...merged }, untilYmdHm);
    showTrayInfoInCurrentWindow();
    return { source: "api", success: true, data: workTime };
  } catch (error) {
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffTempDelay", error: String(error) });
    return { source: "fallback", success: false, error: String(error) };
  }
});

/** 긴급사용 Step1: 사유만 전송 → 서버가 1회만 OTP 발급. 응답의 인증번호를 반환해 렌더러에서 비교용으로만 사용(API 1회 호출로 OTP 1개만 발송) */
ipcMain.handle("pcoff:requestEmergencyUseStep1", async (_event, payload: { reason?: string }): Promise<{ success: boolean; serverPass?: string; error?: string }> => {
  const api = await getApiClient();
  if (!api) {
    return { success: false, error: "서버에 연결할 수 없습니다. 로그인 후 다시 시도해 주세요." };
  }
  try {
    const raw = await api.callPcOffEmergencyUse({
      emergencyUsePass: "",
      reason: payload.reason || "긴급사용 요청"
    });
    const arr = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && (Array.isArray((raw as Record<string, unknown>).data) || Array.isArray((raw as Record<string, unknown>).result)))
      ? ((raw as Record<string, unknown>).data ?? (raw as Record<string, unknown>).result) as Record<string, unknown>[]
      : null;
    const item = arr && arr.length > 0 ? (arr[0] as Record<string, unknown>) : (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null);
    if (!item || typeof item !== "object") {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", raw });
      return { success: false, error: "서버 응답이 올바르지 않습니다." };
    }
    const code = item.code;
    const codeNum = typeof code === "number" ? code : typeof code === "string" ? parseInt(String(code), 10) : NaN;
    const msg = typeof item.msg === "string" ? item.msg : undefined;
    if (codeNum !== 1) {
      const errorMessage =
        msg ||
        (codeNum === -5 ? "인증번호가 올바르지 않습니다." : codeNum === -1 ? "조회에 실패했습니다." : codeNum === -2 ? "인증 정보가 올바르지 않습니다." : "긴급사용 요청에 실패했습니다.");
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", code, codeNum, msg });
      return { success: false, error: errorMessage };
    }
    const serverPassRaw = item.emergencyUsePass ?? item.EmergencyUsePass ?? (item as Record<string, unknown>).emergency_use_pass;
    const serverPass = String(serverPassRaw != null ? serverPassRaw : "").trim();
    if (serverPass === "") {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", reason: "서버 응답에 인증번호 없음" });
      return { success: false, error: "서버에서 인증번호를 받지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    return { success: true, serverPass };
  } catch (error) {
    await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", error: String(error) });
    return { success: false, error: String(error) };
  }
});

/** 긴급사용 Step2: 인증번호 일치 시 화면 전환만 수행(API 호출 없음) */
ipcMain.handle("pcoff:completeEmergencyUse", async () => {
  await logger.write(LOG_CODES.UNLOCK_TRIGGERED, "INFO", { action: "emergency_use" });
  setOperationMode("EMERGENCY_USE");
  await refreshWorkTimeFromApi();
  showTrayInfoInCurrentWindow();
});

/** 긴급사용 Step2: 인증번호는 렌더러에서 이미 검증됨. API 재호출 없이 잠금 해제만 수행(재호출 시 서버가 OTP를 또 보내는 문제 방지) */
ipcMain.handle("pcoff:completeEmergencyUseWithReason", async (_event, payload: { reason: string; emergencyUsePass: string }) => {
  await logger.write(LOG_CODES.UNLOCK_TRIGGERED, "INFO", {
    action: "emergency_use",
    reason: (payload.reason ?? "").trim() || undefined
  });
  setOperationMode("EMERGENCY_USE");
  await refreshWorkTimeFromApi();
  showTrayInfoInCurrentWindow();
  return { success: true };
});

ipcMain.handle("pcoff:requestEmergencyUse", async (_event, payload: { reason?: string; emergencyUsePass?: string }): Promise<ActionResult> => {
  const api = await getApiClient();
  if (!api) {
    return { source: "mock", success: false, error: "서버에 연결할 수 없습니다. 로그인 후 다시 시도해 주세요." };
  }
  try {
    const raw = await api.callPcOffEmergencyUse({
      emergencyUsePass: "",
      reason: payload.reason || "긴급사용 요청"
    });
    const arr = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && (Array.isArray((raw as Record<string, unknown>).data) || Array.isArray((raw as Record<string, unknown>).result)))
      ? ((raw as Record<string, unknown>).data ?? (raw as Record<string, unknown>).result) as Record<string, unknown>[]
      : null;
    const item = arr && arr.length > 0 ? (arr[0] as Record<string, unknown>) : (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null);
    if (!item || typeof item !== "object") {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", raw });
      return { source: "api", success: false, error: "서버 응답이 올바르지 않습니다." };
    }
    const code = item.code;
    const codeNum = typeof code === "number" ? code : typeof code === "string" ? parseInt(String(code), 10) : NaN;
    const msg = typeof item.msg === "string" ? item.msg : undefined;
    if (codeNum !== 1) {
      const errorMessage =
        msg ||
        (codeNum === -5 ? "인증번호가 올바르지 않습니다." : codeNum === -1 ? "조회에 실패했습니다." : codeNum === -2 ? "인증 정보가 올바르지 않습니다." : "긴급사용 요청에 실패했습니다.");
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", code, codeNum, msg });
      return { source: "api", success: false, error: errorMessage };
    }
    const serverPassRaw = item.emergencyUsePass ?? item.EmergencyUsePass ?? (item as Record<string, unknown>).emergency_use_pass;
    const serverPass = String(serverPassRaw != null ? serverPassRaw : "").trim();
    const userPass = (payload.emergencyUsePass ?? "").trim();
    if (serverPass === "" && userPass !== "") {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", reason: "서버 응답에 인증번호 없음" });
      return { source: "api", success: false, error: "서버에서 인증번호를 받지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    if (userPass !== serverPass) {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callPcOffEmergencyUse", reason: "인증번호 불일치(클라이언트 검증)" });
      return { source: "api", success: false, error: "입력하신 비밀번호가 맞지 않습니다. 다시 확인해 주세요." };
    }
    await logger.write(LOG_CODES.UNLOCK_TRIGGERED, "INFO", { action: "emergency_use" });
    setOperationMode("EMERGENCY_USE");
    await refreshWorkTimeFromApi();
    showTrayInfoInCurrentWindow();
    return { source: "api", success: true, data: raw };
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
    const eventName =
      payload.tmckButnCd === "IN" && payload.isLeaveSeat
        ? (payload.eventName ?? "Lock Off - 이석해제")
        : (payload.eventName ?? (payload.tmckButnCd === "IN" ? "Lock Off" : "Lock On"));
    const emergencyYn =
      payload.tmckButnCd === "IN" &&
      payload.isLeaveSeat &&
      localLeaveSeatDetectedAt
        ? buildLeaveSeatEmergencyYn(localLeaveSeatDetectedAt)
        : "N";
    try {
      const data = await api.callCmmPcOnOffLogPrc({
        tmckButnCd: payload.tmckButnCd,
        eventName,
        reason: payload.reason,
        emergencyYn
      });
      // PC-ON 시: 서버에 IN 기록 후 근태 갱신. 잠금 해제되면 에이전트 화면으로 전환, 여전히 잠금이면 stillLocked 반환(잠금화면에서 불가 메시지 표시)
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
          await leaveSeatReporter.reportEnd(payload.reason);
          localLeaveSeatDetectedAt = null;
          localLeaveSeatReason = null;
        }
        const fresh = await api.getPcOffWorkTime();
        const freshRecord = fresh as unknown as Record<string, unknown>;
        preserveLocalPcExCountIfHigher(freshRecord);
        lastWorkTimeData = freshRecord;
        applyResolvedScreenType(lastWorkTimeData);
        lastWorkTimeFetchedAt = new Date().toISOString();
        const pcOnT = parseYmdHm(fresh.pcOnYmdTime);
        const pcOffT = parseYmdHm(fresh.pcOffYmdTime);
        const now = new Date();
        const locked =
          pcOnT && pcOffT ? now < pcOnT || now >= pcOffT : (fresh.pcOnYn === "N");
        if (!locked) {
          showTrayInfoInCurrentWindow();
          return { source: "api", success: true, data };
        }
        return { source: "api", success: true, data, stillLocked: true };
      }
      return { source: "api", success: true, data };
    } catch (error) {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { step: "callCmmPcOnOffLogPrc", error: String(error) });
      return { source: "fallback", success: false, error: String(error) };
    }
  }
);

/** FR-14: 이석 해제 비밀번호 검증 후 PC-ON (leaveSeatUnlockRequirePassword=true 시) */
ipcMain.handle(
  "pcoff:requestPcOnWithLeaveSeatUnlock",
  async (
    _event,
    payload: { password: string; reason?: string }
  ): Promise<ActionResult> => {
    const api = await getApiClient();
    if (!api) return { source: "mock", success: false, error: "로그인 필요" };
    const config = await readJson<{
      mockVerifyLeaveSeatUnlock?: boolean;
      /** 화면잠금 해제용 비밀번호(로컬). 서버에 저장된 비밀번호로 검증할 땐 leaveSeatUnlockVerifyUrl 또는 .do 사용. */
      leaveSeatUnlockPassword?: string;
      /** 서버 검증 URL. 서버에 화면잠금 해제용 비밀번호가 저장되어 있으면 이 URL로 전송 후 서버가 저장값과 비교. */
      leaveSeatUnlockVerifyUrl?: string;
    }>(join(baseDir, PATHS.config), {});
    const useMockVerify = config.mockVerifyLeaveSeatUnlock === true;
    const configuredPassword = config.leaveSeatUnlockPassword?.trim();
    const phpVerifyUrl = config.leaveSeatUnlockVerifyUrl?.trim();

    if (useMockVerify) {
      await logger.write(LOG_CODES.LEAVE_SEAT_UNLOCK, "INFO", {
        mockVerify: true,
        message: "config.mockVerifyLeaveSeatUnlock: 검증 API 생략, PC-ON 진행"
      });
    } else if (configuredPassword) {
      // 로컬 config에만 비밀번호가 있을 때(서버 미사용): 설정값과 로컬 비교. 일반적으로는 서버 저장·검증 사용.
      if (payload.password !== configuredPassword) {
        return { source: "api", success: false, error: "비밀번호가 맞지 않습니다." };
      }
    } else if (phpVerifyUrl) {
      // 서버에 저장된 비밀번호로 검증: PHP가 입력값과 서버 저장값 비교 후 code 반환. UserID는 로그인 아이디(loginUserId).
      const userDisplay = await getLoginUserDisplay(baseDir);
      const userIdForPhp = userDisplay?.loginUserId ?? cachedUserStaffId;
      const verify = await verifyLeaveSeatUnlockViaUrl(
        phpVerifyUrl,
        cachedUserServareaId,
        userIdForPhp,
        payload.password ?? ""
      );
      if (!verify.success) {
        return { source: "api", success: false, error: verify.message ?? "비밀번호가 맞지 않습니다." };
      }
    } else {
      try {
        const verify = await api.verifyLeaveSeatUnlock(payload.password ?? "", payload.reason ?? "");
        if (!verify.success) {
          return { source: "api", success: false, error: verify.message ?? "비밀번호가 올바르지 않습니다." };
        }
      } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes("404") || errMsg.includes("verifyLeaveSeatUnlock")) {
          return { source: "api", success: false, error: "이석 해제 검증 API를 사용할 수 없습니다." };
        }
        throw err;
      }
    }
    try {
      const eventName = "Lock Off - 이석해제";
      const emergencyYn =
        localLeaveSeatDetectedAt ? buildLeaveSeatEmergencyYn(localLeaveSeatDetectedAt) : "N";
      const data = await api.callCmmPcOnOffLogPrc({
        tmckButnCd: "IN",
        eventName,
        reason: payload.reason ?? "",
        emergencyYn
      });
      await logger.write(LOG_CODES.LEAVE_SEAT_UNLOCK, "INFO", {
        hasReason: Boolean(payload.reason?.trim()),
        reason: payload.reason ?? "",
        passwordVerified: true
      });
      if (payload.reason?.trim()) {
        await logger.write(LOG_CODES.LEAVE_SEAT_REASON_SUBMITTED, "INFO", { reason: payload.reason });
      }
      if (localLeaveSeatDetectedAt) {
        await logger.write(LOG_CODES.LEAVE_SEAT_RELEASED, "INFO", { reason: localLeaveSeatReason ?? "unknown" });
        await leaveSeatReporter.reportEnd(payload.reason);
        localLeaveSeatDetectedAt = null;
        localLeaveSeatReason = null;
      }
      const fresh = await api.getPcOffWorkTime();
      const freshRecord = fresh as unknown as Record<string, unknown>;
      preserveLocalPcExCountIfHigher(freshRecord);
      lastWorkTimeData = freshRecord;
      applyResolvedScreenType(lastWorkTimeData);
      lastWorkTimeFetchedAt = new Date().toISOString();
      const pcOnT = parseYmdHm(fresh.pcOnYmdTime);
      const pcOffT = parseYmdHm(fresh.pcOffYmdTime);
      const now = new Date();
      const locked =
        pcOnT && pcOffT ? now < pcOnT || now >= pcOffT : (fresh.pcOnYn === "N");
      if (!locked) {
        showTrayInfoInCurrentWindow();
        return { source: "api", success: true, data };
      }
      // 긴급사용 등 상태에서 이석 해제 후 서버가 아직 잠금을 유지해도, 잠금창을 닫고 작동정보로 전환해 사용자가 해제된 것처럼 보이도록 함
      showTrayInfoInCurrentWindow();
      return { source: "api", success: true, data, stillLocked: true };
    } catch (error) {
      await logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", {
        step: "requestPcOnWithLeaveSeatUnlock:callCmmPcOnOffLogPrc",
        error: String(error)
      });
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
    const mockData = buildMockWorkTime() as Record<string, unknown>;
    lastWorkTimeData = mockData;
    applyResolvedScreenType(lastWorkTimeData);
    lastWorkTimeFetchedAt = new Date().toISOString();
    return mockData;
  }

  try {
    const data = await api.getPcOffWorkTime();
    // 임시연장 중 연장 만료 시각이 아직 미래면 서버 응답으로 덮어쓰지 않음 (조회 시 다시 잠금·카운트 초기화 방지)
    if (
      currentMode === "TEMP_EXTEND" &&
      Object.keys(lastWorkTimeData).length > 0
    ) {
      const extendedEnd = parseYmdHm(String(lastWorkTimeData.pcOffYmdTime ?? ""));
      if (extendedEnd && extendedEnd > new Date()) {
        lastWorkTimeFetchedAt = new Date().toISOString();
        const merged = { ...data } as Record<string, unknown>;
        merged.pcOffYmdTime = lastWorkTimeData.pcOffYmdTime;
        merged.pcExCount = lastWorkTimeData.pcExCount;
        merged.screenType = resolveScreenType(merged, new Date(), !!localLeaveSeatDetectedAt);
        // 서버 이석(screenType) 반영해 주기 잠금 검사에서 이석 감지되도록 lastWorkTimeData 갱신
        lastWorkTimeData = { ...merged };
        await logger.write(LOG_CODES.TRAY_ATTENDANCE_REFRESHED, "INFO", {});
        return merged;
      }
      // 연장 만료 시각이 지났거나 파싱 실패해도, 이미 사용한 연장 횟수(pcExCount)는 로컬 값을 유지해 UI에서 0으로 덮어쓰지 않음
      const localCount = Number(lastWorkTimeData.pcExCount ?? 0);
      if (localCount >= 1) {
        const merged = { ...data } as Record<string, unknown>;
        merged.pcExCount = lastWorkTimeData.pcExCount;
        merged.pcOffYmdTime = lastWorkTimeData.pcOffYmdTime ?? merged.pcOffYmdTime;
        merged.screenType = resolveScreenType(merged, new Date(), !!localLeaveSeatDetectedAt);
        lastWorkTimeData = { ...merged };
        lastWorkTimeFetchedAt = new Date().toISOString();
        await logger.write(LOG_CODES.TRAY_ATTENDANCE_REFRESHED, "INFO", {});
        return merged;
      }
    }
    const dataRecord = data as unknown as Record<string, unknown>;
    preserveLocalPcExCountIfHigher(dataRecord);
    lastWorkTimeData = dataRecord;
    applyResolvedScreenType(lastWorkTimeData);
    lastWorkTimeFetchedAt = new Date().toISOString();
    await logger.write(LOG_CODES.TRAY_ATTENDANCE_REFRESHED, "INFO", {});
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

// 로그인 성공 후: pcOnYmdTime/pcOffYmdTime 기준 잠금 필요 시 잠금화면 표시 (호출한 창을 재사용해 새 창 안 띄움)
ipcMain.handle("pcoff:checkLockAndShow", async (event) => {
  // FR-12: 로그인 직후 reporter 컨텍스트 갱신 및 시작
  const cfg = await loadRuntimeConfig(baseDir);
  if (cfg) {
    cachedApiBaseUrl = cfg.apiBaseUrl;
    cachedUserServareaId = cfg.userServareaId;
    cachedUserStaffId = cfg.userStaffId;
  }
  leaveSeatReporter.start();

  const reuseWin = BrowserWindow.fromWebContents(event.sender);
  const lockOpened = await checkLockAndShowLockWindow(reuseWin ?? undefined);
  startLockCheckInterval();
  return { lockOpened };
});

// 수동으로 잠금화면 창 열기 (트레이 메뉴 등)
ipcMain.handle("pcoff:openLockWindow", async () => {
  await createLockWindow();
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

// FR-17: 오프라인 상태 조회·재시도 IPC
ipcMain.handle("pcoff:getConnectivityState", async () => {
  return offlineManager.getSnapshot();
});

ipcMain.handle("pcoff:retryConnectivity", async () => {
  const recovered = await offlineManager.retryConnectivity(async () => {
    const baseUrl = await getApiBaseUrl(baseDir);
    if (!baseUrl) return false;
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/reportAgentEvents.do`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [], deviceId: "probe", sessionId: "probe" }),
      signal: AbortSignal.timeout(10_000)
    });
    return res.ok;
  });
  return { recovered, snapshot: offlineManager.getSnapshot() };
});

/** 원본 WebView와 동일: 긴급해제 비밀번호 검증용 PHP URL. sendLockPassUrl 설정이 있으면 사용, 없으면 lockScreenApiUrl에서 도메인만 추출해 /Includes/sendLockPass.php 로 반환 */
async function getSendLockPassUrl(baseDir: string): Promise<string | null> {
  const config = await readJson<{
    sendLockPassUrl?: string;
    lockScreenApiUrl?: string;
  }>(join(baseDir, PATHS.config), {});
  if (config.sendLockPassUrl?.trim()) return config.sendLockPassUrl.trim();
  if (config.lockScreenApiUrl?.trim()) {
    try {
      const origin = new URL(config.lockScreenApiUrl.trim()).origin;
      return `${origin}/Includes/sendLockPass.php`;
    } catch {
      return null;
    }
  }
  return null;
}

// FR-15: 긴급해제 IPC
ipcMain.handle("pcoff:requestEmergencyUnlock", async (event, payload: { password: string; reason?: string }) => {
  const sendLockPassUrl = await getSendLockPassUrl(baseDir);
  const servareaId = (cachedUserServareaId || (await loadRuntimeConfig(baseDir))?.userServareaId) ?? "";

  let result: { success: boolean; message: string; remainingAttempts: number; lockedUntil?: string };

  if (sendLockPassUrl && servareaId) {
    result = await emergencyUnlockManager.attemptViaPhp(sendLockPassUrl, servareaId, payload.password);
  } else {
    const api = await getApiClient();
    if (!api) {
      result = {
        success: false,
        message: "API 클라이언트를 사용할 수 없습니다.",
        remainingAttempts: 0
      };
    } else {
      result = await emergencyUnlockManager.attempt(api, payload.password, payload.reason);
    }
  }

  if (result.success) {
    let onDisplay: Electron.Display | undefined;
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin && !senderWin.isDestroyed()) {
      try {
        onDisplay = screen.getDisplayMatching(senderWin.getBounds());
      } catch {
        // 디스플레이 조회 실패 시 무시
      }
    }
    setOperationMode("EMERGENCY_RELEASE");
    await refreshWorkTimeFromApi();
    showTrayInfoInCurrentWindow(onDisplay);
  }
  return result;
});

ipcMain.handle("pcoff:getEmergencyUnlockState", async () => {
  return emergencyUnlockManager.getState();
});

ipcMain.handle("pcoff:getEmergencyUnlockEligibility", async () => {
  const unlockUseYn = String(lastWorkTimeData.emergencyUnlockUseYn ?? "NO").toUpperCase();
  const pwdSetYn = String(lastWorkTimeData.emergencyUnlockPasswordSetYn ?? "N").toUpperCase();
  const isLocked = currentScreen === "lock";
  const eligible = unlockUseYn === "YES" && (pwdSetYn === "Y" || pwdSetYn === "YES") && isLocked;
  return {
    eligible,
    emergencyUnlockUseYn: unlockUseYn,
    emergencyUnlockPasswordSetYn: pwdSetYn,
    isLocked,
    isLockedOut: emergencyUnlockManager.isLockedOut,
    remainingLockoutMs: emergencyUnlockManager.remainingLockoutMs,
    isActive: emergencyUnlockManager.isActive
  };
});
