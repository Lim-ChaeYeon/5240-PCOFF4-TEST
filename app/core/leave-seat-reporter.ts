/**
 * leave-seat-reporter.ts
 * FR-12: 이석정보 서버 전송 — START/END를 세션 기반으로 서버 전송, 장애 내성
 *
 * - 세션 ID(leaveSeatSessionId)로 START/END 매핑
 * - 전송 실패 시 로컬 큐(JSONL)에 적재 + 지수 백오프 재시도
 * - reason 200자 제한, 제어문자 제거
 */

import { randomUUID } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOG_CODES, PATHS } from "./constants.js";
import { ensureDir } from "./storage.js";
import {
  reportLeaveSeatEvent,
  type LeaveSeatReportRequest
} from "./api-client.js";
import type { TelemetryLogger } from "./telemetry-log.js";

export type WorkSessionType = "NORMAL" | "TEMP_EXTEND" | "EMERGENCY_USE";

interface QueuedEvent extends LeaveSeatReportRequest {
  retryCount: number;
  nextRetryAt: string;
}

const MAX_REASON_LENGTH = 200;
const MAX_RETRY = 10;
const BACKOFF_STEPS_MS = [10_000, 30_000, 60_000, 300_000, 900_000];
const FLUSH_INTERVAL_MS = 30_000;

function sanitizeReason(raw?: string): string {
  if (!raw) return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_REASON_LENGTH);
}

function backoffMs(retryCount: number): number {
  const idx = Math.min(retryCount, BACKOFF_STEPS_MS.length - 1);
  return BACKOFF_STEPS_MS[idx];
}

export class LeaveSeatReporter {
  private currentSessionId: string | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private readonly baseDir: string,
    private readonly logger: TelemetryLogger,
    private readonly getApiBaseUrl: () => string | null,
    private readonly getContext: () => {
      workYmd: string;
      userServareaId: string;
      userStaffId: string;
      deviceId: string;
      clientVersion: string;
    }
  ) {}

  /** 큐 플러시 타이머 시작 (로그인 후 호출) */
  start(): void {
    this.stopFlushTimer();
    this.flushTimer = setInterval(() => void this.flushQueue(), FLUSH_INTERVAL_MS);
    void this.flushQueue();
  }

  /** 정리 (로그아웃·앱 종료 시) */
  stop(): void {
    this.stopFlushTimer();
    this.currentSessionId = null;
  }

  /** 활성 이석 세션이 있는지 확인 */
  hasActiveSession(): boolean {
    return this.currentSessionId !== null;
  }

  /**
   * 이석 시작 — START 전송
   * 중복 START 방지: 이미 활성 세션이 있으면 무시
   */
  async reportStart(
    reason: "INACTIVITY" | "SLEEP_EXCEEDED",
    workSessionType: WorkSessionType,
    occurredAt: Date
  ): Promise<void> {
    if (this.currentSessionId) return;

    this.currentSessionId = randomUUID();
    const ctx = this.getContext();

    const request: LeaveSeatReportRequest = {
      eventType: "LEAVE_SEAT_START",
      workSessionType,
      leaveSeatSessionId: this.currentSessionId,
      reason: sanitizeReason(reason),
      occurredAt: occurredAt.toISOString(),
      clientVersion: ctx.clientVersion,
      workYmd: ctx.workYmd,
      userServareaId: ctx.userServareaId,
      userStaffId: ctx.userStaffId,
      deviceId: ctx.deviceId
    };

    await this.logger.write(LOG_CODES.LEAVE_SEAT_START, "INFO", {
      leaveSeatSessionId: this.currentSessionId,
      reason,
      workSessionType,
      occurredAt: occurredAt.toISOString()
    });

    await this.sendOrQueue(request);
  }

  /**
   * 이석 종료 — END 전송
   * START 없이 END 금지: 활성 세션이 없으면 무시
   */
  async reportEnd(reason?: string): Promise<void> {
    if (!this.currentSessionId) return;

    const sessionId = this.currentSessionId;
    this.currentSessionId = null;
    const ctx = this.getContext();

    const request: LeaveSeatReportRequest = {
      eventType: "LEAVE_SEAT_END",
      workSessionType: "NORMAL",
      leaveSeatSessionId: sessionId,
      reason: sanitizeReason(reason),
      occurredAt: new Date().toISOString(),
      clientVersion: ctx.clientVersion,
      workYmd: ctx.workYmd,
      userServareaId: ctx.userServareaId,
      userStaffId: ctx.userStaffId,
      deviceId: ctx.deviceId
    };

    await this.logger.write(LOG_CODES.LEAVE_SEAT_END, "INFO", {
      leaveSeatSessionId: sessionId,
      reason: sanitizeReason(reason)
    });

    await this.sendOrQueue(request);
  }

  // ── 전송·큐 ──

  private async sendOrQueue(request: LeaveSeatReportRequest): Promise<void> {
    const baseUrl = this.getApiBaseUrl();
    if (!baseUrl) {
      await this.enqueue(request, 0);
      return;
    }

    try {
      await reportLeaveSeatEvent(baseUrl, request);
    } catch (err) {
      await this.logger.write(LOG_CODES.LEAVE_SEAT_REPORT_FAILED, "WARN", {
        leaveSeatSessionId: request.leaveSeatSessionId,
        eventType: request.eventType,
        error: String(err)
      });
      await this.enqueue(request, 0);
    }
  }

  private queuePath(): string {
    return join(this.baseDir, PATHS.leaveSeatQueue);
  }

  private async enqueue(request: LeaveSeatReportRequest, retryCount: number): Promise<void> {
    const item: QueuedEvent = {
      ...request,
      retryCount,
      nextRetryAt: new Date(Date.now() + backoffMs(retryCount)).toISOString()
    };
    const dir = join(this.baseDir);
    await ensureDir(dir);
    await appendFile(this.queuePath(), JSON.stringify(item) + "\n", "utf-8");
  }

  /** 큐에 쌓인 이벤트를 재전송 시도 */
  async flushQueue(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const path = this.queuePath();
      let raw: string;
      try {
        raw = await readFile(path, "utf-8");
      } catch {
        return;
      }

      const lines = raw.trim().split("\n").filter(Boolean);
      if (lines.length === 0) return;

      const remaining: QueuedEvent[] = [];
      const now = Date.now();
      const baseUrl = this.getApiBaseUrl();

      for (const line of lines) {
        let item: QueuedEvent;
        try {
          item = JSON.parse(line) as QueuedEvent;
        } catch {
          continue;
        }

        if (new Date(item.nextRetryAt).getTime() > now) {
          remaining.push(item);
          continue;
        }

        if (!baseUrl || item.retryCount >= MAX_RETRY) {
          if (item.retryCount >= MAX_RETRY) {
            await this.logger.write(LOG_CODES.LEAVE_SEAT_REPORT_FAILED, "ERROR", {
              leaveSeatSessionId: item.leaveSeatSessionId,
              eventType: item.eventType,
              retryCount: item.retryCount,
              status: "MAX_RETRY_EXCEEDED"
            });
          } else {
            remaining.push(item);
          }
          continue;
        }

        try {
          await reportLeaveSeatEvent(baseUrl, item);
          await this.logger.write(LOG_CODES.LEAVE_SEAT_REPORT_RETRY, "INFO", {
            leaveSeatSessionId: item.leaveSeatSessionId,
            eventType: item.eventType,
            retryCount: item.retryCount,
            status: "SUCCESS"
          });
        } catch {
          const next: QueuedEvent = {
            ...item,
            retryCount: item.retryCount + 1,
            nextRetryAt: new Date(now + backoffMs(item.retryCount + 1)).toISOString()
          };
          remaining.push(next);
        }
      }

      if (remaining.length === 0) {
        await writeFile(path, "", "utf-8");
      } else {
        await writeFile(
          path,
          remaining.map((e) => JSON.stringify(e)).join("\n") + "\n",
          "utf-8"
        );
      }
    } finally {
      this.flushing = false;
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
