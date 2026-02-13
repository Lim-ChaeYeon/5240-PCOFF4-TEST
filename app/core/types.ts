export type AppStateName =
  | "INIT"
  | "LOGIN_REQUIRED"
  | "AUTHENTICATED"
  | "LOCKED"
  | "UNLOCK_PENDING_REASON"
  | "TIMER_RUNNING"
  | "ALERTING"
  | "UPDATE_PENDING"
  | "UPDATE_APPLYING"
  | "ERROR_STATE";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface AppStateSnapshot {
  state: AppStateName;
  reason?: string;
  updatedAt: string;
}

export interface LogEntry {
  timestamp: string;
  logCode: string;
  level: LogLevel;
  sessionId: string;
  deviceId: string;
  userId?: string;
  payload: Record<string, unknown>;
}
