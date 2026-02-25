/**
 * FR-18 Kill 통제 — Process Fingerprint 수집
 * kill-execute API 호출 시 서버로 보낼 payload 생성 (PID 재사용 공격 방지)
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { KillProcessFingerprint } from "./api-client.js";

const MAX_EXE_SIZE_FOR_HASH = 10 * 1024 * 1024; // 10MB

/**
 * 현재 프로세스의 Fingerprint 수집.
 * Main 프로세스에서 호출. exePath 읽기 실패 시 exeHash는 생략.
 */
export function getProcessFingerprint(): KillProcessFingerprint {
  const pid = process.pid ?? 0;
  const exePath = process.execPath ?? "";
  const cmdLine = process.argv?.length ? process.argv.join(" ") : undefined;

  let exeHash: string | undefined;
  if (exePath && existsSync(exePath)) {
    try {
      const buf = readFileSync(exePath, { flag: "r" });
      const len = Math.min(buf.length, MAX_EXE_SIZE_FOR_HASH);
      exeHash = createHash("sha256").update(buf.subarray(0, len)).digest("hex");
    } catch {
      // 권한/경로 이슈 시 생략
    }
  }

  return {
    pid,
    createdAt: new Date().toISOString(),
    exePath,
    cmdLine,
    exeHash
  };
}
