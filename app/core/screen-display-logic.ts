/**
 * 시업/종업 화면 표시 로직 (FR-13)
 * - 옵션 1227(exCountRenewal): 일자변경 시각 기준으로 종업/시업 구분
 * - now < exCountRenewal → 종업화면(off), now >= exCountRenewal → 시업화면(before)
 * - 이석(empty)은 서버 또는 로컬 이석 감지로 유지
 */

import type { WorkTimeResponse } from "./api-client.js";

export type ScreenType = "before" | "off" | "empty";

/** YYYYMMDDHH24MI → Date. 잘못된 형식이면 null */
function parseExCountRenewal(value: string | undefined): Date | null {
  if (!value || value.length < 12) return null;
  const y = parseInt(value.slice(0, 4), 10);
  const m = parseInt(value.slice(4, 6), 10) - 1;
  const d = parseInt(value.slice(6, 8), 10);
  const h = parseInt(value.slice(8, 10), 10);
  const min = parseInt(value.slice(10, 12), 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d) || Number.isNaN(h) || Number.isNaN(min))
    return null;
  const date = new Date(y, m, d, h, min, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 근태 데이터와 현재 시각·이석 여부로 표시용 screenType 결정
 * - 이미 잠금화면(종업 off / 시업 전 before)이면 이석을 적용하지 않음(이석 체크 생략)
 * - exCountRenewal 있으면: now < renewal → "off", else → "before" (종업/시업 전 잠금이면 이석 미적용)
 * - 서버 screenType이 "before" 또는 "off"이면 그대로 반환
 * - 그 외 로컬 이석 감지 중이면 "empty", 서버가 "empty"면 "empty"
 */
export function resolveScreenType(
  work: Partial<WorkTimeResponse> & { screenType?: string },
  now: Date = new Date(),
  isLeaveSeatDetected: boolean = false
): ScreenType {
  const renewal = parseExCountRenewal(work.exCountRenewal);
  if (renewal) {
    return now < renewal ? "off" : "before";
  }

  const serverScreenType = (work.screenType ?? "").toString().toLowerCase();
  if (serverScreenType === "before" || serverScreenType === "off") {
    return serverScreenType as ScreenType;
  }

  if (isLeaveSeatDetected) return "empty";
  if (serverScreenType === "empty") return "empty";
  return "off";
}
