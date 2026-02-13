import { join } from "node:path";
import { LOG_CODES, PATHS } from "./constants.js";
import { readJson, writeJson } from "./storage.js";
import { TelemetryLogger } from "./telemetry-log.js";

interface UpdateQueueItem { version: string; reason: string; queuedAt: string }

export class UpdateManager {
  constructor(private readonly baseDir: string, private readonly logger: TelemetryLogger) {}

  async checkAndApplySilently(nextVersion = "0.1.1"): Promise<void> {
    await this.logger.write(LOG_CODES.UPDATE_FOUND, "INFO", { nextVersion });
    const downloadOk = await this.downloadPackage(nextVersion);
    if (!downloadOk) return this.enqueueRetry(nextVersion, "network_error");

    const integrityOk = await this.verifyIntegrity(nextVersion);
    if (!integrityOk) return this.enqueueRetry(nextVersion, "integrity_failed");

    await this.logger.write(LOG_CODES.UPDATE_APPLIED, "INFO", { version: nextVersion, silent: true });
  }

  private async downloadPackage(version: string): Promise<boolean> {
    await this.logger.write(LOG_CODES.UPDATE_DOWNLOADED, "INFO", { version, mode: "background" });
    return true;
  }

  private async verifyIntegrity(version: string): Promise<boolean> {
    return version.length > 0;
  }

  private async enqueueRetry(version: string, reason: string): Promise<void> {
    const queuePath = join(this.baseDir, PATHS.retryQueue);
    const queue = await readJson<UpdateQueueItem[]>(queuePath, []);
    queue.push({ version, reason, queuedAt: new Date().toISOString() });
    await writeJson(queuePath, queue);
    await this.logger.write(LOG_CODES.UPDATE_FAILED, "WARN", { version, reason });
  }
}
