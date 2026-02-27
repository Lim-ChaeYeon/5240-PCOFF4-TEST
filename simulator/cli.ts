#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runScenario, type ScenarioName } from "./scenarios.js";
import { REQUIRED_FLOWS, type FlowId, type ParitySummary } from "./parity.js";

const args = process.argv.slice(2);
const ALL_SCENARIOS: ScenarioName[] = [
  "login_success",
  "lock_reason_input",
  "update_success",
  "update_failure_retry",
  "password_change_confirm",
  "tamper_attempt",
  "offline_detected",
  "installer_registry_sync",
  "leave_seat_reason_required",
  "leave_seat_break_exempt",
  "leave_seat_unlock"
];

async function main(): Promise<void> {
  const command = args[0];
  if (command === "run") {
    const scenarioFlagIdx = args.lastIndexOf("--scenario");  // 중복 플래그 시 마지막 값 우선
    const scenario = (scenarioFlagIdx >= 0 ? args[scenarioFlagIdx + 1] : "update_success") as ScenarioName;
    const result = await runScenario(scenario);
    await report([result]);
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  }

  if (command === "run-all") {
    const results = await Promise.all(ALL_SCENARIOS.map(runScenario));
    await report(results);
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.every((it) => it.success) ? 0 : 1);
  }

  console.error("Usage: simulator <run|run-all> [--scenario name]");
  process.exit(1);
}

interface ReportPayload {
  summary: ParitySummary;
  results: Awaited<ReturnType<typeof runScenario>>[];
}

async function report(results: Awaited<ReturnType<typeof runScenario>>[]): Promise<void> {
  const summary = buildSummary(results);
  const payload: ReportPayload = { summary, results };
  const reportDir = join(process.cwd(), "artifacts");
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "parity-report.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  await writeFile(join(reportDir, "parity-summary.md"), toMarkdown(summary), "utf-8");
}

function buildSummary(results: Awaited<ReturnType<typeof runScenario>>[]): ParitySummary {
  const passed = results.filter((it) => it.success).length;
  const coveredSet = new Set(results.map((it) => it.flowId as FlowId));
  const coveredFlows = REQUIRED_FLOWS.filter((it) => coveredSet.has(it));
  const uncoveredFlows = REQUIRED_FLOWS.filter((it) => !coveredSet.has(it));
  return {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    requiredFlows: REQUIRED_FLOWS,
    coveredFlows,
    uncoveredFlows
  };
}

function toMarkdown(summary: ParitySummary): string {
  const coverageText = `${summary.coveredFlows.length}/${summary.requiredFlows.length}`;
  const uncovered = summary.uncoveredFlows.length > 0 ? summary.uncoveredFlows.join(", ") : "none";
  return [
    "# Parity Summary",
    "",
    `- Generated: ${summary.generatedAt}`,
    `- Result: ${summary.passed}/${summary.total} passed`,
    `- Flow Coverage: ${coverageText}`,
    `- Uncovered Flows: ${uncovered}`,
    ""
  ].join("\n");
}

void main();
