import { join } from "node:path";
import { LOG_CODES, PATHS } from "./constants.js";
import { readJson, writeJson } from "./storage.js";
import type { TelemetryLogger } from "./telemetry-log.js";

export type ConnectivityState = "ONLINE" | "OFFLINE_GRACE" | "OFFLINE_LOCKED";

export interface OfflineStateSnapshot {
  state: ConnectivityState;
  offlineSince: string | null;
  deadline: string | null;
  locked: boolean;
  lastRetryAt: string | null;
  retryCount: number;
}

export type OfflineStateChangeCallback = (state: ConnectivityState) => void;

const HEARTBEAT_FAIL_THRESHOLD = 3;
const API_FAIL_THRESHOLD = 2;
const GRACE_PERIOD_MS = 30 * 60_000; // 30분

const EMPTY_SNAPSHOT: OfflineStateSnapshot = {
  state: "ONLINE",
  offlineSince: null,
  deadline: null,
  locked: false,
  lastRetryAt: null,
  retryCount: 0
};

export class OfflineManager {
  private snapshot: OfflineStateSnapshot = { ...EMPTY_SNAPSHOT };
  private heartbeatFailCount = 0;
  private apiFailCount = 0;
  private graceTimer?: ReturnType<typeof setTimeout>;
  private onStateChange?: OfflineStateChangeCallback;
  private readonly stateFilePath: string;

  constructor(
    private readonly baseDir: string,
    private readonly logger: TelemetryLogger
  ) {
    this.stateFilePath = join(baseDir, PATHS.offlineState);
  }

  setOnStateChange(cb: OfflineStateChangeCallback): void {
    this.onStateChange = cb;
  }

  get state(): ConnectivityState {
    return this.snapshot.state;
  }

  getSnapshot(): Readonly<OfflineStateSnapshot> {
    return this.snapshot;
  }

  /** 앱 시작 시 저장된 오프라인 상태를 복원 */
  async restore(): Promise<void> {
    const saved = await readJson<OfflineStateSnapshot>(this.stateFilePath, { ...EMPTY_SNAPSHOT });
    if (saved.state === "ONLINE") return;

    this.snapshot = saved;

    if (saved.state === "OFFLINE_LOCKED") {
      this.emit(saved.state);
      return;
    }

    if (saved.state === "OFFLINE_GRACE" && saved.deadline) {
      const remaining = new Date(saved.deadline).getTime() - Date.now();
      if (remaining <= 0) {
        await this.transitionTo("OFFLINE_LOCKED");
      } else {
        this.startGraceTimer(remaining);
        this.emit(saved.state);
      }
    }
  }

  /** API 실패를 보고 — 임계값 도달 시 OFFLINE_GRACE 전환 */
  async reportApiFailure(source: "heartbeat" | "api" = "api"): Promise<void> {
    if (this.snapshot.state !== "ONLINE") return;

    if (source === "heartbeat") {
      this.heartbeatFailCount++;
      if (this.heartbeatFailCount < HEARTBEAT_FAIL_THRESHOLD) return;
    } else {
      this.apiFailCount++;
      if (this.apiFailCount < API_FAIL_THRESHOLD) return;
    }

    await this.transitionTo("OFFLINE_GRACE");
  }

  /** API 성공 시 온라인으로 복귀 */
  async reportApiSuccess(): Promise<void> {
    this.heartbeatFailCount = 0;
    this.apiFailCount = 0;

    if (this.snapshot.state === "ONLINE") return;
    await this.transitionTo("ONLINE");
  }

  /** 수동 재시도 — heartbeat API로 온라인 여부 확인 후 상태 전환 */
  async retryConnectivity(healthCheckFn: () => Promise<boolean>): Promise<boolean> {
    this.snapshot.retryCount++;
    this.snapshot.lastRetryAt = new Date().toISOString();
    await this.persist();

    void this.logger.write(LOG_CODES.OFFLINE_RETRY, "INFO", {
      retryCount: this.snapshot.retryCount,
      currentState: this.snapshot.state
    });

    try {
      const online = await healthCheckFn();
      if (online) {
        await this.reportApiSuccess();
        return true;
      }
    } catch {
      // 실패 — 상태 유지
    }
    return false;
  }

  stop(): void {
    this.clearGraceTimer();
  }

  private async transitionTo(next: ConnectivityState): Promise<void> {
    const prev = this.snapshot.state;
    if (prev === next) return;

    switch (next) {
      case "OFFLINE_GRACE": {
        const now = new Date();
        this.snapshot.state = "OFFLINE_GRACE";
        this.snapshot.offlineSince = now.toISOString();
        this.snapshot.deadline = new Date(now.getTime() + GRACE_PERIOD_MS).toISOString();
        this.snapshot.locked = false;
        this.snapshot.retryCount = 0;
        this.snapshot.lastRetryAt = null;
        this.startGraceTimer(GRACE_PERIOD_MS);

        void this.logger.write(LOG_CODES.OFFLINE_GRACE_STARTED, "WARN", {
          offlineSince: this.snapshot.offlineSince,
          deadline: this.snapshot.deadline
        });
        break;
      }
      case "OFFLINE_LOCKED": {
        this.clearGraceTimer();
        this.snapshot.state = "OFFLINE_LOCKED";
        this.snapshot.locked = true;

        void this.logger.write(LOG_CODES.OFFLINE_TIMEOUT_LOCK, "ERROR", {
          offlineSince: this.snapshot.offlineSince,
          retryCount: this.snapshot.retryCount
        });
        break;
      }
      case "ONLINE": {
        this.clearGraceTimer();
        const duration = this.snapshot.offlineSince
          ? Date.now() - new Date(this.snapshot.offlineSince).getTime()
          : 0;

        void this.logger.write(LOG_CODES.OFFLINE_RECOVERED, "INFO", {
          previousState: prev,
          offlineDurationMs: duration
        });

        this.snapshot = { ...EMPTY_SNAPSHOT };
        break;
      }
    }

    await this.persist();
    this.emit(next);
  }

  private startGraceTimer(durationMs: number): void {
    this.clearGraceTimer();
    this.graceTimer = setTimeout(() => {
      void this.transitionTo("OFFLINE_LOCKED");
    }, durationMs);
  }

  private clearGraceTimer(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
    }
  }

  private async persist(): Promise<void> {
    try {
      await writeJson(this.stateFilePath, this.snapshot);
    } catch {
      // 저장 실패는 무시 — 다음 기회에 다시 시도
    }
  }

  private emit(state: ConnectivityState): void {
    try {
      this.onStateChange?.(state);
    } catch {
      // 콜백 오류 무시
    }
  }
}
