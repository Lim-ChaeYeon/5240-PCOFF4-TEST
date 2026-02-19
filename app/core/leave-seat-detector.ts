/**
 * leave-seat-detector.ts
 * 로컬 이석 감지: 유휴(Idle) 시간·절전(Suspend/Resume) 기반
 *
 * - Idle: powerMonitor.getSystemIdleTime() 폴링, leaveSeatTime(분) 초과 시 이석 감지
 * - 절전: suspend 시각 기록, resume 시 경과 >= leaveSeatTime 이면 이석 감지 (leaveDetectedAt = 절전 시작 시각)
 *
 * 정책: getPcOffWorkTime 응답의 leaveSeatUseYn=Y, leaveSeatTime>0 일 때만 동작
 */

import { powerMonitor } from "electron";

export type LeaveSeatDetectedReason = "INACTIVITY" | "SLEEP_EXCEEDED";

export interface LeaveSeatPolicy {
  leaveSeatUseYn: "Y" | "N";
  /** 이석 판정 기준 시간(분) */
  leaveSeatTimeMinutes: number;
}

const POLL_INTERVAL_MS = 5_000; // 5초 폴링

export interface LeaveSeatDetectorCallbacks {
  onIdleDetected: (detectedAt: Date, idleSeconds: number) => void;
  onSleepDetected: (detectedAt: Date, sleepElapsedSeconds: number) => void;
  onSleepEntered?: () => void;
  onSleepResumed?: () => void;
  /** 이미 이석 잠금 상태면 true → 중복 감지 방지 */
  isLeaveSeatActive: () => boolean;
}

export class LeaveSeatDetector {
  private policy: LeaveSeatPolicy = { leaveSeatUseYn: "N", leaveSeatTimeMinutes: 0 };
  private callbacks: LeaveSeatDetectorCallbacks | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sleepStartedAt: Date | null = null;
  private suspendHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;

  /**
   * 정책 갱신 (getPcOffWorkTime 응답 기준)
   */
  updatePolicy(policy: Partial<LeaveSeatPolicy>): void {
    if (policy.leaveSeatUseYn !== undefined) this.policy.leaveSeatUseYn = policy.leaveSeatUseYn;
    if (policy.leaveSeatTimeMinutes !== undefined) {
      this.policy.leaveSeatTimeMinutes = Math.max(0, policy.leaveSeatTimeMinutes);
    }
  }

  /**
   * 감지 시작. 로그인 후·근태 정책 로드 후 호출
   */
  start(callbacks: LeaveSeatDetectorCallbacks): void {
    this.callbacks = callbacks;
    this.sleepStartedAt = null;

    // Idle 폴링
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.checkIdle(), POLL_INTERVAL_MS);

    // 절전 이벤트
    this.suspendHandler = () => this.onSuspend();
    this.resumeHandler = () => this.onResume();
    powerMonitor.on("suspend", this.suspendHandler);
    powerMonitor.on("resume", this.resumeHandler);
  }

  /**
   * 감지 중지 (앱 종료·로그아웃 시)
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.suspendHandler) {
      powerMonitor.off("suspend", this.suspendHandler);
      this.suspendHandler = null;
    }
    if (this.resumeHandler) {
      powerMonitor.off("resume", this.resumeHandler);
      this.resumeHandler = null;
    }
    this.callbacks = null;
    this.sleepStartedAt = null;
  }

  private checkIdle(): void {
    if (this.policy.leaveSeatUseYn !== "Y" || this.policy.leaveSeatTimeMinutes <= 0 || !this.callbacks) return;
    if (this.callbacks.isLeaveSeatActive()) return;

    let idleSeconds = 0;
    try {
      idleSeconds = powerMonitor.getSystemIdleTime();
    } catch {
      return;
    }

    const thresholdSec = this.policy.leaveSeatTimeMinutes * 60;
    if (idleSeconds >= thresholdSec) {
      const detectedAt = new Date(Date.now() - idleSeconds * 1000);
      this.callbacks.onIdleDetected(detectedAt, idleSeconds);
    }
  }

  private onSuspend(): void {
    this.sleepStartedAt = new Date();
    this.callbacks?.onSleepEntered?.();
  }

  private onResume(): void {
    this.callbacks?.onSleepResumed?.();

    if (
      this.policy.leaveSeatUseYn !== "Y" ||
      this.policy.leaveSeatTimeMinutes <= 0 ||
      !this.sleepStartedAt ||
      !this.callbacks
    ) {
      this.sleepStartedAt = null;
      return;
    }
    if (this.callbacks.isLeaveSeatActive()) {
      this.sleepStartedAt = null;
      return;
    }

    const sleepElapsedSec = (Date.now() - this.sleepStartedAt.getTime()) / 1000;
    const thresholdSec = this.policy.leaveSeatTimeMinutes * 60;

    if (sleepElapsedSec >= thresholdSec) {
      this.callbacks.onSleepDetected(this.sleepStartedAt, sleepElapsedSec);
    }
    this.sleepStartedAt = null;
  }
}
