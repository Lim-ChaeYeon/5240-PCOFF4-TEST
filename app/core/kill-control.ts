/**
 * FR-18 Kill 통제 — API 호출·감사 로그·quit 연동
 * 백엔드 구현 후 api-client의 createKillRequest/verifyKillOtp/killExecute만 실제 HTTP로 교체하면 됨.
 */
import { LOG_CODES } from "./constants.js";
import { getProcessFingerprint } from "./kill-fingerprint.js";
import {
  createKillRequest,
  verifyKillOtp,
  killExecute,
  type KillRequestResponse,
  type KillVerifyOtpResponse
} from "./api-client.js";
import type { TelemetryLogger } from "./telemetry-log.js";

/** Kill 요청 등록 + KILL_REQUEST_CREATED 로그 */
export async function requestKillWithLog(
  baseUrl: string,
  payload: { deviceId?: string; userStaffId?: string; reason?: string },
  logger: TelemetryLogger
): Promise<KillRequestResponse> {
  const result = await createKillRequest(baseUrl, payload);
  await logger.write(LOG_CODES.KILL_REQUEST_CREATED, "INFO", { requestId: (result as { id?: string }).id ?? "" });
  return result;
}

/** OTP 검증 + KILL_OTP_VERIFIED/KILL_TOKEN_ISSUED 또는 KILL_OTP_FAILED 로그 */
export async function verifyKillOtpWithLog(
  baseUrl: string,
  requestId: string,
  otp: string,
  logger: TelemetryLogger
): Promise<KillVerifyOtpResponse> {
  try {
    const result = await verifyKillOtp(baseUrl, requestId, otp);
    await logger.write(LOG_CODES.KILL_OTP_VERIFIED, "INFO", { requestId });
    await logger.write(LOG_CODES.KILL_TOKEN_ISSUED, "INFO", { requestId, expiresAt: result.expiresAt });
    return result;
  } catch {
    await logger.write(LOG_CODES.KILL_OTP_FAILED, "WARN", { requestId }).catch(() => {});
    throw;
  }
}

/**
 * kill-execute 호출 + 성공 시 KILL_EXECUTED 로그 후 appQuit(), 실패 시 KILL_REJECTED 로그.
 * api-client killExecute가 성공 반환 시에만 appQuit() 호출.
 */
export async function executeKillWithToken(
  baseUrl: string,
  token: string,
  logger: TelemetryLogger,
  appQuit: () => void
): Promise<void> {
  const fingerprint = getProcessFingerprint();
  try {
    const result = await killExecute(baseUrl, token, fingerprint);
    if (result?.allowed) {
      await logger.write(LOG_CODES.KILL_EXECUTED, "INFO", { pid: fingerprint.pid });
      appQuit();
    } else {
      await logger.write(LOG_CODES.KILL_REJECTED, "WARN", { reason: "allowed=false" }).catch(() => {});
    }
  } catch {
    await logger.write(LOG_CODES.KILL_REJECTED, "WARN", { reason: "token_invalid_or_expired" }).catch(() => {});
    throw;
  }
}
