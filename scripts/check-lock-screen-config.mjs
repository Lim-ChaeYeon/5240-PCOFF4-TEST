#!/usr/bin/env node
/**
 * 추후 개발·점검 2번: 잠금화면 문구 API Fallback 준비 상태 검증
 *
 * 서버(getLockScreenInfo.do / lock-policy) 미구현 시 config.json의 lockScreen 또는
 * lockScreenApiUrl로 문구를 쓸 수 있는지 설정만 검사합니다.
 *
 * 사용법:
 *   node scripts/check-lock-screen-config.mjs
 *   node scripts/check-lock-screen-config.mjs --path=./config.json
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const pathArg = args.find((a) => a.startsWith("--path="));
const configPath = pathArg ? pathArg.slice("--path=".length) : join(process.cwd(), "config.json");

async function main() {
  let config;
  try {
    const raw = await readFile(configPath, "utf-8");
    config = JSON.parse(raw);
  } catch (e) {
    console.error("config 읽기 실패:", configPath, e.message);
    process.exit(1);
  }

  const lockScreen = config.lockScreen || {};
  const before = lockScreen.before || {};
  const off = lockScreen.off || {};
  const leave = lockScreen.leave || {};
  const hasApiUrl = !!config.lockScreenApiUrl;

  const checks = [
    { name: "lockScreen.before (시업 전)", ok: !!(before.title || before.message || before.backgroundUrl || before.logoUrl) },
    { name: "lockScreen.off (종업)", ok: !!(off.title || off.message || off.backgroundUrl || off.logoUrl) },
    { name: "lockScreen.leave (이석)", ok: !!(leave.title || leave.message || leave.backgroundUrl || leave.logoUrl) },
    { name: "lockScreenApiUrl (문구 API URL)", ok: hasApiUrl }
  ];

  const anyOk = checks.some((c) => c.ok);
  console.log("설정 파일:", configPath);
  console.log("");
  checks.forEach((c) => console.log(`  ${c.ok ? "[OK]" : "[--]"} ${c.name}`));
  console.log("");
  if (anyOk) {
    console.log("→ 서버 API 미구현 시 위 설정으로 잠금화면 문구 Fallback 가능.");
  } else {
    console.log("→ lockScreen 또는 lockScreenApiUrl이 없습니다. 서버 미구현 시 기본 문구만 표시됩니다.");
    console.log("  예: config.json에 lockScreen.before/off/leave 또는 lockScreenApiUrl 추가.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
