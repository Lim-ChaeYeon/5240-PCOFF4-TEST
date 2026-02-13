import { randomUUID } from "node:crypto";
import type { AppStateName, AppStateSnapshot } from "./types.js";

export type StateEvent =
  | { type: "LOGIN_REQUIRED" }
  | { type: "LOGIN_SUCCESS" }
  | { type: "LOCK"; reason?: string }
  | { type: "UNLOCK" }
  | { type: "START_TIMER" }
  | { type: "ALERT" }
  | { type: "UPDATE_PENDING" }
  | { type: "UPDATE_APPLYING" }
  | { type: "ERROR"; reason: string };

export class FeatureStateMachine {
  private readonly sessionId = randomUUID();
  private current: AppStateSnapshot = {
    state: "INIT",
    updatedAt: new Date().toISOString()
  };

  getSnapshot(): AppStateSnapshot {
    return this.current;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  transition(event: StateEvent): AppStateSnapshot {
    const nextState = this.reduce(this.current.state, event);
    this.current = {
      state: nextState,
      reason: "reason" in event ? event.reason : undefined,
      updatedAt: new Date().toISOString()
    };
    return this.current;
  }

  private reduce(current: AppStateName, event: StateEvent): AppStateName {
    switch (event.type) {
      case "LOGIN_REQUIRED": return "LOGIN_REQUIRED";
      case "LOGIN_SUCCESS": return "AUTHENTICATED";
      case "LOCK": return "LOCKED";
      case "UNLOCK": return "AUTHENTICATED";
      case "START_TIMER": return "TIMER_RUNNING";
      case "ALERT": return "ALERTING";
      case "UPDATE_PENDING": return "UPDATE_PENDING";
      case "UPDATE_APPLYING": return "UPDATE_APPLYING";
      case "ERROR": return "ERROR_STATE";
      default: return current;
    }
  }
}
