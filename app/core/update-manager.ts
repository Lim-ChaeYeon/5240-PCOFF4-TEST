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
      const updaterModule = await import("electron-updater");
      const autoUpdater = updaterModule.autoUpdater;
      
      if (!autoUpdater) {
        console.warn("[UpdateManager] autoUpdater not found in electron-updater module");
        return;
      }
      
      this.autoUpdater = autoUpdater;

      // 자동 다운로드 활성화 (무확인 자동 적용)
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      // 이벤트 리스너 설정
      autoUpdater.on("checking-for-update", () => {
        this.status = { state: "checking" };
        this.sendStatusToRenderer();
      });

      autoUpdater.on("update-available", (info) => {
        this.status = { state: "available", version: info.version };
        this.logger.write(LOG_CODES.UPDATE_FOUND, "INFO", {
          version: info.version,
        });
        this.sendStatusToRenderer();
      });

      autoUpdater.on("update-not-available", () => {
        this.status = { state: "not-available" };
        this.sendStatusToRenderer();
      });

      autoUpdater.on("download-progress", (progress) => {
        this.status = {
          state: "downloading",
          progress: Math.round(progress.percent),
        };
        this.sendStatusToRenderer();
      });

      autoUpdater.on("update-downloaded", (info) => {
        this.status = { state: "downloaded", version: info.version };
        this.logger.write(LOG_CODES.UPDATE_DOWNLOADED, "INFO", {
          version: info.version,
        });
        this.sendStatusToRenderer();

        // 무확인 자동 설치 - 다운로드 완료 후 즉시 적용
        // quitAndInstall은 앱을 재시작하므로, 실제 운영에서는 적절한 타이밍에 호출
        // 현재는 자동 적용 (앱 종료 시 설치됨)
        this.logger.write(LOG_CODES.UPDATE_APPLIED, "INFO", {
          version: info.version,
          autoInstall: true,
        });
      });

      autoUpdater.on("error", async (error) => {
        const errorMessage = error?.message || String(error);
        this.status = { state: "error", error: errorMessage };
        this.logger.write(LOG_CODES.UPDATE_FAILED, "WARN", {
          error: errorMessage,
        });
        this.sendStatusToRenderer();

        // 재시도 큐에 추가
        await this.enqueueRetry("latest", errorMessage);
      });
    } catch (error) {
      // electron-updater 로드 실패 (시뮬레이터 등 비-Electron 환경)
      console.warn("[UpdateManager] electron-updater not available:", error);
    }
  }

  private sendStatusToRenderer(): void {
    if (!isElectronRuntime()) return;

    import("electron")
      .then(({ BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send("pcoff:update-progress", this.status);
          }
        }
      })
      .catch(() => {
        // Electron 모듈 로드 실패 무시
      });
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
        return this.status;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.status = { state: "error", error: errorMessage };
        this.sendStatusToRenderer();
        await this.enqueueRetry("latest", errorMessage);
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
