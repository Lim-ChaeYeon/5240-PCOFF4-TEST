import { LOG_CODES } from "./constants.js";
import { TelemetryLogger } from "./telemetry-log.js";
import { reportAgentEvents } from "./api-client.js";
import type { LogEntry } from "./types.js";

const MAX_QUEUE_SIZE = 500;
const FLUSH_INTERVAL_MS = 60_000; // 1분
const BATCH_SIZE = 50;
const MAX_BACKOFF_MS = 300_000; // 5분
const INITIAL_BACKOFF_MS = 5_000;

/**
 * Ops Observer - FR-08
 *
 * 비정상 종료·통신 두절·중지 상태를 중앙 서버에 보고.
 * - heartbeat 주기적 로컬 기록 + 서버 전송 큐 적재
 * - 크래시/오프라인 감지 시 CRASH_DETECTED, OFFLINE_DETECTED 로그 기록 및 즉시 전송 시도
 * - 로그 배치 전송, 실패 시 지수 백오프 재시도
 */
export class OpsObserver {
  private heartbeatTimer?: NodeJS.Timeout;
  private flushTimer?: NodeJS.Timeout;
  private queue: LogEntry[] = [];
  private backoffMs = INITIAL_BACKOFF_MS;
  private flushScheduled: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly logger: TelemetryLogger,
    private readonly getApiBaseUrl: () => Promise<string | null>
  ) {}

  /**
   * Logger에 transport 등록 후 heartbeat·주기 flush 시작
   */
  start(heartbeatIntervalMs = 60_000): void {
    this.logger.addTransport((entry) => this.enqueue(entry));
    this.startHeartbeat(heartbeatIntervalMs);
    this.scheduleFlush();
  }

  /**
   * Heartbeat 시작 (로컬 로그 기록 → transport로 큐 적재 → 주기 flush로 서버 전송)
   */
  startHeartbeat(intervalMs = 60_000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.logger.write(LOG_CODES.HEARTBEAT, "INFO", { intervalMs });
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  /**
   * Observer 중지: transport 해제, 타이머 정리
   */
  stop(): void {
    this.stopHeartbeat();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.flushScheduled) {
      clearTimeout(this.flushScheduled);
      this.flushScheduled = null;
    }
    this.logger.removeTransport();
  }

  /** 로그 항목을 서버 전송 큐에 적재 */
  private enqueue(entry: LogEntry): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
    }
    this.queue.push(entry);
  }

  /** 주기적 flush 스케줄 (실패 시 백오프 후 재시도) */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flushToServer();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * 큐에 쌓인 로그를 서버로 전송
   * 성공 시 큐 비우고 백오프 초기화, 실패 시 백오프 후 재스케줄
   */
  async flushToServer(): Promise<void> {
    if (this.queue.length === 0) return;

    const baseUrl = await this.getApiBaseUrl();
    if (!baseUrl) return;

    const batch = this.queue.splice(0, BATCH_SIZE);
    const first = batch[0];
    const reportPayload = {
      deviceId: first.deviceId,
      sessionId: first.sessionId,
      events: batch.map((e) => ({
        timestamp: e.timestamp,
        logCode: e.logCode,
        level: e.level,
        sessionId: e.sessionId,
        deviceId: e.deviceId,
        payload: e.payload
      }))
    };

    try {
      await reportAgentEvents(baseUrl, reportPayload);
      this.backoffMs = INITIAL_BACKOFF_MS;
      if (this.queue.length > 0) {
        this.scheduleNextFlush(0);
      }
    } catch (err) {
      // 실패 시 배치를 큐 앞에 다시 넣음
      this.queue.unshift(...batch);
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.scheduleNextFlush(delay);
    }
  }

  private scheduleNextFlush(delayMs: number): void {
    if (this.flushScheduled) return;
    this.flushScheduled = setTimeout(() => {
      this.flushScheduled = null;
      void this.flushToServer();
    }, delayMs);
  }

  /**
   * 오프라인/통신 두절 보고 (로컬 로그 + 큐 적재 후 전송 시도)
   */
  async reportOffline(reason: string): Promise<void> {
    await this.logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { reason });
    await this.flushToServer();
  }

  /**
   * 크래시/비정상 종료 보고 (로컬 로그 + 즉시 전송 시도)
   */
  async reportCrash(error?: Error | string): Promise<void> {
    await this.logger.write(LOG_CODES.CRASH_DETECTED, "ERROR", {
      message: error instanceof Error ? error.message : String(error ?? "unknown")
    });
    await this.flushToServer();
  }

  /**
   * 설치자 레지스트리 동기화 (로컬 로그 + 큐 적재)
   */
  async syncInstallerRegistry(installerId: string): Promise<void> {
    await this.logger.write(LOG_CODES.INSTALLER_REGISTRY_SYNC, "INFO", { installerId });
  }
}
