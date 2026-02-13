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
      return ok(
        name,
        "Flow-06",
        ["FR-07"],
        ["AGENT_TAMPER_DETECTED", "AGENT_RECOVERED"],
        "tamper detection trigger simulated"
      );
    case "offline_detected":
      return ok(name, "Flow-07", ["FR-08"], ["CRASH_DETECTED", "OFFLINE_DETECTED"], "offline/crash flow simulated");
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
