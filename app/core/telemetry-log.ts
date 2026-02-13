import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "./constants.js";
import { ensureDir } from "./storage.js";
import type { LogEntry, LogLevel } from "./types.js";

export class TelemetryLogger {
  constructor(
    private readonly baseDir: string,
    private readonly sessionId: string,
    private readonly deviceId: string
  ) {}

  async write(logCode: string, level: LogLevel, payload: Record<string, unknown>): Promise<void> {
    const now = new Date();
    const fileDate = now.toISOString().slice(0, 10);
    const logDir = join(this.baseDir, PATHS.logsDir);
    const logFile = join(logDir, `${fileDate}.jsonl`);
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
  }
}
