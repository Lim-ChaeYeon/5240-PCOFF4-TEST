import { LOG_CODES } from "./constants.js";
import { TelemetryLogger } from "./telemetry-log.js";

export interface PasswordChangeEvent {
  detected: boolean;
  message?: string;
  confirmedAt?: string;
}

export class AuthPolicy {
  private passwordChangeState: PasswordChangeEvent = { detected: false };

  constructor(private readonly logger: TelemetryLogger) {}

  /**
   * 비밀번호 변경 이벤트 감지
   * 서버 응답(pwdChgYn)이나 설정 변경 시 호출
   */
  async onPasswordChangeDetected(source: string, message?: string): Promise<void> {
    this.passwordChangeState = {
      detected: true,
      message: message || "비밀번호가 변경되었습니다. 확인 버튼을 눌러주세요.",
    };
    await this.logger.write(LOG_CODES.PASSWORD_CHANGE_DETECTED, "INFO", {
      source,
      message,
    });
  }

  /**
   * 사용자가 비밀번호 변경 확인 UI에서 "확인"을 클릭
   * FR-04: 비밀번호 검증 없이 확인만 수행
   */
  async confirmPasswordChange(userId: string): Promise<void> {
    this.passwordChangeState = {
      detected: false,
      confirmedAt: new Date().toISOString(),
    };
    await this.logger.write(LOG_CODES.PASSWORD_CONFIRM_DONE, "INFO", {
      userId,
      validation: "skipped", // FR-04: 비밀번호 검증 수행하지 않음
    });
  }

  /**
   * 현재 비밀번호 변경 상태 조회
   */
  getPasswordChangeState(): PasswordChangeEvent {
    return this.passwordChangeState;
  }

  /**
   * 비밀번호 변경 감지 상태 확인
   */
  isPasswordChangeRequired(): boolean {
    return this.passwordChangeState.detected;
  }
}
