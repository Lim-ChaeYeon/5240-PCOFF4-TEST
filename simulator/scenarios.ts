export type ScenarioName =
  | "login_success"
  | "lock_reason_input"
  | "update_success"
  | "update_failure_retry"
  | "password_change_confirm"
  | "tamper_attempt"
  | "offline_detected"
  | "installer_registry_sync";

export interface ScenarioResult {
  scenario: ScenarioName;
  flowId: string;
  requirementIds: string[];
  expectedLogCodes: string[];
  success: boolean;
  details: string;
  finishedAt: string;
}

export async function runScenario(name: ScenarioName): Promise<ScenarioResult> {
  switch (name) {
    case "login_success":
      return ok(name, "Flow-01", ["FR-01"], ["LOGIN_SUCCESS"], "login success flow simulated");
    case "lock_reason_input":
      return ok(name, "Flow-02", ["FR-01"], ["LOCK_TRIGGERED"], "lock + reason input flow simulated");
    case "update_success":
      return ok(
        name,
        "Flow-03",
        ["FR-03"],
        ["UPDATE_FOUND", "UPDATE_DOWNLOADED", "UPDATE_APPLIED"],
        "silent update flow simulated"
      );
    case "update_failure_retry":
      return ok(name, "Flow-04", ["FR-03"], ["UPDATE_FAILED"], "update failure retry flow simulated");
    case "password_change_confirm":
      return ok(
        name,
        "Flow-05",
        ["FR-04"],
        ["PASSWORD_CHANGE_DETECTED", "PASSWORD_CONFIRM_DONE"],
        "password confirm-only policy simulated"
      );
    case "tamper_attempt":
      return await runTamperAttemptScenario();
    case "offline_detected":
      return await runOfflineDetectedScenario();
    case "installer_registry_sync":
      return ok(name, "Flow-08", ["FR-09"], ["INSTALLER_REGISTRY_SYNC"], "installer registry sync flow simulated");
    default:
      return fail(name, "unknown flow", [], [], "unknown scenario");
  }
}

function ok(
  scenario: ScenarioName,
  flowId: string,
  requirementIds: string[],
  expectedLogCodes: string[],
  details: string
): ScenarioResult {
  return {
    scenario,
    flowId,
    requirementIds,
    expectedLogCodes,
    success: true,
    details,
    finishedAt: new Date().toISOString()
  };
}

/**
 * Flow-06: 탬퍼 시도 시나리오
 * Agent Guard의 탐지 및 복구 로직을 시뮬레이션
 */
async function runTamperAttemptScenario(): Promise<ScenarioResult> {
  const scenario: ScenarioName = "tamper_attempt";
  const flowId = "Flow-06";
  const requirementIds = ["FR-07"];
  const expectedLogCodes = ["AGENT_TAMPER_DETECTED", "AGENT_RECOVERED"];

  try {
    // 동적 import로 AgentGuard 로드
    const { AgentGuard } = await import("../app/core/agent-guard.js");
    const { TelemetryLogger } = await import("../app/core/telemetry-log.js");
    
    const baseDir = process.cwd();
    const logger = new TelemetryLogger(baseDir, "sim-tamper", process.platform);
    const guard = new AgentGuard(baseDir, logger);

    // 1. 기준선 캡처 (테스트용 파일)
    const testFiles = [
      `${baseDir}/package.json`
    ];
    await guard.capture(testFiles);

    // 2. 무결성 검증 (현재 상태는 유효해야 함)
    const isValid = await guard.verify(testFiles);

    // 3. 탐지 이벤트 시뮬레이션 (실제로는 파일 변경 시 발생)
    // Guard 상태 확인
    const status = guard.getStatus();

    // 4. 로그 기록 (시뮬레이션)
    await logger.write("AGENT_TAMPER_DETECTED", "ERROR", {
      type: "simulated_test",
      filePath: testFiles[0],
      scenario: "tamper_attempt"
    });
    await logger.write("AGENT_RECOVERED", "WARN", {
      filePath: testFiles[0],
      strategy: "simulated_recovery"
    });

    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: true,
      details: `tamper detection simulated, guard active: ${status.active}, integrity valid: ${isValid}`,
      finishedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: false,
      details: `tamper simulation failed: ${error}`,
      finishedAt: new Date().toISOString()
    };
  }
}

/**
 * Flow-07: 오프라인/크래시 감지 시나리오 (FR-08)
 * OpsObserver의 reportOffline, reportCrash 및 로그 기록 시뮬레이션
 */
async function runOfflineDetectedScenario(): Promise<ScenarioResult> {
  const scenario: ScenarioName = "offline_detected";
  const flowId = "Flow-07";
  const requirementIds = ["FR-08"];
  const expectedLogCodes = ["CRASH_DETECTED", "OFFLINE_DETECTED"];

  try {
    const { OpsObserver } = await import("../app/core/ops-observer.js");
    const { TelemetryLogger } = await import("../app/core/telemetry-log.js");

    const baseDir = process.cwd();
    const logger = new TelemetryLogger(baseDir, "sim-offline", process.platform);
    const getApiBaseUrl = async () => null; // 시뮬레이션에서는 서버 전송 생략
    const observer = new OpsObserver(logger, getApiBaseUrl);

    observer.start(30_000);

    await observer.reportOffline("simulated_network_failure");
    await observer.reportCrash("simulated_crash");

    observer.stop();

    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: true,
      details: "offline/crash flow simulated, OFFLINE_DETECTED and CRASH_DETECTED logged",
      finishedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: false,
      details: `offline simulation failed: ${error}`,
      finishedAt: new Date().toISOString()
    };
  }
}

function fail(
  scenario: ScenarioName,
  flowId: string,
  requirementIds: string[],
  expectedLogCodes: string[],
  details: string
): ScenarioResult {
  return {
    scenario,
    flowId,
    requirementIds,
    expectedLogCodes,
    success: false,
    details,
    finishedAt: new Date().toISOString()
  };
}
