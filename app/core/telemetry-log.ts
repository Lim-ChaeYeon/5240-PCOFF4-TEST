import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "./constants.js";
import { ensureDir } from "./storage.js";
import type { LogEntry, LogLevel } from "./types.js";

/** 로그 항목을 서버 등으로 전달하는 transport (Ops Observer용) */
export type LogTransport = (entry: LogEntry) => void;

export class TelemetryLogger {
  private transport: LogTransport | null = null;

  constructor(
    private readonly baseDir: string,
    private readonly sessionId: string,
    private readonly deviceId: string
  ) {}

  /** 서버 전송 등 추가 전달용 transport 등록 (FR-08) */
  addTransport(fn: LogTransport): void {
    this.transport = fn;
  }

  removeTransport(): void {
    this.transport = null;
  }

  async write(logCode: string, level: LogLevel, payload: Record<string, unknown>): Promise<void> {
    const now = new Date();
    const fileDate = now.toISOString().slice(0, 10);
    const logDir = join(this.baseDir, PATHS.logsDir);
    const logFile = join(logDir, `${fileDate}.json`);
    const entry: LogEntry = {
      timestamp: now.toISOString(),
      logCode,
      level,
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      payload
    };

    await ensureDir(logDir);
    await appendFile(logFile, `${JSON.stringify(entry)}\n`, "utf-8");

    if (this.transport) {
      try {
        this.transport(entry);
      } catch {
        // transport 실패 시 로컬 기록만 유지
      }
    }
  }
}
