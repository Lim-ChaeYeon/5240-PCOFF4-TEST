import { createHash } from "node:crypto";
import { readFile, access, constants, stat, watch } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync, FSWatcher } from "node:fs";
import { LOG_CODES, PATHS } from "./constants.js";
import { readJson, writeJson } from "./storage.js";
import { TelemetryLogger } from "./telemetry-log.js";

/**
 * 무결성 상태 저장 구조
 */
interface IntegrityState {
  files: Record<string, FileHashInfo>;
  capturedAt: string;
  platform: NodeJS.Platform;
}

interface FileHashInfo {
  hash: string;
  size: number;
  mtime: string;
}

/**
 * 감시 대상 파일 목록
 */
interface WatchList {
  critical: string[];    // 필수 파일 (삭제/변경 시 즉시 복구)
  monitored: string[];   // 모니터링 파일 (변경 시 로그)
}

/**
 * 탐지 이벤트 타입
 */
export type TamperEventType = 
  | "file_deleted"
  | "file_modified"
  | "hash_mismatch"
  | "permission_changed"
  | "process_kill_attempt";

/**
 * 탐지 결과
 */
export interface TamperEvent {
  type: TamperEventType;
  filePath?: string;
  originalHash?: string;
  currentHash?: string;
  detectedAt: string;
  recovered: boolean;
  recoveryStrategy?: string;
}

/**
 * Guard 상태
 */
export interface GuardStatus {
  active: boolean;
  lastCheck: string | null;
  tamperEvents: TamperEvent[];
  protectedFiles: number;
  platform: NodeJS.Platform;
}

/**
 * Agent Guard - 삭제/우회 탐지 및 자동 복구
 * 
 * FR-07: 삭제/우회 탐지, 무결성 체크, 자동 복구 트리거
 * - Windows: 서비스·ACL·Watchdog (stub - 실제 구현은 native 모듈 필요)
 * - macOS: LaunchDaemon·code signing (stub - 실제 구현은 native 모듈 필요)
 * - 공통: 바이너리·중요 파일 모니터링, 탐지 시 로그·복구
 */
export class AgentGuard {
  private status: GuardStatus;
  private fileWatchers: Map<string, FSWatcher> = new Map();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private readonly platform: NodeJS.Platform;

  constructor(
    private readonly baseDir: string,
    private readonly logger: TelemetryLogger
  ) {
    this.platform = process.platform;
    this.status = {
      active: false,
      lastCheck: null,
      tamperEvents: [],
      protectedFiles: 0,
      platform: this.platform
    };
  }

  /**
   * Guard 시작 - 파일 감시 및 주기적 무결성 체크 시작
   */
  async start(checkIntervalMs = 30_000): Promise<void> {
    if (this.status.active) return;

    // 초기 무결성 캡처 (없으면 생성)
    const integrityPath = join(this.baseDir, PATHS.integrity);
    if (!existsSync(integrityPath)) {
      await this.captureBaseline();
    }

    // 감시 대상 파일 로드
    const watchList = await this.getWatchList();
    const allFiles = [...watchList.critical, ...watchList.monitored];

    // 파일 시스템 감시 시작
    for (const filePath of allFiles) {
      await this.watchFile(filePath);
    }

    // 주기적 무결성 체크
    this.checkInterval = setInterval(async () => {
      await this.verifyIntegrity();
    }, checkIntervalMs);

    this.status.active = true;
    this.status.protectedFiles = allFiles.length;

    await this.logger.write(LOG_CODES.APP_START, "INFO", {
      guard: "started",
      protectedFiles: allFiles.length,
      platform: this.platform
    });
  }

  /**
   * Guard 중지
   */
  async stop(): Promise<void> {
    if (!this.status.active) return;

    // 파일 감시 중지
    for (const [, watcher] of this.fileWatchers) {
      watcher.close();
    }
    this.fileWatchers.clear();

    // 주기적 체크 중지
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.status.active = false;
  }

  /**
   * 기준선 무결성 캡처
   */
  async captureBaseline(): Promise<void> {
    const watchList = await this.getWatchList();
    const allFiles = [...watchList.critical, ...watchList.monitored];
    
    const files: Record<string, FileHashInfo> = {};
    
    for (const filePath of allFiles) {
      try {
        const info = await this.getFileInfo(filePath);
        if (info) {
          files[filePath] = info;
        }
      } catch {
        // 파일이 없으면 스킵
      }
    }

    const state: IntegrityState = {
      files,
      capturedAt: new Date().toISOString(),
      platform: this.platform
    };

    await writeJson(join(this.baseDir, PATHS.integrity), state);
  }

  /**
   * 수동 무결성 캡처 (외부 호출용)
   */
  async capture(filePaths: string[]): Promise<void> {
    const files: Record<string, FileHashInfo> = {};
    
    for (const filePath of filePaths) {
      try {
        const info = await this.getFileInfo(filePath);
        if (info) {
          files[filePath] = info;
        }
      } catch {
        // 파일이 없으면 스킵
      }
    }

    const state: IntegrityState = {
      files,
      capturedAt: new Date().toISOString(),
      platform: this.platform
    };

    await writeJson(join(this.baseDir, PATHS.integrity), state);
  }

  /**
   * 전체 무결성 검증
   */
  async verifyIntegrity(): Promise<boolean> {
    const integrityPath = join(this.baseDir, PATHS.integrity);
    const state = await readJson<IntegrityState>(integrityPath, {
      files: {},
      capturedAt: "",
      platform: this.platform
    });

    this.status.lastCheck = new Date().toISOString();
    let allValid = true;

    for (const [filePath, expectedInfo] of Object.entries(state.files)) {
      const result = await this.verifyFile(filePath, expectedInfo);
      if (!result.valid) {
        allValid = false;
        await this.handleTamperEvent(result.event!);
      }
    }

    return allValid;
  }

  /**
   * 수동 검증 (외부 호출용 - 기존 API 호환)
   */
  async verify(filePaths: string[]): Promise<boolean> {
    const integrityPath = join(this.baseDir, PATHS.integrity);
    const state = await readJson<IntegrityState>(integrityPath, {
      files: {},
      capturedAt: "",
      platform: this.platform
    });

    for (const filePath of filePaths) {
      const expectedInfo = state.files[filePath];
      if (!expectedInfo) continue;

      const currentInfo = await this.getFileInfo(filePath);
      if (!currentInfo) {
        // 파일 삭제됨
        await this.logger.write(LOG_CODES.AGENT_TAMPER_DETECTED, "ERROR", { 
          filePath,
          type: "file_deleted"
        });
        await this.logger.write(LOG_CODES.AGENT_RECOVERED, "WARN", { 
          filePath, 
          strategy: "trigger_only" 
        });
        return false;
      }

      if (expectedInfo.hash !== currentInfo.hash) {
        // 해시 불일치
        await this.logger.write(LOG_CODES.AGENT_TAMPER_DETECTED, "ERROR", { filePath });
        await this.logger.write(LOG_CODES.AGENT_RECOVERED, "WARN", { 
          filePath, 
          strategy: "trigger_only" 
        });
        return false;
      }
    }

    return true;
  }

  /**
   * 개별 파일 검증
   */
  private async verifyFile(
    filePath: string,
    expected: FileHashInfo
  ): Promise<{ valid: boolean; event?: TamperEvent }> {
    try {
      // 파일 존재 여부 확인
      await access(filePath, constants.F_OK);
    } catch {
      // 파일 삭제됨
      return {
        valid: false,
        event: {
          type: "file_deleted",
          filePath,
          originalHash: expected.hash,
          detectedAt: new Date().toISOString(),
          recovered: false
        }
      };
    }

    try {
      const current = await this.getFileInfo(filePath);
      if (!current) {
        return {
          valid: false,
          event: {
            type: "file_deleted",
            filePath,
            originalHash: expected.hash,
            detectedAt: new Date().toISOString(),
            recovered: false
          }
        };
      }

      if (expected.hash !== current.hash) {
        return {
          valid: false,
          event: {
            type: "hash_mismatch",
            filePath,
            originalHash: expected.hash,
            currentHash: current.hash,
            detectedAt: new Date().toISOString(),
            recovered: false
          }
        };
      }

      return { valid: true };
    } catch {
      return {
        valid: false,
        event: {
          type: "file_modified",
          filePath,
          detectedAt: new Date().toISOString(),
          recovered: false
        }
      };
    }
  }

  /**
   * 탐지 이벤트 처리
   */
  private async handleTamperEvent(event: TamperEvent): Promise<void> {
    // 이벤트 기록
    this.status.tamperEvents.push(event);

    // 로그 기록
    await this.logger.write(LOG_CODES.AGENT_TAMPER_DETECTED, "ERROR", {
      type: event.type,
      filePath: event.filePath,
      originalHash: event.originalHash,
      currentHash: event.currentHash
    });

    // 복구 시도
    const recovered = await this.attemptRecovery(event);
    event.recovered = recovered;

    if (recovered) {
      await this.logger.write(LOG_CODES.AGENT_RECOVERED, "INFO", {
        filePath: event.filePath,
        strategy: event.recoveryStrategy
      });
    } else {
      await this.logger.write(LOG_CODES.AGENT_RECOVERY_FAILED, "ERROR", {
        filePath: event.filePath,
        type: event.type
      });
    }
  }

  /**
   * 복구 시도
   * 
   * 실제 복구는 플랫폼별 native 모듈이 필요하지만,
   * 여기서는 복구 트리거 및 로깅을 수행
   */
  private async attemptRecovery(event: TamperEvent): Promise<boolean> {
    // 복구 전략 결정
    let strategy: string;

    switch (event.type) {
      case "file_deleted":
        // 삭제된 파일 복구 - 실제로는 백업에서 복원 필요
        strategy = "restore_from_backup";
        break;
      case "hash_mismatch":
      case "file_modified":
        // 변경된 파일 복구 - 실제로는 원본으로 교체 필요
        strategy = "restore_original";
        break;
      case "permission_changed":
        // 권한 복구
        strategy = "restore_permissions";
        break;
      case "process_kill_attempt":
        // 프로세스 재시작
        strategy = "restart_process";
        break;
      default:
        strategy = "manual_intervention";
    }

    event.recoveryStrategy = strategy;

    // 실제 복구 로직은 플랫폼별로 다름
    // Windows: 서비스 재시작, ACL 복원
    // macOS: LaunchDaemon 재시작
    // 현재는 로깅만 수행 (실제 복구는 native 모듈 필요)

    if (this.platform === "win32") {
      return this.recoverWindows(event);
    } else if (this.platform === "darwin") {
      return this.recoverMacOS(event);
    }

    return false;
  }

  /**
   * Windows 복구 로직 (stub)
   */
  private async recoverWindows(event: TamperEvent): Promise<boolean> {
    // TODO: 실제 구현 시
    // - 서비스 재시작: sc start pcoff-agent
    // - ACL 복원: icacls 명령
    // - 레지스트리 복원
    
    await this.logger.write(LOG_CODES.AGENT_RECOVERED, "WARN", {
      platform: "win32",
      strategy: event.recoveryStrategy,
      note: "recovery_triggered"
    });

    // stub에서는 트리거만 기록
    return true;
  }

  /**
   * macOS 복구 로직 (stub)
   */
  private async recoverMacOS(event: TamperEvent): Promise<boolean> {
    // TODO: 실제 구현 시
    // - LaunchDaemon 재시작: launchctl load/unload
    // - 권한 복원: chmod/chown
    // - 코드 서명 검증: codesign --verify
    
    await this.logger.write(LOG_CODES.AGENT_RECOVERED, "WARN", {
      platform: "darwin",
      strategy: event.recoveryStrategy,
      note: "recovery_triggered"
    });

    // stub에서는 트리거만 기록
    return true;
  }

  /**
   * 파일 감시 시작
   */
  private async watchFile(filePath: string): Promise<void> {
    if (this.fileWatchers.has(filePath)) return;
    if (!existsSync(filePath)) return;

    try {
      const controller = new AbortController();
      const watcher = watch(filePath, { signal: controller.signal });

      // FSWatcher를 반환받기 위해 async iterator 대신 직접 구현
      // Node.js fs.watch는 callback 기반이므로 fs/promises의 watch와 다름
      // 여기서는 간단히 존재 여부만 체크하는 폴링 방식 사용
      
      // 주의: fs/promises의 watch는 AsyncIterable을 반환하므로
      // 실제 watcher 객체를 저장하는 대신 controller를 저장
      const pseudoWatcher = {
        close: () => controller.abort()
      } as FSWatcher;

      this.fileWatchers.set(filePath, pseudoWatcher);

      // 파일 변경 감지 (async iterator)
      (async () => {
        try {
          for await (const event of watcher) {
            if (event.eventType === "rename") {
              // 파일 삭제/이동 가능성
              await this.handleTamperEvent({
                type: "file_deleted",
                filePath,
                detectedAt: new Date().toISOString(),
                recovered: false
              });
            } else if (event.eventType === "change") {
              // 파일 변경
              await this.handleTamperEvent({
                type: "file_modified",
                filePath,
                detectedAt: new Date().toISOString(),
                recovered: false
              });
            }
          }
        } catch (err: unknown) {
          // AbortError는 정상 종료
          if (err instanceof Error && err.name !== "AbortError") {
            console.warn(`[AgentGuard] Watch error for ${filePath}:`, err);
          }
        }
      })();
    } catch {
      // 파일 감시 실패 무시
    }
  }

  /**
   * 감시 대상 파일 목록 가져오기
   */
  private async getWatchList(): Promise<WatchList> {
    const watchListPath = join(this.baseDir, PATHS.watchList);
    
    // 기본 감시 대상 (앱 핵심 파일)
    const defaultList: WatchList = {
      critical: [
        join(this.baseDir, "dist/app/main/index.js"),
        join(this.baseDir, "dist/app/preload/index.js"),
        join(this.baseDir, "package.json")
      ],
      monitored: [
        join(this.baseDir, PATHS.config),
        join(this.baseDir, PATHS.state),
        join(this.baseDir, PATHS.integrity)
      ]
    };

    // 저장된 목록이 있으면 병합
    const savedList = await readJson<WatchList>(watchListPath, defaultList);
    
    return {
      critical: [...new Set([...defaultList.critical, ...savedList.critical])],
      monitored: [...new Set([...defaultList.monitored, ...savedList.monitored])]
    };
  }

  /**
   * 파일 정보 가져오기 (해시, 크기, 수정시간)
   */
  private async getFileInfo(filePath: string): Promise<FileHashInfo | null> {
    try {
      const [content, stats] = await Promise.all([
        readFile(filePath),
        stat(filePath)
      ]);

      return {
        hash: createHash("sha256").update(content).digest("hex"),
        size: stats.size,
        mtime: stats.mtime.toISOString()
      };
    } catch {
      return null;
    }
  }

  /**
   * 현재 Guard 상태 반환
   */
  getStatus(): GuardStatus {
    return { ...this.status };
  }

  /**
   * 탐지 이벤트 히스토리 반환
   */
  getTamperEvents(): TamperEvent[] {
    return [...this.status.tamperEvents];
  }

  /**
   * 프로세스 Kill 시도 감지 (외부에서 호출)
   */
  async onProcessKillAttempt(pid: number, source: string): Promise<void> {
    const event: TamperEvent = {
      type: "process_kill_attempt",
      detectedAt: new Date().toISOString(),
      recovered: false
    };

    await this.logger.write(LOG_CODES.AGENT_STOP_ATTEMPT, "ERROR", {
      pid,
      source,
      detectedAt: event.detectedAt
    });

    this.status.tamperEvents.push(event);
  }
}
