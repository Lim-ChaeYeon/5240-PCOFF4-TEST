#!/usr/bin/env node
/**
 * 추후 개발·점검 3번: 임시연장 서버 반영 여부 점검 보조
 * JSONL 로그에서 UNLOCK_TRIGGERED(pc_extend)와 getPcOffWorkTime_after_extend를 찾아
 * callPcOffTempDelay 응답과 직후 getPcOffWorkTime 응답의 pcExCount·pcOffYmdTime 일치 여부를 출력.
 *
 * 사용법:
 *   node scripts/check-temp-extend-reflect.mjs [로그파일경로 또는 logs폴더경로]
 *   경로 생략 시: process.cwd()/logs 중 최신 YYYY-MM-DD.json 사용
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const logsPath = args[0] || join(process.cwd(), "logs");

async function findLogFile(path) {
  const s = await stat(path).catch(() => null);
  if (!s) return null;
  if (s.isFile()) return path;
  if (s.isDirectory()) {
    const files = await readdir(path);
    const jsonFiles = files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
    if (jsonFiles.length === 0) return null;
    return join(path, jsonFiles[0]);
  }
  return null;
}

function parseLine(line) {
  line = line.trim();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function main() {
  const logFile = await findLogFile(logsPath);
  if (!logFile) {
    console.error("로그 파일을 찾을 수 없습니다:", logsPath);
    process.exit(1);
  }

  const content = await readFile(logFile, "utf-8");
  const lines = content.split("\n");
  const entries = lines.map(parseLine).filter(Boolean);
  const unlockEntries = entries.filter((e) => e.logCode === "UNLOCK_TRIGGERED" && e.payload);

  const extendEntries = unlockEntries.filter((e) => e.payload?.action === "pc_extend");
  const afterExtendEntries = unlockEntries.filter((e) => e.payload?.action === "getPcOffWorkTime_after_extend");

  if (extendEntries.length === 0) {
    console.log("임시연장(pc_extend) UNLOCK_TRIGGERED 로그가 없습니다. 앱에서 임시연장 실행 후 다시 확인하세요.");
    process.exit(0);
  }

  console.log("파일:", logFile);
  console.log("임시연장(pc_extend) 로그 수:", extendEntries.length);
  console.log("직후 getPcOffWorkTime 로그 수:", afterExtendEntries.length);
  console.log("");

  let matched = 0;
  let mismatched = 0;
  for (let i = 0; i < extendEntries.length; i++) {
    const ext = extendEntries[i];
    const resp = ext.payload?.callPcOffTempDelayResponse;
    const after = afterExtendEntries[i]?.payload;
    const extPcEx = resp != null ? resp.pcExCount : undefined;
    const extPcOff = resp != null ? resp.pcOffYmdTime : undefined;
    const afterPcEx = after?.pcExCount;
    const afterPcOff = after?.pcOffYmdTime;

    const pcExSame = extPcEx !== undefined && afterPcEx !== undefined && String(extPcEx) === String(afterPcEx);
    const pcOffSame = extPcOff !== undefined && afterPcOff !== undefined && String(extPcOff) === String(afterPcOff);
    const ok = pcExSame && pcOffSame;

    if (ok) matched++;
    else mismatched++;

    console.log(`[${i + 1}] ${ext.timestamp || ""}`);
    console.log("  callPcOffTempDelay 응답:", { pcExCount: extPcEx, pcOffYmdTime: extPcOff });
    console.log("  직후 getPcOffWorkTime:", { pcExCount: afterPcEx, pcOffYmdTime: afterPcOff });
    console.log("  일치:", ok ? "예 (서버 반영됨)" : "아니오 (서버 미반영 가능성)");
    console.log("");
  }

  console.log("요약: 일치", matched, "건, 불일치", mismatched, "건");
  process.exit(mismatched > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
