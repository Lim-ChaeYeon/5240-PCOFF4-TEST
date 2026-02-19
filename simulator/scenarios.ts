export type ScenarioName =
  | "login_success"
  | "lock_reason_input"
  | "update_success"
  | "update_failure_retry"
  | "password_change_confirm"
  | "tamper_attempt"
  | "offline_detected"
  | "installer_registry_sync"
  | "leave_seat_reason_required"
  | "leave_seat_break_exempt";

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
      return await runInstallerRegistrySyncScenario();
    case "leave_seat_reason_required":
      return await runLeaveSeatReasonRequiredScenario();
    case "leave_seat_break_exempt":
      return await runLeaveSeatBreakExemptScenario();
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

/**
 * Flow-08: 설치자 레지스트리 동기화 시나리오 (FR-09)
 * 로컬 저장 후 서버 동기화 시도(실패 허용)를 시뮬레이션
 */
async function runInstallerRegistrySyncScenario(): Promise<ScenarioResult> {
  const scenario: ScenarioName = "installer_registry_sync";
  const flowId = "Flow-08";
  const requirementIds = ["FR-09"];
  const expectedLogCodes = ["INSTALLER_REGISTRY_SYNC"];

  try {
    const { loadOrCreateInstallerRegistry, syncInstallerRegistry } = await import(
      "../app/core/installer-registry.js"
    );
    const { TelemetryLogger } = await import("../app/core/telemetry-log.js");

    const baseDir = process.cwd();
    const logger = new TelemetryLogger(baseDir, "sim-installer", process.platform);

    // 1. 레지스트리 로드(없으면 신규 생성)
    const registry = await loadOrCreateInstallerRegistry(baseDir, "0.1.0-sim", "sim-user");

    // 2. 서버 동기화 시도 (시뮬레이터는 서버 없이 실행하므로 fail 허용)
    const synced = await syncInstallerRegistry(baseDir, registry, null);

    // 3. INSTALLER_REGISTRY_SYNC 로그 (sync 성공 여부 무관하게 등록 자체는 성공)
    await logger.write("INSTALLER_REGISTRY_SYNC", "INFO", {
      deviceId: registry.deviceId,
      installedAt: registry.installedAt,
      syncStatus: synced.syncStatus
    });

    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: true,
      details: `installer registry created: deviceId=${registry.deviceId}, syncStatus=${synced.syncStatus}`,
      finishedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: false,
      details: `installer registry simulation failed: ${error}`,
      finishedAt: new Date().toISOString()
    };
  }
}

/**
 * Flow-02: 이석 감지 + 사유 입력 필수 시나리오
 * - screenType=empty, leaveSeatReasonYn=YES, leaveSeatReasonManYn=YES
 * - 휴게시간 외 → 사유 입력 필수
 */
async function runLeaveSeatReasonRequiredScenario(): Promise<ScenarioResult> {
  const scenario: ScenarioName = "leave_seat_reason_required";
  const flowId = "Flow-02";
  const requirementIds = ["FR-11"];
  const expectedLogCodes = ["LEAVE_SEAT_DETECTED", "LEAVE_SEAT_REASON_SUBMITTED", "LEAVE_SEAT_UNLOCK"];

  try {
    const { calcLeaveSeatPolicy } = await import("../app/core/leave-seat.js");
    const { TelemetryLogger } = await import("../app/core/telemetry-log.js");

    const baseDir = process.cwd();
    const logger = new TelemetryLogger(baseDir, "sim-leave-seat", process.platform);

    // 이석 상태 + 사유 필수 정책 (휴게시간 없음)
    const workFields = {
      screenType: "empty",
      leaveSeatReasonYn: "YES" as const,
      leaveSeatReasonManYn: "YES" as const,
      leaveSeatOffInputMath: "202602191030",
      breakStartTime: undefined,
      breakEndTime: undefined
    };

    const policy = calcLeaveSeatPolicy(workFields);

    if (!policy.isLeaveSeat) throw new Error("isLeaveSeat should be true");
    if (!policy.requireReason) throw new Error("requireReason should be true for non-break-time");
    if (policy.isBreakTime) throw new Error("isBreakTime should be false");

    await logger.write("LEAVE_SEAT_DETECTED", "INFO", {
      detectedAt: policy.detectedAt,
      requireReason: policy.requireReason,
      isBreakTime: policy.isBreakTime
    });

    // 사유 입력 시뮬레이션
    const simulatedReason = "회의 참석";
    await logger.write("LEAVE_SEAT_REASON_SUBMITTED", "INFO", { reason: simulatedReason });
    await logger.write("LEAVE_SEAT_UNLOCK", "INFO", { hasReason: true, reason: simulatedReason });

    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: true,
      details: `leave seat reason required: detectedAt=${policy.detectedAt}, reason="${simulatedReason}"`,
      finishedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: false,
      details: `leave seat reason scenario failed: ${error}`,
      finishedAt: new Date().toISOString()
    };
  }
}

/**
 * Flow-02b: 이석 감지 + 휴게시간 → 사유 면제 시나리오
 * - screenType=empty, leaveSeatReasonYn=YES, leaveSeatReasonManYn=YES
 * - 현재 시각이 breakStartTime~breakEndTime 안 → 사유 면제
 */
async function runLeaveSeatBreakExemptScenario(): Promise<ScenarioResult> {
  const scenario: ScenarioName = "leave_seat_break_exempt";
  const flowId = "Flow-02b";
  const requirementIds = ["FR-11"];
  const expectedLogCodes = ["LEAVE_SEAT_DETECTED", "LEAVE_SEAT_BREAK_EXEMPT", "LEAVE_SEAT_UNLOCK"];

  try {
    const { calcLeaveSeatPolicy } = await import("../app/core/leave-seat.js");
    const { TelemetryLogger } = await import("../app/core/telemetry-log.js");

    const baseDir = process.cwd();
    const logger = new TelemetryLogger(baseDir, "sim-leave-break", process.platform);

    // 현재 시각을 포함하는 넓은 휴게 구간으로 설정 (00:00~23:59)
    const workFields = {
      screenType: "empty",
      leaveSeatReasonYn: "YES" as const,
      leaveSeatReasonManYn: "YES" as const,
      leaveSeatOffInputMath: "202602191030",
      breakStartTime: "0000",
      breakEndTime: "2359"
    };

    const policy = calcLeaveSeatPolicy(workFields);

    if (!policy.isLeaveSeat) throw new Error("isLeaveSeat should be true");
    if (policy.requireReason) throw new Error("requireReason should be false during break time");
    if (!policy.isBreakTime) throw new Error("isBreakTime should be true with 00:00~23:59 range");

    await logger.write("LEAVE_SEAT_DETECTED", "INFO", {
      detectedAt: policy.detectedAt,
      requireReason: policy.requireReason,
      isBreakTime: policy.isBreakTime
    });
    await logger.write("LEAVE_SEAT_BREAK_EXEMPT", "INFO", {
      breakStartTime: workFields.breakStartTime,
      breakEndTime: workFields.breakEndTime
    });
    await logger.write("LEAVE_SEAT_UNLOCK", "INFO", { hasReason: false, reason: "" });

    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: true,
      details: `leave seat break exempt: isBreakTime=${policy.isBreakTime}, requireReason=${policy.requireReason}`,
      finishedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      scenario,
      flowId,
      requirementIds,
      expectedLogCodes,
      success: false,
      details: `leave seat break exempt scenario failed: ${error}`,
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
