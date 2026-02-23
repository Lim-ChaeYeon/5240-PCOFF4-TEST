/**
 * FR-15 Emergency Unlock — 비밀번호 기반 긴급해제
 *
 * - 잠금 상태에서 비밀번호 검증 후 잠금 해제
 * - maxFailures(기본 5회) 초과 → lockoutSeconds(기본 300초) 차단
 * - 성공 후 3시간 경과 시 조건 기반 잠금화면 복귀
 * - 5분 전 만료 예고
 */
import { join } from "node:path";
import { LOG_CODES, PATHS } from "./constants.js";
import { readJson, writeJson } from "./storage.js";
import type { TelemetryLogger } from "./telemetry-log.js";
import type { PcOffApiClient, EmergencyUnlockResponse } from "./api-client.js";

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_LOCKOUT_MS = 5 * 60 * 1000; // 5분
const DEFAULT_UNLOCK_DURATION_MS = 3 * 60 * 60 * 1000; // 기본 3시간 (서버 옵션으로 덮어쓸 수 있음)
const EXPIRY_WARNING_MS = 5 * 60 * 1000; // 만료 5분 전

export interface EmergencyUnlockState {
  active: boolean;
  startAt: string | null;
  expiresAt: string | null;
  failureCount: number;
  lockedUntil: string | null;
}

const EMPTY_STATE: EmergencyUnlockState = {
  active: false,
  startAt: null,
  expiresAt: null,
  failureCount: 0,
  lockedUntil: null
};

export type EmergencyUnlockCallback = (event: "expired" | "expiry_warning") => void;

export class EmergencyUnlockManager {
  private state: EmergencyUnlockState = { ...EMPTY_STATE };
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private warningTimer?: ReturnType<typeof setTimeout>;
  private callback?: EmergencyUnlockCallback;
  private readonly stateFilePath: string;
  private unlockDurationMs = DEFAULT_UNLOCK_DURATION_MS;
  private maxFailures = DEFAULT_MAX_FAILURES;
  private lockoutMs = DEFAULT_LOCKOUT_MS;

  constructor(
    private readonly baseDir: string,
    private readonly logger: TelemetryLogger
  ) {
    this.stateFilePath = join(baseDir, PATHS.emergencyUnlockState);
  }

  /** 서버 정책 값으로 설정 갱신 (getPcOffWorkTime 응답 기준) */
  updatePolicy(opts: {
    unlockTimeMinutes?: number;
    maxFailures?: number;
    lockoutSeconds?: number;
  }): void {
    if (opts.unlockTimeMinutes && opts.unlockTimeMinutes > 0) {
      this.unlockDurationMs = opts.unlockTimeMinutes * 60 * 1000;
    }
    if (opts.maxFailures && opts.maxFailures > 0) {
      this.maxFailures = opts.maxFailures;
    }
    if (opts.lockoutSeconds && opts.lockoutSeconds > 0) {
      this.lockoutMs = opts.lockoutSeconds * 1000;
    }
  }

  setCallback(cb: EmergencyUnlockCallback): void {
    this.callback = cb;
  }

  getState(): Readonly<EmergencyUnlockState> {
    return { ...this.state };
  }

  get isActive(): boolean {
    if (!this.state.active || !this.state.expiresAt) return false;
    return Date.now() < new Date(this.state.expiresAt).getTime();
  }

  get isLockedOut(): boolean {
    if (!this.state.lockedUntil) return false;
    return Date.now() < new Date(this.state.lockedUntil).getTime();
  }

  get remainingLockoutMs(): number {
    if (!this.state.lockedUntil) return 0;
    return Math.max(0, new Date(this.state.lockedUntil).getTime() - Date.now());
  }

  async restore(): Promise<void> {
    this.state = await readJson<EmergencyUnlockState>(this.stateFilePath, { ...EMPTY_STATE });

    if (this.state.active && this.state.expiresAt) {
      const remaining = new Date(this.state.expiresAt).getTime() - Date.now();
      if (remaining <= 0) {
        await this.expire();
      } else {
        this.scheduleExpiry(remaining);
      }
    }

    if (this.state.lockedUntil && new Date(this.state.lockedUntil).getTime() <= Date.now()) {
      this.state.lockedUntil = null;
      this.state.failureCount = 0;
      await this.persist();
    }
  }

  /**
   * 긴급해제 시도: 서버에 비밀번호 검증 후 결과 반환
   */
  async attempt(
    apiClient: PcOffApiClient,
    password: string,
    reason?: string
  ): Promise<{ success: boolean; message: string; remainingAttempts: number; lockedUntil?: string }> {
    await this.logger.write(LOG_CODES.EMERGENCY_UNLOCK_ATTEMPT, "INFO", { reason });

    if (this.isLockedOut) {
      const lockedUntil = this.state.lockedUntil!;
      return {
        success: false,
        message: `시도 횟수 초과로 차단 중입니다. ${new Date(lockedUntil).toLocaleTimeString("ko-KR")}까지 대기해 주세요.`,
        remainingAttempts: 0,
        lockedUntil
      };
    }

    let response: EmergencyUnlockResponse;
    try {
      response = await apiClient.callPcOffEmergencyUnlock({ password, reason });
    } catch (err) {
      return {
        success: false,
        message: `서버 통신 오류: ${String(err)}`,
        remainingAttempts: Math.max(0, this.maxFailures - this.state.failureCount)
      };
    }

    if (response.success) {
      await this.onSuccess();
      return {
        success: true,
        message: response.message ?? "긴급해제 성공",
        remainingAttempts: this.maxFailures
      };
    }

    // 실패 처리
    this.state.failureCount += 1;
    const remaining = Math.max(0, this.maxFailures - this.state.failureCount);

    if (this.state.failureCount >= this.maxFailures) {
      const lockedUntil = new Date(Date.now() + this.lockoutMs).toISOString();
      this.state.lockedUntil = lockedUntil;
      await this.persist();
      await this.logger.write(LOG_CODES.EMERGENCY_UNLOCK_LOCKED, "WARN", {
        failureCount: this.state.failureCount,
        lockedUntil
      });

      // lockout 해제 후 failureCount 리셋 타이머
      setTimeout(async () => {
        this.state.lockedUntil = null;
        this.state.failureCount = 0;
        await this.persist();
      }, this.lockoutMs);

      return {
        success: false,
        message: response.message ?? `${this.maxFailures}회 실패하여 ${Math.round(this.lockoutMs / 60000)}분간 차단됩니다.`,
        remainingAttempts: 0,
        lockedUntil
      };
    }

    await this.persist();
    await this.logger.write(LOG_CODES.EMERGENCY_UNLOCK_FAILED, "WARN", {
      failureCount: this.state.failureCount,
      remainingAttempts: remaining
    });

    return {
      success: false,
      message: response.message ?? `비밀번호가 일치하지 않습니다. (${remaining}회 남음)`,
      remainingAttempts: remaining
    };
  }

  private async onSuccess(): Promise<void> {
    const now = new Date();
    const durationMs = this.unlockDurationMs;
    this.state = {
      active: true,
      startAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationMs).toISOString(),
      failureCount: 0,
      lockedUntil: null
    };
    await this.persist();
    await this.logger.write(LOG_CODES.EMERGENCY_UNLOCK_SUCCESS, "INFO", {
      startAt: this.state.startAt,
      expiresAt: this.state.expiresAt,
      durationMinutes: Math.round(durationMs / 60000)
    });
    this.scheduleExpiry(durationMs);
  }

  private scheduleExpiry(remainingMs: number): void {
    this.clearTimers();

    // 만료 타이머
    this.expiryTimer = setTimeout(() => void this.expire(), remainingMs);

    // 5분 전 예고
    const warningDelay = remainingMs - EXPIRY_WARNING_MS;
    if (warningDelay > 0) {
      this.warningTimer = setTimeout(() => {
        void this.logger.write(LOG_CODES.EMERGENCY_UNLOCK_EXPIRY_WARNING, "INFO", {
          expiresAt: this.state.expiresAt,
          remainingSec: Math.round(EXPIRY_WARNING_MS / 1000)
        });
        this.callback?.("expiry_warning");
      }, warningDelay);
    }
  }

  private async expire(): Promise<void> {
    this.clearTimers();
    this.state = { ...EMPTY_STATE };
    await this.persist();
    await this.logger.write(LOG_CODES.EMERGENCY_UNLOCK_EXPIRED, "INFO", {});
    this.callback?.("expired");
  }

  /** 외부에서 수동 만료 (예: 사용자가 잠금화면으로 전환 시) */
  async deactivate(): Promise<void> {
    if (!this.state.active) return;
    await this.expire();
  }

  stop(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.expiryTimer) { clearTimeout(this.expiryTimer); this.expiryTimer = undefined; }
    if (this.warningTimer) { clearTimeout(this.warningTimer); this.warningTimer = undefined; }
  }

  private async persist(): Promise<void> {
    try {
      await writeJson(this.stateFilePath, this.state);
    } catch (err) {
      console.error("[EmergencyUnlock] persist failed:", err);
    }
  }
}
