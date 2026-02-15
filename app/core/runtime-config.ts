import { join } from "node:path";
import { readJson, writeJson } from "./storage.js";
import { PATHS } from "./constants.js";

export interface RuntimeConfig {
  apiBaseUrl: string;
  userServareaId: string;
  userStaffId: string;
}

export interface AppState {
  userServareaId?: string;
  userStaffId?: string;
  loginUserId?: string;
  loginUserNm?: string;
  posNm?: string;
  corpNm?: string;
  lastLoginAt?: string;
}

/** 로그인된 사용자 표시용 정보 (state.json에서 읽음) */
export async function getLoginUserDisplay(baseDir: string): Promise<{
  loginUserNm?: string;
  loginUserId?: string;
  posNm?: string;
  corpNm?: string;
}> {
  const statePath = join(baseDir, PATHS.state);
  const state = await readJson<AppState>(statePath, {});
  return {
    loginUserNm: state.loginUserNm,
    loginUserId: state.loginUserId,
    posNm: state.posNm,
    corpNm: state.corpNm
  };
}

/** API 베이스 URL만 (로그인 화면에서 서비스영역/로그인 호출용) */
export async function getApiBaseUrl(baseDir: string): Promise<string | null> {
  const fromConfig = await readJson<{ apiBaseUrl?: string }>(join(baseDir, PATHS.config), {});
  return process.env.PCOFF_API_BASE_URL ?? fromConfig.apiBaseUrl ?? null;
}

/** state.json 우선, 없으면 config.json / env */
export async function loadRuntimeConfig(baseDir: string): Promise<RuntimeConfig | null> {
  const statePath = join(baseDir, PATHS.state);
  const configPath = join(baseDir, PATHS.config);
  const state = await readJson<AppState>(statePath, {});
  const fromConfig = await readJson<Partial<RuntimeConfig>>(configPath, {});

  const apiBaseUrl = process.env.PCOFF_API_BASE_URL ?? fromConfig.apiBaseUrl;
  const userServareaId = process.env.PCOFF_USER_SERVAREA_ID ?? state.userServareaId ?? fromConfig.userServareaId;
  const userStaffId = process.env.PCOFF_USER_STAFF_ID ?? state.userStaffId ?? fromConfig.userStaffId;

  if (!apiBaseUrl || !userServareaId || !userStaffId) return null;
  return { apiBaseUrl, userServareaId, userStaffId };
}

export async function saveLoginState(baseDir: string, state: AppState): Promise<void> {
  const statePath = join(baseDir, PATHS.state);
  const existing = await readJson<AppState>(statePath, {});
  await writeJson(statePath, { ...existing, ...state, lastLoginAt: new Date().toISOString() });
}

/** 로그아웃: state.json에서 로그인 관련 필드만 제거 */
export async function clearLoginState(baseDir: string): Promise<void> {
  const statePath = join(baseDir, PATHS.state);
  const existing = await readJson<AppState>(statePath, {});
  const { userServareaId, userStaffId, loginUserId, loginUserNm, posNm, corpNm, lastLoginAt, ...rest } = existing;
  await writeJson(statePath, rest);
}

