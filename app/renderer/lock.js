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
  screenType: "off",
  leaveSeatReasonYn: "NO",
  leaveSeatReasonManYn: "NO",
  leaveSeatOffInputMath: null,
  breakStartTime: null,
  breakEndTime: null,
  leaveSeatTime: 5,
  leaveSeatUnlockRequirePassword: false
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
    pcoffEmergencyYesNo: data.pcoffEmergencyYesNo ?? data.emergencyUseYesNo ?? DEFAULT_WORK.pcoffEmergencyYesNo,
    leaveSeatReasonYn: data.leaveSeatReasonYn ?? DEFAULT_WORK.leaveSeatReasonYn,
    leaveSeatReasonManYn: data.leaveSeatReasonManYn ?? DEFAULT_WORK.leaveSeatReasonManYn,
    leaveSeatOffInputMath: data.leaveSeatOffInputMath ?? null,
    breakStartTime: data.breakStartTime ?? null,
    breakEndTime: data.breakEndTime ?? null,
    leaveSeatTime: Number(data.leaveSeatTime ?? DEFAULT_WORK.leaveSeatTime ?? 0) || 0,
    screenType: data.screenType ?? DEFAULT_WORK.screenType,
    // FR-14: 고객사 설정 잠금화면 문구·이미지 (서버/config에서 내려주면 적용)
    lockScreenBeforeTitle: data.lockScreenBeforeTitle ?? undefined,
    lockScreenBeforeMessage: data.lockScreenBeforeMessage ?? undefined,
    lockScreenOffTitle: data.lockScreenOffTitle ?? undefined,
    lockScreenOffMessage: data.lockScreenOffMessage ?? undefined,
    lockScreenLeaveTitle: data.lockScreenLeaveTitle ?? undefined,
    lockScreenLeaveMessage: data.lockScreenLeaveMessage ?? undefined,
    lockScreenBeforeBackground: data.lockScreenBeforeBackground ?? undefined,
    lockScreenBeforeLogo: data.lockScreenBeforeLogo ?? undefined,
    lockScreenOffBackground: data.lockScreenOffBackground ?? undefined,
    lockScreenOffLogo: data.lockScreenOffLogo ?? undefined,
    lockScreenLeaveBackground: data.lockScreenLeaveBackground ?? undefined,
    lockScreenLeaveLogo: data.lockScreenLeaveLogo ?? undefined,
    leaveSeatUnlockRequirePassword: Boolean(data.leaveSeatUnlockRequirePassword)
  };
}

/**
 * 이석 사유 입력 필요 여부 판별
 * - screenType=empty + leaveSeatReasonYn=YES + leaveSeatReasonManYn=YES → 필수
 * - 단, 현재 시각이 휴게시간(breakStartTime~breakEndTime) 안이면 면제
 */
function calcLeaveSeatPolicy(work) {
  const isLeaveSeat = work.screenType === "empty";
  if (!isLeaveSeat) return { isLeaveSeat: false, requireReason: false, isBreakTime: false, detectedAt: null };

  const isBreakTime = checkIsBreakTime(work.breakStartTime, work.breakEndTime);
  const requireReason =
    work.leaveSeatReasonYn === "YES" &&
    work.leaveSeatReasonManYn === "YES" &&
    !isBreakTime;

  const detectedAt = work.leaveSeatOffInputMath
    ? formatDetectedAt(work.leaveSeatOffInputMath)
    : null;

  return { isLeaveSeat, requireReason, isBreakTime, detectedAt };
}

function parseTimeToDate(value) {
  if (!value) return null;
  const now = new Date();
  if (String(value).length === 4) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Number(String(value).slice(0, 2)), Number(String(value).slice(2, 4)), 0);
  }
  if (String(value).length === 12) {
    return new Date(
      Number(String(value).slice(0, 4)), Number(String(value).slice(4, 6)) - 1,
      Number(String(value).slice(6, 8)), Number(String(value).slice(8, 10)),
      Number(String(value).slice(10, 12)), 0
    );
  }
  return null;
}

function checkIsBreakTime(breakStartTime, breakEndTime) {
  if (!breakStartTime || !breakEndTime) return false;
  const now = new Date();
  const start = parseTimeToDate(breakStartTime);
  const end = parseTimeToDate(breakEndTime);
  if (!start || !end) return false;
  return now >= start && now < end;
}

function formatDetectedAt(value) {
  if (!value || String(value).length !== 12) return String(value ?? "");
  return `${String(value).slice(8, 10)}:${String(value).slice(10, 12)}`;
}

/**
 * 이석 사유 입력 모달을 표시하고 사용자가 입력한 사유(string) 또는 취소(null)를 반환
 */
function showLeaveSeatReasonModal(work) {
  const overlay = document.getElementById("leave-seat-modal");
  const input = document.getElementById("leave-seat-reason-input");
  const detectedAtEl = document.getElementById("leave-seat-detected-at");
  const btnCancel = document.getElementById("leave-seat-modal-cancel");
  const btnConfirm = document.getElementById("leave-seat-modal-confirm");
  if (!overlay || !input) return Promise.resolve(null);

  if (work.detectedAt) {
    if (detectedAtEl) {
      detectedAtEl.textContent = `이석 감지 시각: ${work.detectedAt}`;
      detectedAtEl.style.display = "";
    }
  }

  input.value = "";
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
        showToast("이석 사유를 입력해 주세요.");
        return;
      }
      close(reason);
    };
    const onOverlayClick = (e) => { if (e.target === overlay) close(null); };
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

/**
 * FR-14: 이석 해제 비밀번호 모달 (leaveSeatUnlockRequirePassword=true 시)
 * @returns Promise<{ password: string; reason: string } | null> 확인 시 값, 취소 시 null
 */
function showLeaveSeatUnlockPasswordModal() {
  const overlay = document.getElementById("leave-seat-unlock-modal");
  const passwordInput = document.getElementById("leave-seat-unlock-password");
  const reasonInput = document.getElementById("leave-seat-unlock-reason");
  const btnCancel = document.getElementById("leave-seat-unlock-modal-cancel");
  const btnConfirm = document.getElementById("leave-seat-unlock-modal-confirm");
  if (!overlay || !passwordInput) return Promise.resolve(null);

  passwordInput.value = "";
  if (reasonInput) reasonInput.value = "";
  overlay.classList.remove("hidden");
  passwordInput.focus();

  return new Promise((resolve) => {
    const close = (value) => {
      overlay.classList.add("hidden");
      btnCancel?.removeEventListener("click", onCancel);
      btnConfirm?.removeEventListener("click", onConfirm);
      overlay.removeEventListener("click", onOverlayClick);
      passwordInput.removeEventListener("keydown", onKeydown);
      if (reasonInput) reasonInput.removeEventListener("keydown", onKeydown);
      resolve(value);
    };
    const onCancel = () => close(null);
    const onConfirm = () => {
      const password = (passwordInput.value ?? "").trim();
      if (!password) {
        showToast("비밀번호를 입력해 주세요.");
        return;
      }
      close({ password, reason: (reasonInput?.value ?? "").trim() });
    };
    const onOverlayClick = (e) => { if (e.target === overlay) close(null); };
    const onKeydown = (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter") onConfirm();
    };
    btnCancel?.addEventListener("click", onCancel);
    btnConfirm?.addEventListener("click", onConfirm);
    overlay.addEventListener("click", onOverlayClick);
    passwordInput.addEventListener("keydown", onKeydown);
    if (reasonInput) reasonInput.addEventListener("keydown", onKeydown);
  });
}

/** @param {string} text - 표시할 문구. @param {number} [durationMs] - 표시 시간(ms). 기본 2500, 안내 문구는 더 길게(예: 5000) */
function showToast(text, durationMs) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.add("show");
  const ms = typeof durationMs === "number" && durationMs > 0 ? durationMs : 2500;
  setTimeout(() => toastEl.classList.remove("show"), ms);
}

async function runAction(label, action) {
  try {
    const result = await action();
    if (result?.stillLocked) {
      showToast("현재 PC-ON이 불가능합니다. 시업 시간에만 가능합니다.");
      return;
    }
    if (result?.success === false) {
      showToast(result?.error || `${label} 실패`);
      return;
    }
    showToast(`${label} 완료`);
  } catch (error) {
    showToast(`${label} 오류`);
    console.error(error);
  }
}

/**
 * 긴급사용 모달. serverPass가 있으면 이미 OTP 발송된 상태 → 인증번호 입력 + 사유 입력 후 확인 시 검증·사유 전송만.
 * @param {string|null} serverPass - Step1에서 받은 인증번호(있으면 모달만 검증·사유 전송, 없으면 사용 안 함)
 */
function showEmergencyReasonModal(serverPass) {
  const overlay = document.getElementById("emergency-modal");
  const passInput = document.getElementById("emergency-pass-input");
  const reasonInput = document.getElementById("emergency-reason-input");
  const descEl = document.querySelector("#emergency-modal .modal-desc");
  const errorEl = document.getElementById("emergency-modal-error");
  const btnCancel = document.getElementById("emergency-modal-cancel");
  const btnConfirm = document.getElementById("emergency-modal-confirm");
  if (!overlay || !passInput || !reasonInput) return Promise.resolve(null);

  passInput.value = "";
  reasonInput.value = "긴급 업무 처리";
  if (descEl) descEl.textContent = "휴대폰으로 수신된 인증번호를 입력한 뒤, 사유를 입력하고 확인을 눌러 주세요.";
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.style.display = "none";
  }
  overlay.classList.remove("hidden");
  passInput.focus();

  const storedServerPass = serverPass != null ? String(serverPass).trim() : null;
  if (!storedServerPass) {
    if (errorEl) {
      errorEl.textContent = "인증번호를 불러오지 못했습니다. 긴급사용 버튼을 다시 눌러 주세요.";
      errorEl.style.display = "";
    }
  }

  return new Promise((resolve) => {
    const close = (value) => {
      overlay.classList.add("hidden");
      btnCancel.removeEventListener("click", onCancel);
      btnConfirm.removeEventListener("click", onConfirm);
      overlay.removeEventListener("click", onOverlayClick);
      passInput.removeEventListener("keydown", onKeydown);
      reasonInput.removeEventListener("keydown", onKeydown);
      resolve(value);
    };
    const onCancel = () => close(null);
    const showError = (msg) => {
      if (errorEl) {
        errorEl.textContent = msg || "인증번호가 올바르지 않습니다.";
        errorEl.style.display = "";
      }
      passInput.value = "";
      passInput.focus();
    };
    const onConfirm = async () => {
      const reason = (reasonInput.value ?? "").trim();
      const pass = (passInput.value ?? "").trim();

      if (!storedServerPass) return;

      if (!pass) {
        showToast("인증번호를 입력해 주세요.");
        passInput.focus();
        return;
      }
      if (String(pass).trim() !== String(storedServerPass).trim()) {
        showError("입력하신 비밀번호가 맞지 않습니다. 다시 확인해 주세요.");
        return;
      }

      if (!window.pcoffApi?.completeEmergencyUseWithReason) {
        showToast("preview 모드: 긴급사용");
        return;
      }
      btnConfirm.disabled = true;
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
      }
      try {
        const result = await window.pcoffApi.completeEmergencyUseWithReason(reason || "긴급사용", pass);
        if (result?.success) {
          close({ success: true });
          showToast("긴급사용 완료");
        } else {
          showError(result?.error || "사유 전송에 실패했습니다.");
        }
      } catch (e) {
        showError("처리 중 오류가 발생했습니다.");
        console.error(e);
      } finally {
        btnConfirm.disabled = false;
      }
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
    passInput.addEventListener("keydown", onKeydown);
    reasonInput.addEventListener("keydown", onKeydown);
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

/** FR-14: 현재 screenType에 맞는 배경·로고 URL 적용 (서버/config에서 내려주면 적용) */
function applyLockScreenImages(work) {
  let backgroundUrl = "";
  let logoUrl = "";
  const st = (work.screenType ?? "").toLowerCase();
  if (st === "before") {
    backgroundUrl = work.lockScreenBeforeBackground ?? "";
    logoUrl = work.lockScreenBeforeLogo ?? "";
  } else if (st === "empty") {
    backgroundUrl = work.lockScreenLeaveBackground ?? "";
    logoUrl = work.lockScreenLeaveLogo ?? "";
  } else {
    backgroundUrl = work.lockScreenOffBackground ?? "";
    logoUrl = work.lockScreenOffLogo ?? "";
  }
  if (document.body) {
    if (backgroundUrl && backgroundUrl.trim()) {
      document.body.style.backgroundImage = `url(${CSS.escape(backgroundUrl.trim())})`;
      document.body.style.backgroundSize = "cover";
      document.body.style.backgroundPosition = "center";
      document.body.classList.add("has-lock-bg");
    } else {
      document.body.style.backgroundImage = "";
      document.body.style.backgroundSize = "";
      document.body.style.backgroundPosition = "";
      document.body.classList.remove("has-lock-bg");
    }
  }
  const logoImg = document.getElementById("lock-logo-img");
  const logoMark = document.querySelector(".logo-item .logo-mark");
  if (logoImg && logoMark) {
    if (logoUrl && logoUrl.trim()) {
      logoImg.src = logoUrl.trim();
      logoImg.alt = "로고";
      logoImg.style.display = "";
      logoMark.style.display = "none";
    } else {
      logoImg.src = "";
      logoImg.style.display = "none";
      logoMark.style.display = "";
    }
  }
}

function applyLockInfo(work) {
  const now = new Date();
  const startTime = parseYmdHm(work.pcOnYmdTime);
  const offTime = parseYmdHm(work.pcOffYmdTime);

  // FR-14: 배경·로고 이미지 적용 (screenType별)
  applyLockScreenImages(work);

  // 메시지 로그: 서버에서 받은 잠금화면 문구 여부 확인용
  const lockScreenFromServer = {
    lockScreenBeforeTitle: work.lockScreenBeforeTitle,
    lockScreenBeforeMessage: work.lockScreenBeforeMessage,
    lockScreenOffTitle: work.lockScreenOffTitle,
    lockScreenOffMessage: work.lockScreenOffMessage,
    lockScreenLeaveTitle: work.lockScreenLeaveTitle,
    lockScreenLeaveMessage: work.lockScreenLeaveMessage
  };
  console.info("[PCOFF] 잠금화면 문구 — 서버 응답 필드:", JSON.stringify(lockScreenFromServer, null, 0));
  console.info("[PCOFF] 잠금화면 문구 — screenType:", work.screenType, "pcOnYn:", work.pcOnYn, "pcOnMsg:", work.pcOnMsg || "(없음)");

  // FR-14: 서버에서 고객사 설정(잠금화면 문구)을 내려주면 우선 적용. 상세 안내(임시연장·긴급사용 등)는 화면에 뿌리지 않고, '나의 근태정보 불러오기'에서 확인하도록 함(문서: docs/잠금_및_적용정책_설명.md 등).
  const fallback = {
    before: { title: "시업 전 잠금 상태입니다.", message: `PC 사용가능시간은 ${hm(work.pcOnYmdTime)}~${hm(work.pcOffYmdTime)}입니다.` },
    leave: { title: "이석 감지 상태입니다.", message: "이석 사유 확인 후 PC-ON 하여 주세요." },
    off: {
      title: "지금은 PC 화면이 잠겨있습니다.",
      message: ""
    }
  };

  if (work.pcOnYn === "N" && work.pcOnMsg) {
    const title = work.pcOnMsg;
    const message = work.lockScreenOffMessage || "긴급사용 또는 휴일근무신청을 한 경우 PC-ON 하여 주세요.";
    console.info("[PCOFF] 잠금화면 적용 — pcOnYn=N: title:", title, "| message:", message, "| source:", work.lockScreenOffMessage ? "server" : "fallback");
    if (lockTitleEl) lockTitleEl.textContent = title;
    if (lockInfoEl) { lockInfoEl.textContent = message; lockInfoEl.style.display = ""; }
    return;
  }

  if (work.screenType === "before" || (startTime && now < startTime)) {
    const title = work.lockScreenBeforeTitle || fallback.before.title;
    const message = work.lockScreenBeforeMessage || work.pcOnMsg || fallback.before.message;
    const source = work.lockScreenBeforeTitle || work.lockScreenBeforeMessage || work.pcOnMsg ? "server" : "fallback";
    console.info("[PCOFF] 잠금화면 적용 — before: title:", title, "| message:", message, "| source:", source);
    if (lockTitleEl) lockTitleEl.textContent = title;
    if (lockInfoEl) { lockInfoEl.textContent = message; lockInfoEl.style.display = ""; }
    return;
  }

  if (work.screenType === "empty") {
    const title = work.lockScreenLeaveTitle || fallback.leave.title;
    const message = work.lockScreenLeaveMessage || work.pcOnMsg || fallback.leave.message;
    const source = work.lockScreenLeaveTitle || work.lockScreenLeaveMessage || work.pcOnMsg ? "server" : "fallback";
    console.info("[PCOFF] 잠금화면 적용 — empty(이석): title:", title, "| message:", message, "| source:", source);
    if (lockTitleEl) lockTitleEl.textContent = title;
    if (lockInfoEl) { lockInfoEl.textContent = message; lockInfoEl.style.display = ""; }
    return;
  }

  // 종업(off): 서버 lockScreenOffMessage만 본문에 표시. 상세 안내는 '나의 근태정보 불러오기'에서 확인
  const title = work.lockScreenOffTitle || fallback.off.title;
  const message = work.lockScreenOffMessage || fallback.off.message;
  const source = work.lockScreenOffTitle || work.lockScreenOffMessage ? "server" : "fallback";
  console.info("[PCOFF] 잠금화면 적용 — off(종업): title:", title, "| message:", message || "(없음)", "| source:", source);
  if (lockTitleEl) lockTitleEl.textContent = title;
  if (lockInfoEl) lockInfoEl.textContent = message;
  if (lockInfoEl && !message) lockInfoEl.style.display = "none";
  else if (lockInfoEl) lockInfoEl.style.display = "";
}

// 보조 잠금창: 메인에서 동일 근태/배경 데이터 수신 후 적용 (주모니터와 동일 문구·배경)
if (typeof window !== "undefined" && window.pcoffApi?.onLockInitialWork) {
  window.pcoffApi.onLockInitialWork((data) => {
    const work = coerceWorkTimeFromApi(data);
    applyLockInfo(work);
    applyButtonDisp(work);
  });
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

/* ──── FR-15: 긴급해제 ──── */
const btnEmergencyUnlockEl = document.getElementById("btn-emergency-unlock");

async function checkEmergencyUnlockEligibility() {
  if (!window.pcoffApi?.getEmergencyUnlockEligibility || !btnEmergencyUnlockEl) return;
  try {
    const elig = await window.pcoffApi.getEmergencyUnlockEligibility();
    btnEmergencyUnlockEl.style.display = elig.eligible ? "" : "none";
  } catch {
    btnEmergencyUnlockEl.style.display = "none";
  }
}

function showEmergencyUnlockModal() {
  const overlay = document.getElementById("emergency-unlock-modal");
  const input = document.getElementById("emergency-unlock-password");
  const hintEl = document.getElementById("emergency-unlock-hint");
  const btnCancel = document.getElementById("emergency-unlock-cancel");
  const btnConfirm = document.getElementById("emergency-unlock-confirm");
  if (!overlay || !input) return;

  input.value = "";
  if (hintEl) { hintEl.style.display = "none"; hintEl.textContent = ""; }
  overlay.classList.remove("hidden");
  input.focus();

  const cleanup = () => {
    overlay.classList.add("hidden");
    btnCancel?.removeEventListener("click", onCancel);
    btnConfirm?.removeEventListener("click", onConfirm);
    overlay.removeEventListener("click", onOverlayClick);
    input.removeEventListener("keydown", onKeydown);
  };
  const onCancel = () => cleanup();
  const onConfirm = async () => {
    const password = input.value.trim();
    if (!password) {
      showToast("비밀번호를 입력해 주세요.");
      return;
    }
    btnConfirm.disabled = true;
    btnConfirm.textContent = "확인 중...";
    try {
      const result = await window.pcoffApi.requestEmergencyUnlock(password);
      if (result.success) {
        showToast("긴급해제 성공 (설정된 시간 후 자동 잠금)");
        cleanup();
      } else {
        if (hintEl) {
          hintEl.style.display = "";
          hintEl.textContent = result.message;
          hintEl.style.color = "#e74c3c";
        }
        input.value = "";
        input.focus();
      }
    } catch (e) {
      showToast("긴급해제 오류");
    } finally {
      btnConfirm.disabled = false;
      btnConfirm.textContent = "확인";
    }
  };
  const onOverlayClick = (e) => { if (e.target === overlay) cleanup(); };
  const onKeydown = (e) => {
    if (e.key === "Escape") cleanup();
    if (e.key === "Enter") onConfirm();
  };
  btnCancel?.addEventListener("click", onCancel);
  btnConfirm?.addEventListener("click", onConfirm);
  overlay.addEventListener("click", onOverlayClick);
  input.addEventListener("keydown", onKeydown);
}

function setupEmergencyUnlockListeners() {
  btnEmergencyUnlockEl?.addEventListener("click", () => showEmergencyUnlockModal());

  if (window.pcoffApi?.onEmergencyUnlockExpiring) {
    window.pcoffApi.onEmergencyUnlockExpiring((data) => {
      const banner = document.getElementById("emergency-unlock-expiry-banner");
      if (banner) {
        banner.textContent = `긴급해제가 ${Math.ceil(data.remainingSec / 60)}분 후 만료됩니다.`;
        banner.style.display = "";
        setTimeout(() => { banner.style.display = "none"; }, 15000);
      }
    });
  }

  if (window.pcoffApi?.onEmergencyUnlockExpired) {
    window.pcoffApi.onEmergencyUnlockExpired(() => {
      showToast("긴급해제가 만료되어 잠금 상태로 전환됩니다.");
    });
  }
}

/* ──── FR-17: 오프라인 유예/잠금 UI ──── */
let offlineCountdownTimer = null;

function showOfflineOverlay(snapshot) {
  const overlay = document.getElementById("offline-overlay");
  const titleEl = document.getElementById("offline-title");
  const descEl = document.getElementById("offline-desc");
  const countdownEl = document.getElementById("offline-countdown");
  const retryBtn = document.getElementById("offline-retry-btn");
  const retryInfoEl = document.getElementById("offline-retry-info");
  const iconEl = document.getElementById("offline-icon");
  if (!overlay) return;

  overlay.classList.remove("hidden");

  if (snapshot.state === "OFFLINE_LOCKED") {
    if (iconEl) iconEl.textContent = "🔒";
    if (titleEl) titleEl.textContent = "네트워크 미복구 — PC 잠금";
    if (descEl) descEl.textContent = "네트워크 복구 후 자동 해제됩니다.";
    if (countdownEl) countdownEl.textContent = "잠금";
    stopOfflineCountdown();

    if (btnExtendEl) btnExtendEl.style.display = "none";
    if (btnUseEl) btnUseEl.style.display = "none";
    if (btnPlayEl) btnPlayEl.disabled = true;
  } else if (snapshot.state === "OFFLINE_GRACE") {
    if (iconEl) iconEl.textContent = "⚠️";
    if (titleEl) titleEl.textContent = "네트워크 연결이 끊어졌습니다";
    if (descEl) descEl.textContent = "유예 시간 내에 복구되지 않으면 PC가 잠깁니다.";
    startOfflineCountdown(snapshot.deadline);
  }

  if (retryBtn && !retryBtn._offlineBound) {
    retryBtn._offlineBound = true;
    retryBtn.addEventListener("click", async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "확인 중...";
      try {
        const result = await window.pcoffApi.retryConnectivity();
        if (result.recovered) {
          showToast("네트워크 복구됨");
          hideOfflineOverlay();
        } else {
          showToast("아직 연결할 수 없습니다.");
          if (retryInfoEl) {
            retryInfoEl.style.display = "";
            retryInfoEl.textContent = `재시도 ${result.snapshot?.retryCount ?? 0}회`;
          }
        }
      } catch {
        showToast("재시도 실패");
      } finally {
        retryBtn.disabled = false;
        retryBtn.textContent = "다시 시도";
      }
    });
  }
}

function hideOfflineOverlay() {
  const overlay = document.getElementById("offline-overlay");
  if (overlay) overlay.classList.add("hidden");
  stopOfflineCountdown();

  if (btnExtendEl) btnExtendEl.style.display = "";
  if (btnUseEl) btnUseEl.style.display = "";
  if (btnPlayEl) btnPlayEl.disabled = false;
}

function startOfflineCountdown(deadline) {
  stopOfflineCountdown();
  const countdownEl = document.getElementById("offline-countdown");
  if (!countdownEl || !deadline) return;

  const target = new Date(deadline).getTime();
  const tick = () => {
    const remaining = target - Date.now();
    if (remaining <= 0) {
      countdownEl.textContent = "00:00";
      stopOfflineCountdown();
      return;
    }
    const totalSec = Math.ceil(remaining / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    countdownEl.textContent = `${mm}:${ss}`;
  };
  tick();
  offlineCountdownTimer = setInterval(tick, 1000);
}

function stopOfflineCountdown() {
  if (offlineCountdownTimer) {
    clearInterval(offlineCountdownTimer);
    offlineCountdownTimer = null;
  }
}

function setupConnectivityListener() {
  if (!window.pcoffApi?.onConnectivityChanged) return;

  window.pcoffApi.onConnectivityChanged((data) => {
    if (data.state === "ONLINE") {
      hideOfflineOverlay();
    } else {
      window.pcoffApi.getConnectivityState().then((snap) => showOfflineOverlay(snap));
    }
  });

  if (window.pcoffApi.getConnectivityState) {
    window.pcoffApi.getConnectivityState().then((snap) => {
      if (snap.state !== "ONLINE") {
        showOfflineOverlay(snap);
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

  // 이석 정책 계산 (사유 필수 여부 / 휴게시간 여부)
  const leaveSeatPolicy = calcLeaveSeatPolicy(work);

  // 이석 상태일 때 UI 힌트 추가 (휴게시간 면제 안내)
  if (leaveSeatPolicy.isLeaveSeat && leaveSeatPolicy.isBreakTime) {
    showToast("휴게시간 중: 사유 입력 없이 PC-ON 가능");
  }

  btnExtendEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestPcExtend) return showToast("preview 모드: 임시연장");
    await runAction("임시연장", () => window.pcoffApi.requestPcExtend(work.pcOffYmdTime));
  });
  btnUseEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestEmergencyUseStep1) {
      showToast("preview 모드: 긴급사용");
      return;
    }
    btnUseEl.disabled = true;
    try {
      const result = await window.pcoffApi.requestEmergencyUseStep1("긴급사용 요청");
      if (result?.success && result?.serverPass != null) {
        await showEmergencyReasonModal(result.serverPass);
      } else {
        showToast(result?.error || "인증번호 발송에 실패했습니다.");
      }
    } catch (e) {
      showToast("인증번호 발송 중 오류가 발생했습니다.");
      console.error(e);
    } finally {
      btnUseEl.disabled = false;
    }
  });
  btnPlayEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestPcOnOffLog) return showToast("preview 모드: PC-ON");

    // FR-14: 이석 상태이고 비밀번호 필수인 경우 → 비밀번호 모달 후 검증 PC-ON
    if (leaveSeatPolicy.isLeaveSeat && work.leaveSeatUnlockRequirePassword) {
      if (!window.pcoffApi?.requestPcOnWithLeaveSeatUnlock) return showToast("preview 모드: 이석 해제");
      const result = await showLeaveSeatUnlockPasswordModal();
      if (!result) return;
      try {
        const res = await window.pcoffApi.requestPcOnWithLeaveSeatUnlock(result.password, result.reason || undefined);
        if (res?.success === false) {
          showToast(res?.error || "비밀번호가 맞지 않습니다.");
          return;
        }
        if (res?.stillLocked) {
          showToast("이석 해제되었습니다. 근무 시간이 아니면 PC-ON이 반영되지 않을 수 있습니다.", 5500);
        } else {
          showToast("PC-ON (이석 해제) 완료", 3500);
        }
        if (window.pcoffApi?.getWorkTime) {
          try {
            await window.pcoffApi.getWorkTime();
          } catch (_) {}
        }
      } catch (e) {
        showToast("PC-ON (이석 해제) 오류");
        console.error(e);
      }
      return;
    }

    // 이석 상태이고 사유 입력이 필요한 경우 → 모달 표시
    if (leaveSeatPolicy.requireReason) {
      const reason = await showLeaveSeatReasonModal(leaveSeatPolicy);
      if (reason == null || reason === "") return; // 취소
      // 사유 포함하여 PC-ON 요청 (eventName=Lock Off - 이석해제, isLeaveSeat=true)
      await runAction("PC-ON (이석해제)", () =>
        window.pcoffApi.requestPcOnOffLog("IN", "Lock Off - 이석해제", reason, true)
      );
      return;
    }

    // 이석 상태이지만 사유 면제 (휴게시간 중)
    if (leaveSeatPolicy.isLeaveSeat && leaveSeatPolicy.isBreakTime) {
      await runAction("PC-ON (휴게시간·사유면제)", () =>
        window.pcoffApi.requestPcOnOffLog("IN", "Lock Off - 이석해제", "", true)
      );
      return;
    }

    // 일반 PC-ON
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
  setupConnectivityListener();
  setupEmergencyUnlockListeners();
  void checkEmergencyUnlockEligibility();

  // 잠금화면 로그
  if (window.pcoffApi?.logEvent) {
    window.pcoffApi.logEvent("LOCK_SCREEN_OPENED", { screenType: work.screenType });

    // 이석 상태이면 LEAVE_SEAT_DETECTED 로그
    if (leaveSeatPolicy.isLeaveSeat) {
      window.pcoffApi.logEvent("LEAVE_SEAT_DETECTED", {
        detectedAt: leaveSeatPolicy.detectedAt,
        requireReason: leaveSeatPolicy.requireReason,
        isBreakTime: leaveSeatPolicy.isBreakTime
      });
    }
  }
}

void bootstrap();
