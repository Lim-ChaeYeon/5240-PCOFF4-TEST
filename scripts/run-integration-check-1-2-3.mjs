#!/usr/bin/env node
/**
 * 추후 개발·점검 1→2→3 연동·E2E 점검 실행
 *
 * 서버 구현 후 한 번에 에이전트 측 검증 + 체크리스트를 실행합니다.
 *
 * 사용법:
 *   node scripts/run-integration-check-1-2-3.mjs           # 시뮬레이터 run-all + 설정 검증 + 체크리스트 출력
 *   node scripts/run-integration-check-1-2-3.mjs --logs=./logs   # 위 + 임시연장 로그 반영 여부 점검(3번)
 *   node scripts/run-integration-check-1-2-3.mjs --skip-simulator  # 시뮬레이터 제외, 설정·체크리스트만
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const skipSimulator = args.includes("--skip-simulator");
const logsArg = args.find((a) => a.startsWith("--logs="));
const logsPath = logsArg ? logsArg.slice("--logs=".length) : "";

async function run(cmd, cmdArgs) {
  return new Promise((resolve) => {
    const c = spawn(cmd, cmdArgs, {
      cwd: ROOT,
      stdio: "inherit",
      shell: true
    });
    c.on("close", (code) => resolve(code));
  });
}

async function checkLockScreenConfig() {
  try {
    const configPath = join(ROOT, "config.json");
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    const lockScreen = config.lockScreen || {};
    const hasBefore = lockScreen.before && (lockScreen.before.title || lockScreen.before.message);
    const hasOff = lockScreen.off && (lockScreen.off.title || lockScreen.off.message);
    const hasLeave = lockScreen.leave && (lockScreen.leave.title || lockScreen.leave.message);
    const hasAny = hasBefore || hasOff || hasLeave;
    const hasApiUrl = !!config.lockScreenApiUrl;
    return {
      ok: true,
      hasAny,
      hasBefore,
      hasOff,
      hasLeave,
      hasApiUrl,
      path: configPath
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function printChecklist() {
  console.log("\n" + "=".repeat(60));
  console.log("추후 개발·점검 1→2→3 — 서버 구현 후 연동·E2E 체크리스트");
  console.log("=".repeat(60));

  console.log("\n[1] 이석 해제 비밀번호");
  console.log("  서버: POST /verifyLeaveSeatUnlock.do (또는 동일 역할 API) 구현 여부");
  console.log("  에이전트: 앱에서 이석 잠금 → PC-ON → 비밀번호 모달 → 검증 성공/실패·토스트 확인");
  console.log("  설정: leaveSeatUnlockRequirePassword=true, leaveSeatUnlockVerifyUrl 또는 leaveSeatUnlockPassword");
  console.log("  상세: docs/추후_개발_점검_연동_가이드.md §1");

  console.log("\n[2] 잠금화면 문구 API");
  console.log("  서버: getLockScreenInfo.do 또는 GET .../lock-policy 구현 여부");
  console.log("  에이전트: 터미널 로그 [PCOFF] 잠금화면 문구 — (getLockScreenInfo.do|lock-policy|lockScreenApiUrl|config) 적용됨 확인");
  console.log("  Fallback: config.lockScreen.before/off/leave 또는 config.lockScreenApiUrl 설정 시 미구현 시에도 문구 표시 가능");
  console.log("  상세: docs/추후_개발_점검_연동_가이드.md §2");

  console.log("\n[3] 임시연장 서버 반영");
  console.log("  서버/DB: callPcOffTempDelay.do 수신 후 JsonMapper·프로시저·DB 갱신 여부");
  console.log("  에이전트: 터미널에서 'callPcOffTempDelay 응답'·'직후 getPcOffWorkTime 응답' 검색 → pcExCount·pcOffYmdTime 일치 확인");
  console.log("  로그 검증: node scripts/check-temp-extend-reflect.mjs [logs경로]");
  console.log("  상세: docs/추후_개발_점검_연동_가이드.md §3");

  console.log("\n" + "=".repeat(60) + "\n");
}

async function main() {
  console.log("추후 개발·점검 1→2→3 연동 점검 시작\n");

  let simExit = 0;
  if (!skipSimulator) {
    console.log("[시뮬레이터] run-all 실행 중...");
    simExit = await run("npx", ["tsx", "simulator/cli.ts", "run-all"]);
    console.log("");
  } else {
    console.log("[시뮬레이터] --skip-simulator 로 건너뜀\n");
  }

  console.log("[잠금화면 Fallback 설정] config.json 검증 중...");
  const configResult = await checkLockScreenConfig();
  if (configResult.ok) {
    if (configResult.hasAny || configResult.hasApiUrl) {
      console.log("  config.json: lockScreen 또는 lockScreenApiUrl 설정 있음 (2번 Fallback 가능)");
    } else {
      console.log("  config.json: lockScreen·lockScreenApiUrl 없음. 서버 미구현 시 기본 문구만 표시됨.");
    }
  } else {
    console.log("  config.json 읽기 실패:", configResult.error);
  }
  console.log("");

  if (logsPath) {
    console.log("[3번 임시연장 반영] 로그 검증 스크립트 실행 중...");
    const reflectExit = await run("node", [
      join(ROOT, "scripts", "check-temp-extend-reflect.mjs"),
      logsPath
    ]);
    console.log("");
    if (reflectExit !== 0) {
      console.log("  → 임시연장 직후 getPcOffWorkTime과 불일치 건 있음. 서버/DB 갱신 로직 점검 권장.\n");
    }
  } else {
    console.log("[3번] 임시연장 로그 검증 생략 (--logs=경로 지정 시 실행됨)\n");
  }

  printChecklist();

  const failed = !skipSimulator && simExit !== 0;
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
