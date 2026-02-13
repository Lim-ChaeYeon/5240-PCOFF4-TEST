import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LOG_CODES, PATHS } from "./constants.js";
import { readJson, writeJson } from "./storage.js";
import { TelemetryLogger } from "./telemetry-log.js";

interface IntegrityState { files: Record<string, string> }

export class AgentGuard {
  constructor(private readonly baseDir: string, private readonly logger: TelemetryLogger) {}

  async capture(filePaths: string[]): Promise<void> {
    const files: Record<string, string> = {};
    for (const filePath of filePaths) files[filePath] = await this.hash(filePath);
    await writeJson(join(this.baseDir, PATHS.integrity), { files } satisfies IntegrityState);
  }

  async verify(filePaths: string[]): Promise<boolean> {
    const state = await readJson<IntegrityState>(join(this.baseDir, PATHS.integrity), { files: {} });
    for (const filePath of filePaths) {
      const now = await this.hash(filePath);
      const prev = state.files[filePath];
      if (prev && prev !== now) {
        await this.logger.write(LOG_CODES.AGENT_TAMPER_DETECTED, "ERROR", { filePath });
        await this.logger.write(LOG_CODES.AGENT_RECOVERED, "WARN", { filePath, strategy: "trigger_only" });
        return false;
      }
    }
    return true;
  }

  private async hash(path: string): Promise<string> {
    const bin = await readFile(path);
    return createHash("sha256").update(bin).digest("hex");
  }
}
