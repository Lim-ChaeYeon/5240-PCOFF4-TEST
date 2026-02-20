/**
 * main-info.js
 * 트레이에서 열리는 에이전트 작동정보 조회 전용 화면
 * 액션 버튼 없이 정보 조회만 수행
 */

const userDisplayEl = document.getElementById("user-display");
const appVersionEl = document.getElementById("app-version");
const currentModeEl = document.getElementById("current-mode");
const modeTextEl = document.getElementById("mode-text");
const reflectedTimeEl = document.getElementById("reflected-time");
const appliedPolicyEl = document.getElementById("applied-policy");
const pcOnStatusEl = document.getElementById("pc-on-status");
const workStartEl = document.getElementById("work-start");
const workEndEl = document.getElementById("work-end");
const refreshAttendanceEl = document.getElementById("refresh-attendance");
const attendanceErrorEl = document.getElementById("attendance-error");
const extendCountEl = document.getElementById("extend-count");
const extendMaxEl = document.getElementById("extend-max");
const extendTimeEl = document.getElementById("extend-time");
const emergencyStatusEl = document.getElementById("emergency-status");
const versionAppEl = document.getElementById("version-app");
const versionUpdatedEl = document.getElementById("version-updated");
const versionSummaryEl = document.getElementById("version-summary");
const versionDetailEl = document.getElementById("version-detail");
const versionToggleEl = document.getElementById("version-toggle");
const checkUpdateEl = document.getElementById("check-update");
const dateTextEl = document.getElementById("date-text");
const timeTextEl = document.getElementById("time-text");
const toastEl = document.getElementById("toast");

const MODE_CONFIG = {
  NORMAL: { text: "일반", className: "normal" },
  TEMP_EXTEND: { text: "임시연장", className: "temp-extend" },
  EMERGENCY_USE: { text: "긴급사용", className: "emergency-use" },
  EMERGENCY_RELEASE: { text: "긴급해제", className: "emergency-release" }
};

function showToast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1400);
}

/** 업데이트 확인 결과에 따라 버튼 텍스트·토스트 표시 */
function updateCheckButton(status) {
  if (!checkUpdateEl) return;
  const s = status?.state ?? "idle";
  switch (s) {
    case "checking":
      checkUpdateEl.textContent = "확인 중...";
      checkUpdateEl.disabled = true;
      break;
    case "available":
      checkUpdateEl.textContent = `v${status?.version ?? "?"} 다운로드 중`;
      checkUpdateEl.disabled = true;
      break;
    case "downloading":
      checkUpdateEl.textContent = `다운로드 ${Math.round(status?.progress ?? 0)}%`;
      checkUpdateEl.disabled = true;
      break;
    case "downloaded":
      checkUpdateEl.textContent = "재시작 대기";
      checkUpdateEl.disabled = true;
      showToast("업데이트 다운로드 완료. 앱 종료 후 적용됩니다.");
      break;
    case "not-available":
      checkUpdateEl.textContent = "최신 버전";
      checkUpdateEl.disabled = false;
      showToast("현재 최신 버전입니다.");
      setTimeout(() => { checkUpdateEl.textContent = "업데이트 확인"; }, 3000);
      break;
    case "error":
      checkUpdateEl.textContent = "업데이트 오류";
      checkUpdateEl.disabled = false;
      showToast(status?.error || "업데이트 확인 실패");
      setTimeout(() => { checkUpdateEl.textContent = "업데이트 확인"; }, 3000);
      break;
    default:
      checkUpdateEl.textContent = "업데이트 확인";
      checkUpdateEl.disabled = false;
  }
}

function updateClock() {
  const now = new Date();
  const dateText = `${now.getFullYear()}년 ${String(now.getMonth() + 1).padStart(2, "0")}월 ${String(now.getDate()).padStart(2, "0")}일`;
  const timeText = now.toLocaleTimeString("ko-KR", { hour12: true });
  if (dateTextEl) dateTextEl.textContent = dateText;
  if (timeTextEl) timeTextEl.textContent = timeText;
}

function formatTime(ymdTime) {
  if (!ymdTime || ymdTime.length !== 12) return "--:--";
  return `${ymdTime.slice(8, 10)}:${ymdTime.slice(10, 12)}`;
}

function formatDateTime(isoString) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return isoString;
  }
}

function setMode(mode) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.NORMAL;
  if (currentModeEl) {
    currentModeEl.className = `mode-badge ${config.className}`;
  }
  if (modeTextEl) {
    modeTextEl.textContent = config.text;
  }
}

function updateReflectedInfo(data) {
  if (reflectedTimeEl) {
    reflectedTimeEl.textContent = `기준: ${new Date().toLocaleTimeString("ko-KR")}`;
  }
  if (appliedPolicyEl) {
    appliedPolicyEl.textContent = data.screenType || "일반";
  }
  if (pcOnStatusEl) {
    pcOnStatusEl.textContent = data.pcOnYn === "Y" ? "사용 중" : "잠금";
    pcOnStatusEl.style.color = data.pcOnYn === "Y" ? "var(--accent)" : "var(--danger)";
  }
  if (workStartEl) {
    workStartEl.textContent = formatTime(data.pcOnYmdTime);
  }
  if (workEndEl) {
    workEndEl.textContent = formatTime(data.pcOffYmdTime);
  }
}

function updateAttendanceInfo(data, hasError = false) {
  if (attendanceErrorEl) {
    attendanceErrorEl.classList.toggle("hidden", !hasError);
  }
  if (extendCountEl) {
    extendCountEl.textContent = String(data.pcExCount ?? 0);
  }
  if (extendMaxEl) {
    extendMaxEl.textContent = String(data.pcExMaxCount ?? 3);
  }
  if (extendTimeEl) {
    extendTimeEl.textContent = String(data.pcExTime ?? 30);
  }
  if (emergencyStatusEl) {
    const allowed = data.pcoffEmergencyYesNo === "YES";
    emergencyStatusEl.textContent = allowed ? "허용" : "미허용";
    emergencyStatusEl.style.color = allowed ? "var(--accent)" : "var(--muted)";
  }
}

async function loadUserInfo() {
  if (!window.pcoffApi?.getCurrentUser) return;
  try {
    const user = await window.pcoffApi.getCurrentUser();
    const parts = [];
    if (user.corpNm) parts.push(user.corpNm);
    if (user.loginUserNm) parts.push(user.loginUserNm);
    if (user.posNm) parts.push(user.posNm);
    if (userDisplayEl) {
      userDisplayEl.textContent = parts.length > 0 ? parts.join(" · ") : "";
      userDisplayEl.style.display = parts.length > 0 ? "" : "none";
    }
  } catch {
    if (userDisplayEl) userDisplayEl.style.display = "none";
  }
}

async function loadVersionInfo() {
  if (window.pcoffApi?.getAppVersion) {
    try {
      const ver = await window.pcoffApi.getAppVersion();
      const verText = `v${ver}`;
      if (versionAppEl) versionAppEl.textContent = verText;
      if (appVersionEl) appVersionEl.textContent = verText;
      if (versionSummaryEl) versionSummaryEl.textContent = verText;
    } catch {
      if (versionAppEl) versionAppEl.textContent = "-";
      if (versionSummaryEl) versionSummaryEl.textContent = "-";
    }
  }
  if (versionUpdatedEl) {
    versionUpdatedEl.textContent = formatDateTime(new Date().toISOString());
  }
}

async function loadTrayOperationInfo() {
  if (window.pcoffApi?.getTrayOperationInfo) {
    try {
      const info = await window.pcoffApi.getTrayOperationInfo();
      if (info) {
        setMode(info.mode || "NORMAL");
        if (info.reflectedAttendance) {
          if (reflectedTimeEl && info.reflectedAttendance.basedAt) {
            reflectedTimeEl.textContent = `기준: ${formatDateTime(info.reflectedAttendance.basedAt)}`;
          }
          if (appliedPolicyEl && info.reflectedAttendance.appliedPolicy) {
            appliedPolicyEl.textContent = info.reflectedAttendance.appliedPolicy;
          }
        }
        if (info.myAttendance) {
          updateAttendanceInfo(info.myAttendance);
          // 현재 반영 근태정보 섹션도 동일 데이터로 채움 (PC 사용 가능, 시업/종업 시간)
          updateReflectedInfo(info.myAttendance);
        }
        if (info.versionInfo) {
          const verText = `v${info.versionInfo.appVersion}`;
          if (versionAppEl) versionAppEl.textContent = verText;
          if (versionSummaryEl) versionSummaryEl.textContent = verText;
          if (versionUpdatedEl) versionUpdatedEl.textContent = formatDateTime(info.versionInfo.lastUpdatedAt);
        }
        return;
      }
    } catch (e) {
      console.warn("getTrayOperationInfo failed, fallback to getWorkTime:", e);
    }
  }

  // Fallback to getWorkTime
  await refreshAttendance();
}

async function refreshAttendance(options = {}) {
  const { silent = false } = options; // 초기 로드 시 토스트 생략
  if (refreshAttendanceEl) {
    refreshAttendanceEl.disabled = true;
    refreshAttendanceEl.textContent = "조회 중...";
  }

  try {
    if (window.pcoffApi?.refreshMyAttendance) {
      const data = await window.pcoffApi.refreshMyAttendance();
      updateReflectedInfo(data);
      updateAttendanceInfo(data);
    } else if (window.pcoffApi?.getWorkTime) {
      const response = await window.pcoffApi.getWorkTime();
      const data = response.data || {};
      updateReflectedInfo(data);
      updateAttendanceInfo(data, response.source === "fallback");
    }
    if (!silent) showToast("근태정보 갱신됨");
  } catch (e) {
    console.error("refreshAttendance error:", e);
    updateAttendanceInfo({}, true);
    if (!silent) showToast("근태정보 조회 실패");
  } finally {
    if (refreshAttendanceEl) {
      refreshAttendanceEl.disabled = false;
      refreshAttendanceEl.textContent = "새로고침";
    }
  }
}

function setupModeChangeListener() {
  if (!window.pcoffApi?.onModeChanged) return;
  window.pcoffApi.onModeChanged((data) => {
    setMode(data.mode);
    showToast(`모드 변경: ${MODE_CONFIG[data.mode]?.text || data.mode}`);
  });
}

async function init() {
  updateClock();
  setInterval(updateClock, 1000);

  await loadUserInfo();
  await loadVersionInfo();
  // 화면 오픈 시 근태정보가 바로 보이도록 먼저 서버에서 조회
  await refreshAttendance({ silent: true });
  await loadTrayOperationInfo();

  refreshAttendanceEl?.addEventListener("click", () => refreshAttendance({ silent: false }));
  setupModeChangeListener();

  // 업데이트 확인 버튼 (작동정보 화면)
  if (checkUpdateEl && window.pcoffApi?.requestUpdateCheck) {
    checkUpdateEl.addEventListener("click", async () => {
      checkUpdateEl.disabled = true;
      checkUpdateEl.textContent = "확인 중...";
      try {
        const status = await window.pcoffApi.requestUpdateCheck();
        updateCheckButton(status);
      } catch (e) {
        console.warn("requestUpdateCheck failed", e);
        showToast("업데이트 확인 오류");
        checkUpdateEl.disabled = false;
        checkUpdateEl.textContent = "업데이트 확인";
      }
    });
    if (window.pcoffApi.onUpdateProgress) {
      window.pcoffApi.onUpdateProgress((data) => {
        if (checkUpdateEl && data.progress != null) {
          checkUpdateEl.textContent = `다운로드 ${Math.round(data.progress)}%`;
        }
      });
    }
  }

  // 로그 폴더 열기
  const openLogsFolderEl = document.getElementById("open-logs-folder");
  if (openLogsFolderEl && window.pcoffApi?.openLogsFolder) {
    openLogsFolderEl.addEventListener("click", async () => {
      try {
        await window.pcoffApi.openLogsFolder();
        showToast("로그 폴더를 열었습니다.");
      } catch (e) {
        console.warn("openLogsFolder failed", e);
        showToast("로그 폴더를 열 수 없습니다.");
      }
    });
  }

  // 버전정보 상세보기 토글
  versionToggleEl?.addEventListener("click", () => {
    if (!versionDetailEl) return;
    const isExpanded = versionDetailEl.classList.toggle("hidden");
    versionToggleEl.setAttribute("aria-expanded", String(!isExpanded));
    versionToggleEl.textContent = isExpanded ? "상세보기" : "접기";
  });

  // 트레이 정보 화면 열림 로그 (선택적)
  if (window.pcoffApi?.logEvent) {
    window.pcoffApi.logEvent("TRAY_INFO_OPENED", {});
  }
}

void init();
