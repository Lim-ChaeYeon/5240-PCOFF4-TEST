import { LOG_CODES } from "./constants.js";
import { TelemetryLogger } from "./telemetry-log.js";

export class OpsObserver {
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly logger: TelemetryLogger) {}

  startHeartbeat(intervalMs = 60_000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.logger.write("HEARTBEAT", "INFO", { intervalMs });
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  async reportOffline(reason: string): Promise<void> {
    await this.logger.write(LOG_CODES.OFFLINE_DETECTED, "WARN", { reason });
  }

  async syncInstallerRegistry(installerId: string): Promise<void> {
    await this.logger.write("INSTALLER_REGISTRY_SYNC", "INFO", { installerId });
  }
}
