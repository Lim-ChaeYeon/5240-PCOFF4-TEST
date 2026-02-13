import { LOG_CODES } from "./constants.js";
import { TelemetryLogger } from "./telemetry-log.js";

export class AuthPolicy {
  constructor(private readonly logger: TelemetryLogger) {}

  async onPasswordChangeDetected(source: string): Promise<void> {
    await this.logger.write(LOG_CODES.PASSWORD_CHANGE_DETECTED, "INFO", { source });
  }

  async confirmPasswordChange(userId: string): Promise<void> {
    await this.logger.write(LOG_CODES.PASSWORD_CONFIRM_DONE, "INFO", {
      userId,
      validation: "skipped"
    });
  }
}
