/**
 * leave-seat.ts
 * 이석 감지·해제 정책 모듈
 *
 * 정책:
 * - screenType === "empty" → 이석 상태
 * - leaveSeatReasonYn=YES && leaveSeatReasonManYn=YES → PC-ON 시 사유 입력 필수
 * - 단, 휴게시간 중이면 사유입력 면제 (breakStartTime~breakEndTime 판별)
 */

export interface WorkTimePolicyFields {
  screenType?: string;
  leaveSeatReasonYn?: "YES" | "NO";
  leaveSeatReasonManYn?: "YES" | "NO";
  leaveSeatUseYn?: "Y" | "N";
  /** 이석 감지 시작 시각 (YYYYMMDDHHmm) */
  leaveSeatOffInputMath?: string;
  /** 휴게 시작 시각 (HHmm 또는 YYYYMMDDHHmm) */
  breakStartTime?: string;
  /** 휴게 종료 시각 (HHmm 또는 YYYYMMDDHHmm) */
  breakEndTime?: string;
}

export interface LeaveSeatPolicy {
  /** 현재 이석 상태인지 */
  isLeaveSeat: boolean;
  /** PC-ON 시 사유 입력이 필요한지 */
  requireReason: boolean;
  /** 휴게시간 중 여부 (사유 면제 조건) */
  isBreakTime: boolean;
  /** 이석 감지 시각 표시용 */
  detectedAt: string | null;
}

/**
 * HHmm 또는 YYYYMMDDHHmm 문자열을 오늘 기준 Date로 변환
 */
function parseTimeToDate(value: string | undefined): Date | null {
  if (!value) return null;
  if (value.length === 4) {
    // HHmm
    const now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(value.slice(0, 2)),
      Number(value.slice(2, 4)),
      0
    );
  }
  if (value.length === 12) {
    // YYYYMMDDHHmm
    return new Date(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
      Number(value.slice(8, 10)),
      Number(value.slice(10, 12)),
      0
    );
  }
  return null;
}

/**
 * 현재 시각이 휴게시간 구간 안인지 판별
 */
function checkIsBreakTime(
  breakStartTime: string | undefined,
  breakEndTime: string | undefined
): boolean {
  if (!breakStartTime || !breakEndTime) return false;
  const now = new Date();
  const start = parseTimeToDate(breakStartTime);
  const end = parseTimeToDate(breakEndTime);
  if (!start || !end) return false;
  return now >= start && now < end;
}

/**
 * getPcOffWorkTime 응답에서 이석 정책을 계산한다.
 */
export function calcLeaveSeatPolicy(fields: WorkTimePolicyFields): LeaveSeatPolicy {
  const isLeaveSeat = fields.screenType === "empty";

  const isBreakTime = checkIsBreakTime(fields.breakStartTime, fields.breakEndTime);

  // 사유 필수: 이석 상태이고, 정책 YES이고, 직접입력 YES이고, 휴게시간이 아닌 경우
  const requireReason =
    isLeaveSeat &&
    fields.leaveSeatReasonYn === "YES" &&
    fields.leaveSeatReasonManYn === "YES" &&
    !isBreakTime;

  const detectedAt = fields.leaveSeatOffInputMath
    ? formatDetectedAt(fields.leaveSeatOffInputMath)
    : null;

  return { isLeaveSeat, requireReason, isBreakTime, detectedAt };
}

/**
 * YYYYMMDDHHmm → "HH:mm" 형식으로 변환 (화면 표시용)
 */
function formatDetectedAt(value: string): string {
  if (value.length !== 12) return value;
  return `${value.slice(8, 10)}:${value.slice(10, 12)}`;
}
