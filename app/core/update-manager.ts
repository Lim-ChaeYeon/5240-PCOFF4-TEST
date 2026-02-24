import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LOG_CODES, PATHS } from "./constants.js";
import { readJson, writeJson } from "./storage.js";
import { TelemetryLogger } from "./telemetry-log.js";

interface UpdateQueueItem {
  version: string;
  reason: string;
  queuedAt: string;
  retryCount: number;
}

export interface UpdateStatus {
  state:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "error"
    | "not-available";
  version?: string;
  progress?: number;
  error?: string;
}

const MAX_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 60_000; // 1분 후 재시도

/** 404 / 플랫폼용 메타파일 없음 — 재시도하지 않고 '업데이트 없음'으로 처리 */
function isUpdateNotFoundError(message: string): boolean {
  const m = String(message);
  return (
    m.includes("404") ||
    m.includes("Cannot find latest-mac.yml") ||
    m.includes("Cannot find latest.yml") ||
    /latest-[a-z0-9-]+\.yml/.test(m)
  );
}

// 개발 모드에서 프로젝트 루트 package.json 경로 (dist/app/core → 프로젝트 루트)
const getProjectRootPackagePath = (): string => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, "..", "..", "..", "package.json");
};

// Electron 런타임 여부 확인
function isElectronRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    process.versions != null &&
    process.versions.electron != null
  );
}

export class UpdateManager {
  private status: UpdateStatus = { state: "idle" };
  private autoUpdater: import("electron-updater").AppUpdater | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly appVersion: string;
  /** Electron 환경에서 initAutoUpdater 완료 대기용 — 버튼 클릭 시 autoUpdater가 준비될 때까지 기다림 */
  private readonly initPromise: Promise<void>;

  constructor(
    private readonly baseDir: string,
    private readonly logger: TelemetryLogger,
    appVersion?: string
  ) {
    this.appVersion = appVersion ?? this.resolveVersion();
    this.initPromise = isElectronRuntime() ? this.initAutoUpdater() : Promise.resolve();
  }

  private async initAutoUpdater(): Promise<void> {
    try {
      const updaterModule = await import("electron-updater") as { autoUpdater?: import("electron-updater").AppUpdater; default?: { autoUpdater?: import("electron-updater").AppUpdater } };
      const autoUpdater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater;

      if (!autoUpdater) {
        console.warn("[UpdateManager] autoUpdater not found in electron-updater module");
        return;
      }

      this.autoUpdater = autoUpdater;
      console.info("[UpdateManager] current version:", this.appVersion);

      // GitHub Release 다운로드 시 CDN/리다이렉트에서 차단되지 않도록 User-Agent 설정 (퍼블릭 저장소 404 완화)
      const ua = `5240-PcOff-Agent/${this.appVersion} (${process.platform}; Electron)`;
      (autoUpdater as { requestHeaders?: Record<string, string> }).requestHeaders = {
        "User-Agent": ua,
        Accept: "application/octet-stream",
      };

      // 0.2.5-2 → 0.2.5-3 같은 프리릴리스 간 업데이트 인식 (GitHub에서 Pre-release 체크 해제한 릴리스 포함)
      (autoUpdater as { allowPrerelease?: boolean }).allowPrerelease = true;

      // 자동 다운로드 활성화 (무확인 자동 적용)
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      // 이벤트 리스너 설정
      autoUpdater.on("checking-for-update", () => {
        try {
          this.status = { state: "checking" };
          console.info("[UpdateManager] checking for update...");
          this.sendStatusToRenderer();
        } catch (e) {
          console.warn("[UpdateManager] checking-for-update handler:", e);
        }
      });

      autoUpdater.on("update-available", (info) => {
        try {
          this.status = { state: "available", version: info.version };
          console.info("[UpdateManager] update available:", info.version);
          this.logger.write(LOG_CODES.UPDATE_FOUND, "INFO", { version: info.version }).catch(() => {});
          this.sendStatusToRenderer();
        } catch (e) {
          console.warn("[UpdateManager] update-available handler:", e);
          this.sendStatusToRenderer();
        }
      });

      autoUpdater.on("update-not-available", (info) => {
        try {
          this.status = { state: "not-available" };
          const infoObj = info as unknown as { version?: string; [k: string]: unknown };
          const remoteVersion = String(infoObj?.version ?? "—");
          console.info("[UpdateManager] update not available — installed:", this.appVersion, ", release:", remoteVersion, "| raw:", JSON.stringify({ version: infoObj?.version }));
          this.sendStatusToRenderer();
        } catch (e) {
          console.warn("[UpdateManager] update-not-available handler:", e);
        }
      });

      autoUpdater.on("download-progress", (progress: { percent?: number }) => {
        try {
          const percent = progress != null && typeof progress.percent === "number" ? progress.percent : 0;
          this.status = { state: "downloading", progress: Math.round(percent) };
          this.sendStatusToRenderer();
        } catch (e) {
          console.warn("[UpdateManager] download-progress handler:", e);
          this.status = { state: "error", error: String(e) };
          this.sendStatusToRenderer();
        }
      });

      autoUpdater.on("update-downloaded", (info: { version?: string }) => {
        try {
          const version = info?.version ?? "?";
          this.status = { state: "downloaded", version };
          this.logger.write(LOG_CODES.UPDATE_DOWNLOADED, "INFO", { version }).catch(() => {});
          this.sendStatusToRenderer();
          // UPDATE_APPLIED는 사용자가 '지금 재시작' 후 실제 설치 시 로깅
        } catch (e) {
          console.warn("[UpdateManager] update-downloaded handler:", e);
          this.status = { state: "error", error: String(e) };
          this.sendStatusToRenderer();
        }
      });

      autoUpdater.on("error", async (error) => {
        try {
          const errorMessage = error?.message || String(error);
          if (isUpdateNotFoundError(errorMessage)) {
            this.status = { state: "not-available", error: "이 플랫폼용 업데이트 정보가 없습니다." };
            console.info("[UpdateManager] update not found (404/platform):", errorMessage);
            this.sendStatusToRenderer();
            return;
          }
          this.status = { state: "error", error: errorMessage };
          console.warn("[UpdateManager] error:", errorMessage, error);
          this.logger.write(LOG_CODES.UPDATE_FAILED, "WARN", { error: errorMessage }).catch(() => {});
          this.sendStatusToRenderer();
          try {
            await this.enqueueRetry("latest", errorMessage);
          } catch (e) {
            console.warn("[UpdateManager] enqueueRetry failed:", e);
          }
        } catch (e) {
          console.warn("[UpdateManager] error handler failed:", e);
          this.status = { state: "not-available" };
          this.sendStatusToRenderer();
        }
      });
    } catch (error) {
      // electron-updater 로드 실패 (시뮬레이터 등 비-Electron 환경)
      console.warn("[UpdateManager] electron-updater not available:", error);
    }
  }

  private sendStatusToRenderer(): void {
    if (!isElectronRuntime()) return;
    try {
      const payload = { ...this.status };
      import("electron")
        .then(({ BrowserWindow }) => {
          try {
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
              if (!win.isDestroyed()) {
                win.webContents.send("pcoff:update-progress", payload);
              }
            }
          } catch (e) {
            console.warn("[UpdateManager] sendStatusToRenderer:", e);
          }
        })
        .catch((e) => {
          console.warn("[UpdateManager] sendStatusToRenderer load:", e);
        });
    } catch (e) {
      console.warn("[UpdateManager] sendStatusToRenderer sync:", e);
    }
  }

  /**
   * 업데이트 확인 및 자동 적용
   *
   * Electron 환경: init 완료 대기 후 electron-updater로 실제 업데이트 수행
   * 비-Electron 환경: 모의 동작 (시뮬레이터용)
   */
  async checkAndApplySilently(nextVersion = "0.1.1"): Promise<UpdateStatus> {
    if (isElectronRuntime()) {
      await this.initPromise;
    }
    if (this.autoUpdater) {
      // 실제 electron-updater 사용
      this.status = { state: "checking" };
      this.sendStatusToRenderer();
      try {
        await this.autoUpdater.checkForUpdates();
        // 이벤트(update-not-available 등)가 먼저 처리되도록 짧게 대기 후 상태 반환
        await new Promise((r) => setTimeout(r, 150));
        // 패키징되지 않은(개발) 환경에서는 electron-updater가 스킵해 이벤트를 안 보냄 → 확인 중에서 복귀
        if (this.status.state === "checking") {
          this.status = { state: "not-available" };
          this.sendStatusToRenderer();
        }
        return this.status;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (isUpdateNotFoundError(errorMessage)) {
          this.status = { state: "not-available", error: "이 플랫폼용 업데이트 정보가 없습니다." };
          this.sendStatusToRenderer();
          return this.status;
        }
        this.status = { state: "error", error: errorMessage };
        this.sendStatusToRenderer();
        try {
          await this.enqueueRetry("latest", errorMessage);
        } catch (e) {
          console.warn("[UpdateManager] enqueueRetry failed:", e);
        }
        return this.status;
      }
    }

    // 비-Electron 환경 (시뮬레이터): 모의 동작
    return this.mockCheckAndApply(nextVersion);
  }

  /**
   * 시뮬레이터용 모의 업데이트 체크
   */
  private async mockCheckAndApply(nextVersion: string): Promise<UpdateStatus> {
    this.status = { state: "checking" };
    await this.logger.write(LOG_CODES.UPDATE_FOUND, "INFO", { nextVersion });

    // 모의 다운로드
    const downloadOk = await this.mockDownloadPackage(nextVersion);
    if (!downloadOk) {
      await this.enqueueRetry(nextVersion, "network_error");
      this.status = { state: "error", error: "network_error" };
      return this.status;
    }

    // 모의 무결성 검증
    const integrityOk = await this.mockVerifyIntegrity(nextVersion);
    if (!integrityOk) {
      await this.enqueueRetry(nextVersion, "integrity_failed");
      this.status = { state: "error", error: "integrity_failed" };
      return this.status;
    }

    await this.logger.write(LOG_CODES.UPDATE_APPLIED, "INFO", {
      version: nextVersion,
      silent: true,
    });
    this.status = { state: "downloaded", version: nextVersion };
    return this.status;
  }

  private async mockDownloadPackage(version: string): Promise<boolean> {
    await this.logger.write(LOG_CODES.UPDATE_DOWNLOADED, "INFO", {
      version,
      mode: "background",
    });
    return true; // 모의 성공
  }

  private async mockVerifyIntegrity(version: string): Promise<boolean> {
    return version.length > 0; // 모의 검증
  }

  /**
   * 재시도 큐에 추가
   * 네트워크 오류나 무결성 검증 실패 시 1분 후 재시도
   */
  private async enqueueRetry(version: string, reason: string): Promise<void> {
    const queuePath = join(this.baseDir, PATHS.retryQueue);
    const queue = await readJson<UpdateQueueItem[]>(queuePath, []);

    const existing = queue.find((item) => item.version === version);
    if (existing) {
      existing.retryCount += 1;
      existing.reason = reason;
      existing.queuedAt = new Date().toISOString();
    } else {
      queue.push({
        version,
        reason,
        queuedAt: new Date().toISOString(),
        retryCount: 1,
      });
    }

    // 최대 재시도 횟수 초과 시 제거
    const filtered = queue.filter((item) => item.retryCount <= MAX_RETRY_COUNT);
    await writeJson(queuePath, filtered);
    await this.logger.write(LOG_CODES.UPDATE_FAILED, "WARN", {
      version,
      reason,
      queuedForRetry: true,
    });

    // 1분 후 자동 재시도 스케줄
    this.scheduleRetry();
  }

  /**
   * 재시도 스케줄
   */
  private scheduleRetry(): void {
    if (this.retryTimeout) return; // 이미 스케줄됨

    this.retryTimeout = setTimeout(async () => {
      this.retryTimeout = null;
      const queuePath = join(this.baseDir, PATHS.retryQueue);
      const queue = await readJson<UpdateQueueItem[]>(queuePath, []);

      if (queue.length > 0) {
        console.log("[UpdateManager] Retrying update check...");
        await this.checkAndApplySilently();
      }
    }, RETRY_DELAY_MS);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  getAppVersion(): string {
    return this.appVersion;
  }

  /** 다운로드된 업데이트가 있으면 true (종료 시 설치 대기 중) */
  hasDownloadedUpdate(): boolean {
    return this.status.state === "downloaded" && this.autoUpdater != null;
  }

  /**
   * 다운로드된 업데이트가 있을 때만 quitAndInstall() 호출.
   * 앱 종료 시 자동 적용이 안 되는 환경(macOS 등)에서 before-quit에서 명시 호출용.
   * @returns 설치를 실행했으면 true (앱이 곧 종료됨)
   */
  quitAndInstallIfDownloaded(): boolean {
    if (this.status.state !== "downloaded" || !this.autoUpdater) return false;
    try {
      this.autoUpdater.quitAndInstall(false, true);
      return true;
    } catch (e) {
      console.warn("[UpdateManager] quitAndInstall failed:", e);
      return false;
    }
  }

  private resolveVersion(): string {
    for (const pkgPath of [join(this.baseDir, "package.json"), getProjectRootPackagePath()]) {
      try {
        const raw = readFileSync(pkgPath, "utf-8");
        const pkg = JSON.parse(raw) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        continue;
      }
    }
    return "0.1.0";
  }
}
