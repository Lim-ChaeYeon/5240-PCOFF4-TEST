export const APP_NAME = "5240 PcOff Agent";

export const PATHS = {
  config: "config.json",
  state: "state.json",
  logsDir: "logs",
  guardDir: "guard",
  integrity: "guard/integrity.json",
  updateDir: "update",
  retryQueue: "update/retry-queue.json"
} as const;

export const LOG_CODES = {
  APP_START: "APP_START",
  UPDATE_FOUND: "UPDATE_FOUND",
  UPDATE_DOWNLOADED: "UPDATE_DOWNLOADED",
  UPDATE_APPLIED: "UPDATE_APPLIED",
  UPDATE_FAILED: "UPDATE_FAILED",
  PASSWORD_CHANGE_DETECTED: "PASSWORD_CHANGE_DETECTED",
  PASSWORD_CONFIRM_DONE: "PASSWORD_CONFIRM_DONE",
  AGENT_TAMPER_DETECTED: "AGENT_TAMPER_DETECTED",
  AGENT_RECOVERED: "AGENT_RECOVERED",
  OFFLINE_DETECTED: "OFFLINE_DETECTED"
} as const;
