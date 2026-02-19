/**
 * lock.js
 * 잠금화면 전용 스크립트
 * 기존 renderer.js의 main-view 관련 로직을 분리
 */

const stateBadgeEl = document.getElementById("state-badge");
const lockTitleEl = document.getElementById("lock-title");
const lockInfoEl = document.getElementById("lock-info");
const extendCountEl = document.getElementById("extend-count");
const dateTextEl = document.getElementById("date-text");
const timeTextEl = document.getElementById("time-text");
const attendPanelEl = document.getElementById("attend-panel");
const attendContentEl = document.getElementById("attend-content");
const toastEl = document.getElementById("toast");
const btnExtendEl = document.getElementById("btn-extend");
const btnUseEl = document.getElementById("btn-use");
const btnPlayEl = document.getElementById("btn-play");
const btnOffEl = document.getElementById("btn-off");
const getAttendEl = document.getElementById("get-attend");
const userDisplayEl = document.getElementById("user-display");
const appVersionEl = document.getElementById("app-version");

const DEFAULT_WORK = {
  pcOnYmdTime: "202602130830",
  pcOffYmdTime: "202602131830",
  pcExCount: 1,
  pcExMaxCount: 3,
  pcExTime: 30,
  pcoffEmergencyYesNo: "YES",
  pcOnYn: "Y",
  pcOnMsg: "",
  screenType: "off"
};

function parseYmdHm(value) {
  if (!value || value.length !== 12) return null;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6)) - 1;
  const d = Number(value.slice(6, 8));
  const hh = Number(value.slice(8, 10));
  const mm = Number(value.slice(10, 12));
  return new Date(y, m, d, hh, mm, 0);
}

function hm(value) {
  if (!value || value.length !== 12) return "--:--";
  return `${value.slice(8, 10)}:${value.slice(10, 12)}`;
}

function parseQueryWork() {
  const params = new URLSearchParams(window.location.search);
  const screenType = params.get("screenType") ?? DEFAULT_WORK.screenType;
  const pcOnYn = params.get("pcOnYn") ?? DEFAULT_WORK.pcOnYn;
  const pcoffEmergencyYesNo = params.get("pcoffEmergencyYesNo") ?? DEFAULT_WORK.pcoffEmergencyYesNo;
  return {
    ...DEFAULT_WORK,
    screenType,
    pcOnYn,
    pcoffEmergencyYesNo
  };
}

function coerceWorkTimeFromApi(data) {
  return {
    ...DEFAULT_WORK,
    pcOnYn: data.pcOnYn ?? DEFAULT_WORK.pcOnYn,
    pcOnYmdTime: data.pcOnYmdTime ?? DEFAULT_WORK.pcOnYmdTime,
    pcOffYmdTime: data.pcOffYmdTime ?? DEFAULT_WORK.pcOffYmdTime,
    pcOnMsg: data.pcOnMsg ?? "",
    pcExCount: Number(data.pcExCount ?? DEFAULT_WORK.pcExCount),
    pcExMaxCount: Number(data.pcExMaxCount ?? DEFAULT_WORK.pcExMaxCount),
    pcExTime: Number(data.pcExTime ?? DEFAULT_WORK.pcExTime),
    pcoffEmergencyYesNo: data.pcoffEmergencyYesNo ?? data.emergencyUseYesNo ?? DEFAULT_WORK.pcoffEmergencyYesNo
  };
}

function showToast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1400);
}

async function runAction(label, action) {
  try {
    const result = await action();
    if (!result || result.success !== false) {
      showToast(`${label} 완료`);
      return;
    }
    showToast(`${label} 실패`);
  } catch (error) {
    showToast(`${label} 오류`);
    console.error(error);
  }
}

function showEmergencyReasonModal() {
  const overlay = document.getElementById("emergency-modal");
  const input = document.getElementById("emergency-reason-input");
  const btnCancel = document.getElementById("emergency-modal-cancel");
  const btnConfirm = document.getElementById("emergency-modal-confirm");
  if (!overlay || !input) return Promise.resolve(null);

  input.value = "긴급 업무 처리";
  overlay.classList.remove("hidden");
  input.focus();

  return new Promise((resolve) => {
    const close = (value) => {
      overlay.classList.add("hidden");
      btnCancel.removeEventListener("click", onCancel);
      btnConfirm.removeEventListener("click", onConfirm);
      overlay.removeEventListener("click", onOverlayClick);
      input.removeEventListener("keydown", onKeydown);
      resolve(value);
    };
    const onCancel = () => close(null);
    const onConfirm = () => {
      const reason = (input.value ?? "").trim();
      if (!reason) {
        showToast("긴급사용 사유를 입력해 주세요.");
        return;
      }
      close(reason);
    };
    const onOverlayClick = (e) => {
      if (e.target === overlay) close(null);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter") onConfirm();
    };
    btnCancel.addEventListener("click", onCancel);
    btnConfirm.addEventListener("click", onConfirm);
    overlay.addEventListener("click", onOverlayClick);
    input.addEventListener("keydown", onKeydown);
  });
}

function updateClock() {
  const now = new Date();
  const dateText = `${now.getFullYear()}년 ${String(now.getMonth() + 1).padStart(2, "0")}월 ${String(now.getDate()).padStart(2, "0")}일`;
  const timeText = now.toLocaleTimeString("ko-KR", { hour12: true });
  if (dateTextEl) dateTextEl.textContent = dateText;
  if (timeTextEl) timeTextEl.textContent = timeText;
}

function openAttendPanel(work) {
  if (!attendPanelEl || !attendContentEl) return;
  attendPanelEl.classList.add("active");
  const lines = [
    `잠금화면: ${work.screenType}`,
    `PC 사용 가능 여부: ${work.pcOnYn}`,
    `PC 사용 시작시간: ${work.pcOnYmdTime}`,
    `PC 사용 종료시간: ${work.pcOffYmdTime}`,
    `임시연장 횟수: ${work.pcExCount}/${work.pcExMaxCount}`,
    `임시연장 단위시간: ${work.pcExTime}분`,
    `긴급사용 허용: ${work.pcoffEmergencyYesNo}`
  ];
  attendContentEl.textContent = lines.join("\n");
}

function setVisible(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function applyButtonDisp(work) {
  const now = new Date();
  const startTime = parseYmdHm(work.pcOnYmdTime);
  const offTime = parseYmdHm(work.pcOffYmdTime);

  switch (work.screenType) {
    case "before":
      setVisible(btnExtendEl, false);
      break;
    case "off":
      setVisible(btnExtendEl, Boolean(startTime && offTime && startTime <= now && offTime <= now));
      break;
    case "empty":
      setVisible(btnExtendEl, false);
      setVisible(btnUseEl, false);
      break;
    default:
      setVisible(btnExtendEl, true);
      setVisible(btnUseEl, true);
  }

  if (work.pcOnYn === "N" && work.pcOnMsg) {
    setVisible(btnExtendEl, false);
  }

  if (work.pcoffEmergencyYesNo !== "YES") {
    setVisible(btnUseEl, false);
  }
}

function applyLockInfo(work) {
  const now = new Date();
  const startTime = parseYmdHm(work.pcOnYmdTime);
  const offTime = parseYmdHm(work.pcOffYmdTime);

  if (work.pcOnYn === "N" && work.pcOnMsg) {
    if (lockTitleEl) lockTitleEl.textContent = work.pcOnMsg;
    if (lockInfoEl) lockInfoEl.textContent = "긴급사용 또는 휴일근무신청을 한 경우 PC-ON 하여 주세요.";
    return;
  }

  if (work.screenType === "before" || (startTime && now < startTime)) {
    if (lockTitleEl) lockTitleEl.textContent = "시업 전 잠금 상태입니다.";
    if (lockInfoEl) lockInfoEl.textContent = `PC 사용가능시간은 ${hm(work.pcOnYmdTime)}~${hm(work.pcOffYmdTime)}입니다.`;
    return;
  }

  if (work.screenType === "empty") {
    if (lockTitleEl) lockTitleEl.textContent = "이석 감지 상태입니다.";
    if (lockInfoEl) lockInfoEl.textContent = "이석 사유 확인 후 PC-ON 하여 주세요.";
    return;
  }

  if (lockTitleEl) lockTitleEl.textContent = "PC 사용이 종료되었습니다.";
  if (offTime && now >= offTime) {
    if (lockInfoEl) lockInfoEl.textContent = `임시연장은 PC-OFF 시간부터 ${work.pcExTime}분씩 ${work.pcExMaxCount}회 사용할 수 있습니다.`;
  } else {
    if (lockInfoEl) lockInfoEl.textContent = `PC 사용가능시간은 ${hm(work.pcOnYmdTime)}~${hm(work.pcOffYmdTime)}입니다.`;
  }
}

async function loadUserInfo() {
  if (!window.pcoffApi?.getCurrentUser || !userDisplayEl) return;
  try {
    const user = await window.pcoffApi.getCurrentUser();
    const parts = [];
    if (user.corpNm) parts.push(user.corpNm);
    if (user.loginUserNm) parts.push(user.loginUserNm);
    if (user.posNm) parts.push(user.posNm);
    userDisplayEl.textContent = parts.length > 0 ? parts.join(" · ") : "";
    userDisplayEl.style.display = parts.length > 0 ? "" : "none";
  } catch {
    userDisplayEl.textContent = "";
    userDisplayEl.style.display = "none";
  }
}

function showPasswordChangeModal(message) {
  const overlay = document.getElementById("password-change-modal");
  const messageEl = document.getElementById("password-change-message");
  const btnConfirm = document.getElementById("password-change-confirm");
  if (!overlay) return;

  if (messageEl) {
    messageEl.textContent = message || "비밀번호가 변경되었습니다.";
  }
  overlay.classList.remove("hidden");

  const close = async () => {
    overlay.classList.add("hidden");
    btnConfirm?.removeEventListener("click", onConfirm);
    overlay.removeEventListener("click", onOverlayClick);
    document.removeEventListener("keydown", onKeydown);

    if (window.pcoffApi?.confirmPasswordChange) {
      try {
        await window.pcoffApi.confirmPasswordChange();
        showToast("비밀번호 변경 확인됨");
      } catch (e) {
        console.error("confirmPasswordChange error:", e);
      }
    }
  };
  const onConfirm = () => close();
  const onOverlayClick = (e) => {
    if (e.target === overlay) close();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape" || e.key === "Enter") close();
  };

  btnConfirm?.addEventListener("click", onConfirm);
  overlay.addEventListener("click", onOverlayClick);
  document.addEventListener("keydown", onKeydown);
}

function setupPasswordChangeListener() {
  if (!window.pcoffApi?.onPasswordChangeDetected) return;

  window.pcoffApi.onPasswordChangeDetected((data) => {
    showPasswordChangeModal(data.message);
  });

  if (window.pcoffApi.getPasswordChangeState) {
    window.pcoffApi.getPasswordChangeState().then((state) => {
      if (state.detected) {
        showPasswordChangeModal(state.message);
      }
    });
  }
}

async function bootstrap() {
  updateClock();
  setInterval(updateClock, 1000);

  let currentState = "preview";
  if (window.pcoffApi) {
    const appState = await window.pcoffApi.getAppState();
    currentState = appState.state;
  }
  if (stateBadgeEl) stateBadgeEl.textContent = `state: ${currentState}`;

  await loadUserInfo();

  if (window.pcoffApi?.getAppVersion && appVersionEl) {
    try {
      const ver = await window.pcoffApi.getAppVersion();
      appVersionEl.textContent = `v${ver}`;
    } catch {
      // ignore
    }
  }

  let work = parseQueryWork();
  if (window.pcoffApi?.getWorkTime) {
    try {
      const response = await window.pcoffApi.getWorkTime();
      work = { ...work, ...coerceWorkTimeFromApi(response.data) };
      if (stateBadgeEl) stateBadgeEl.textContent = `state: ${currentState} (${response.source})`;
    } catch (error) {
      showToast(`근태정보 조회 실패: ${String(error)}`);
    }
  }
  if (extendCountEl) extendCountEl.textContent = String(work.pcExCount);
  applyLockInfo(work);
  applyButtonDisp(work);

  btnExtendEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestPcExtend) return showToast("preview 모드: 임시연장");
    await runAction("임시연장", () => window.pcoffApi.requestPcExtend(work.pcOffYmdTime));
  });
  btnUseEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestEmergencyUse) return showToast("preview 모드: 긴급사용");
    const reason = await showEmergencyReasonModal();
    if (reason == null || reason === "") return;
    await runAction("긴급사용", () => window.pcoffApi.requestEmergencyUse(reason));
  });
  btnPlayEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestPcOnOffLog) return showToast("preview 모드: PC-ON");
    await runAction("PC-ON", () => window.pcoffApi.requestPcOnOffLog("IN", "Lock Off"));
  });
  btnOffEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestPcOnOffLog) return showToast("preview 모드: PC-OFF");
    await runAction("PC-OFF", () => window.pcoffApi.requestPcOnOffLog("OUT", "Lock On"));
  });
  getAttendEl?.addEventListener("click", () => openAttendPanel(work));
  document.getElementById("close-attend")?.addEventListener("click", () => {
    if (attendPanelEl) attendPanelEl.classList.remove("active");
  });

  setupPasswordChangeListener();

  // 잠금화면 로그
  if (window.pcoffApi?.logEvent) {
    window.pcoffApi.logEvent("LOCK_SCREEN_OPENED", { screenType: work.screenType });
  }
}

void bootstrap();
