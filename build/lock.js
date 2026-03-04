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
const actionProgressOverlayEl = document.getElementById("action-progress-overlay");
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
  /** 긴급사용 OTP 발송 대상: SELF=본인, MANAGER=조직장. 서버 미제공 시 SELF */
  emergencyOtpSendTo: "SELF",
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
  if (!value || String(value).length < 12) return null;
  const s = String(value);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  const hh = Number(s.slice(8, 10));
  const mm = Number(s.slice(10, 12));
  return new Date(y, m, d, hh, mm, 0);
}

/** 임시연장 허용 마감 시각 (종업+연장최대시간). 이 시각 이후에는 임시연장 버튼 비노출/요청 거부. */
function getTempExtendDeadline(work) {
  const pcOff = parseYmdHm(String(work.pcOffYmdTime ?? ""));
  if (!pcOff) return null;
  const count = Number(work.pcExCount ?? 0);
  const maxCount = Number(work.pcExMaxCount ?? 0);
  const timeMin = Number(work.pcExTime ?? 0) || 60;
  if (maxCount <= 0) return null;
  const baseMs = pcOff.getTime() - count * timeMin * 60 * 1000;
  return new Date(baseMs + maxCount * timeMin * 60 * 1000);
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

/** 서버 응답에서 OTP 조직장 수신 여부 판별. (설정: OTP조직장수신여부 = OTP조직장 수신) */
function resolveEmergencyOtpSendTo(data) {
  if (!data || typeof data !== "object") return "SELF";
  const v = (x) => (x === "Y" || x === "YES" || x === "y" || x === "yes" || x === true || x === 1);
  const s = (x) => (typeof x === "string" && (x.includes("조직장") || x.includes("MANAGER")));
  if (data.emergencyOtpSendTo === "MANAGER") return "MANAGER";
  if (v(data.otpOrganizationalManagerReceiveYn)) return "MANAGER";
  if (v(data.otpManagerReceiveYn)) return "MANAGER";
  if (v(data.emergencyOtpManagerReceiveYn)) return "MANAGER";
  if (v(data.otpOrganizationalManagerYn)) return "MANAGER";
  if (s(data.otpReceiveTarget) || s(data.emergencyOtpReceiveTarget)) return "MANAGER";
  if (s(data.otpOrganizationalManagerReceiveYn)) return "MANAGER"; // 값이 "OTP조직장 수신" 등 문자열인 경우
  // 코드값: 2=조직장 등
  if (data.otpReceiveTargetCode === 2 || data.emergencyOtpReceiveType === "2") return "MANAGER";
  // 서버가 다른 키로 내려줄 수 있음 — 키명에 조직장/manager/organizational 포함이고 값이 수신/Y/true 면 MANAGER
  for (const key of Object.keys(data)) {
    const keyLower = key.toLowerCase();
    const isManagerKey = key.includes("조직장") || (keyLower.includes("otp") && (keyLower.includes("manager") || keyLower.includes("organ")));
    if (!isManagerKey) continue;
    const val = data[key];
    if (v(val)) return "MANAGER";
    if (typeof val === "string" && (val.includes("조직장") || val.includes("수신"))) return "MANAGER";
  }
  return "SELF";
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
    emergencyOtpSendTo: resolveEmergencyOtpSendTo(data),
    leaveSeatReasonYn: data.leaveSeatReasonYn ?? DEFAULT_WORK.leaveSeatReasonYn,
    leaveSeatReasonManYn: data.leaveSeatReasonManYn ?? DEFAULT_WORK.leaveSeatReasonManYn,
    leaveSeatOffInputMath: data.leaveSeatOffInputMath ?? null,
    leaveSeatDetectedAtStart: data.leaveSeatDetectedAtStart ?? null,
    leaveSeatDetectedAtEnd: data.leaveSeatDetectedAtEnd ?? null,
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
    // FR-14: 이석 화면(screenType=empty)일 때 값이 없으면 비밀번호 모달 기본 사용(기존 구현 동작)
    leaveSeatUnlockRequirePassword:
      data.leaveSeatUnlockRequirePassword !== undefined
        ? Boolean(data.leaveSeatUnlockRequirePassword)
        : ((data.screenType ?? "") === "empty")
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

  const detectedAt = work.leaveSeatDetectedAtStart
    ? formatDetectedAt(work.leaveSeatDetectedAtStart)
    : (work.leaveSeatOffInputMath && String(work.leaveSeatOffInputMath).length === 12
      ? formatDetectedAt(work.leaveSeatOffInputMath)
      : null);
  const detectedAtRange = formatDetectedAtRange(work);
  // leaveSeatOffInputMath: 0=미사용, 1=비근무입력, 2=자동근무이석, 3=근무/비근무 선택
  const leaveSeatOffInputMath = work.leaveSeatOffInputMath;
  const requireWorkNonWorkChoice = leaveSeatOffInputMath === 3 || leaveSeatOffInputMath === "3";

  return { isLeaveSeat, requireReason, isBreakTime, detectedAt, detectedAtRange, leaveSeatOffInputMath, requireWorkNonWorkChoice };
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

/** 이석 감지 구간 문구: "HH:mm ~ HH:mm 사이에 이석이 감지되었습니다" 또는 단일 시각 "HH:mm" */
function formatDetectedAtRange(work) {
  const start = work.leaveSeatDetectedAtStart;
  const end = work.leaveSeatDetectedAtEnd;
  if (start && end && String(start).length === 12 && String(end).length === 12) {
    return `${formatDetectedAt(start)} ~ ${formatDetectedAt(end)} 사이에 이석이 감지되었습니다.`;
  }
  if (start && String(start).length === 12) return `이석 감지 시각: ${formatDetectedAt(start)}`;
  if (work.leaveSeatOffInputMath && String(work.leaveSeatOffInputMath).length === 12) {
    return `이석 감지 시각: ${formatDetectedAt(work.leaveSeatOffInputMath)}`;
  }
  return null;
}

/**
 * 이석 사유 입력 모달을 표시하고 사용자가 입력한 사유 또는 취소 시 null 반환.
 * leaveSeatOffInputMath=3일 때 { reason, leaveSeatOffInputValue: 0|1 } 반환, 아니면 reason 문자열.
 */
function showLeaveSeatReasonModal(work) {
  const overlay = document.getElementById("leave-seat-modal");
  const input = document.getElementById("leave-seat-reason-input");
  const detectedAtEl = document.getElementById("leave-seat-detected-at");
  const workTypeEl = document.getElementById("leave-seat-work-type");
  const btnCancel = document.getElementById("leave-seat-modal-cancel");
  const btnConfirm = document.getElementById("leave-seat-modal-confirm");
  if (!overlay || !input) return Promise.resolve(null);

  if (work.detectedAtRange || work.detectedAt) {
    if (detectedAtEl) {
      detectedAtEl.textContent = work.detectedAtRange || `이석 감지 시각: ${work.detectedAt}`;
      detectedAtEl.style.display = "";
    }
  }
  if (workTypeEl) {
    workTypeEl.style.display = work.requireWorkNonWorkChoice ? "" : "none";
    const radios = workTypeEl.querySelectorAll('input[name="leave-seat-work-type"]');
    radios.forEach((r) => { r.checked = false; });
  }

  input.placeholder = work.requireReason ? "예: 회의 참석 (필수)" : "예: 회의 참석";
  input.required = !!work.requireReason;
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
      if (work.requireReason && !reason) {
        showToast("이석 사유를 입력해 주세요. (필수)");
        input.focus();
        return;
      }
      if (work.requireWorkNonWorkChoice) {
        const checked = workTypeEl?.querySelector('input[name="leave-seat-work-type"]:checked');
        if (!checked) {
          showToast("이석 구분(근무 이석/비근무 이석)을 선택해 주세요.");
          return;
        }
        close({ reason, leaveSeatOffInputValue: Number(checked.value) });
      } else {
        close(reason);
      }
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
 * @param {object} [policy] - calcLeaveSeatPolicy 결과. requireWorkNonWorkChoice 시 근무/비근무 선택 표시
 * @returns Promise<{ password: string; reason: string; leaveSeatOffInputValue?: number } | null> 확인 시 값, 취소 시 null
 */
function showLeaveSeatUnlockPasswordModal(policy) {
  const overlay = document.getElementById("leave-seat-unlock-modal");
  const passwordInput = document.getElementById("leave-seat-unlock-password");
  const reasonInput = document.getElementById("leave-seat-unlock-reason");
  const workTypeEl = document.getElementById("leave-seat-unlock-work-type");
  const btnCancel = document.getElementById("leave-seat-unlock-modal-cancel");
  const btnConfirm = document.getElementById("leave-seat-unlock-modal-confirm");
  if (!overlay || !passwordInput) return Promise.resolve(null);

  if (workTypeEl) {
    workTypeEl.style.display = (policy && policy.requireWorkNonWorkChoice) ? "" : "none";
    const radios = workTypeEl.querySelectorAll('input[name="leave-seat-unlock-work-type"]');
    radios.forEach((r) => { r.checked = false; });
  }
  if (reasonInput) {
    reasonInput.placeholder = (policy && policy.requireReason) ? "예: 회의 참석 (필수)" : "사유 (선택)";
    reasonInput.required = !!(policy && policy.requireReason);
    reasonInput.value = "";
  }
  passwordInput.value = "";
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
      const reason = (reasonInput?.value ?? "").trim();
      if (policy && policy.requireReason && !reason) {
        showToast("이석 사유를 입력해 주세요. (필수)");
        if (reasonInput) reasonInput.focus();
        return;
      }
      const result = { password, reason };
      if (policy && policy.requireWorkNonWorkChoice && workTypeEl) {
        const checked = workTypeEl.querySelector('input[name="leave-seat-unlock-work-type"]:checked');
        if (!checked) {
          showToast("이석 구분(근무 이석/비근무 이석)을 선택해 주세요.");
          return;
        }
        result.leaveSeatOffInputValue = Number(checked.value);
      }
      close(result);
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

/** PC-ON 후 stillLocked일 때 잠금화면을 시업/종업 화면으로 갱신 */
async function refreshLockScreenFromWorkTime() {
  if (!window.pcoffApi?.getWorkTime) return;
  try {
    const res = await window.pcoffApi.getWorkTime();
    if (res?.data) {
      currentWork = coerceWorkTimeFromApi(res.data);
      currentLeaveSeatPolicy = calcLeaveSeatPolicy(currentWork);
      applyLockScreenContent(currentWork);
      applyButtonDisp(currentWork);
      applyLockScreenImages(currentWork);
    }
  } catch (_) {}
}

async function runAction(label, action) {
  if (actionProgressOverlayEl) actionProgressOverlayEl.classList.remove("hidden");
  try {
    const result = await action();
    if (result?.stillLocked) {
      showToast("현재 PC-ON이 불가능합니다. 시업 시간에만 가능합니다.");
      await refreshLockScreenFromWorkTime();
      return result;
    }
    if (result?.success === false) {
      showToast(result?.error || `${label} 실패`);
      return result;
    }
    showToast(`${label} 완료`);
    return result;
  } catch (error) {
    showToast(`${label} 오류`);
    console.error(error);
    return undefined;
  } finally {
    if (actionProgressOverlayEl) actionProgressOverlayEl.classList.add("hidden");
  }
}

/** OTP 발송 옵션에 따른 안내 문구. SELF=본인 발송, MANAGER=조직장 발송 */
function getEmergencyOtpMessage(emergencyOtpSendTo) {
  return emergencyOtpSendTo === "MANAGER"
    ? "OTP가 조직장에게 발송되었습니다. 조직장으로부터 OTP를 전달받아 입력해주세요."
    : "스마트폰 푸시알람/메일/앱으로 발송된 OTP를 입력해주세요.";
}

/**
 * 긴급사용 안내 모달. OTP 발송 전 표시. 확인 시 true, 취소 시 false.
 * @param {string} message - 옵션에 따른 안내 문구 (본인/조직장)
 * @returns {Promise<boolean>}
 */
function showEmergencyIntroModal(message) {
  const overlay = document.getElementById("emergency-intro-modal");
  const descEl = document.getElementById("emergency-intro-desc");
  const btnCancel = document.getElementById("emergency-intro-cancel");
  const btnConfirm = document.getElementById("emergency-intro-confirm");
  if (!overlay || !descEl) return Promise.resolve(false);
  descEl.textContent = message || getEmergencyOtpMessage("SELF");
  overlay.classList.remove("hidden");

  return new Promise((resolve) => {
    const close = (value) => {
      overlay.classList.add("hidden");
      btnCancel.removeEventListener("click", onCancel);
      btnConfirm.removeEventListener("click", onConfirm);
      overlay.removeEventListener("click", onOverlayClick);
      resolve(value);
    };
    const onCancel = () => close(false);
    const onConfirm = () => close(true);
    const onOverlayClick = (e) => {
      if (e.target === overlay) close(false);
    };
    btnCancel.addEventListener("click", onCancel);
    btnConfirm.addEventListener("click", onConfirm);
    overlay.addEventListener("click", onOverlayClick);
  });
}

/**
 * 긴급사용 모달. serverPass가 있으면 이미 OTP 발송된 상태 → 인증번호 입력 + 사유 입력 후 확인 시 검증·사유 전송만.
 * @param {string|null} serverPass - Step1에서 받은 인증번호(있으면 모달만 검증·사유 전송, 없으면 사용 안 함)
 * @param {string} [otpMessage] - 옵션에 따른 안내 문구(본인/조직장). 없으면 기본 문구 사용
 */
function showEmergencyReasonModal(serverPass, otpMessage) {
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
  if (descEl) descEl.textContent = otpMessage || getEmergencyOtpMessage("SELF");
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

/**
 * 잠금화면 버튼 노출 조건
 * - 임시연장: screenType "off"(종업)일 때만. 시업전(before)에서는 숨김. 시업·종업 시각 이후이거나 pcExMaxCount > 0이면 표시.
 * - 긴급사용: screenType이 before/empty가 아니고, pcoffEmergencyYesNo === "YES"일 때.
 * - 긴급해제: 항상 DOM에 표시. eligible 여부는 getEmergencyUnlockEligibility(서버 emergencyUnlockUseYn=YES, emergencyUnlockPasswordSetYn=Y)로 활성/비활성만 구분.
 */
function applyButtonDisp(work) {
  const now = new Date();
  const startTime = parseYmdHm(work.pcOnYmdTime);
  const offTime = parseYmdHm(work.pcOffYmdTime);
  const st = (work.screenType ?? "").toLowerCase();

  switch (st) {
    case "before":
      // 시업전 잠금화면: 임시연장 버튼 숨김 (시업 전에는 연장 불가)
      setVisible(btnExtendEl, false);
      break;
    case "off": {
      // 종업 화면: 시업·종업 시각이 있고 현재가 종업 시각 이후이면 표시. 또는 임시연장 가능 횟수가 있으면 표시(시간 파싱 실패/데이터 부재 시에도 버튼 노출)
      // 단, pcExCount >= pcExMaxCount이면 임시연장 횟수 소진 → 버튼 숨김 (API: pcExCount < pcExMaxCount일 때만 호출)
      // 연장 허용 마감 시각(종업+최대연장시간) 초과 시에도 버튼 숨김 (예: 19시 종업·30분×2회 → 20시 이후 불가)
      const timeOk = Boolean(startTime && offTime && startTime <= now && offTime <= now);
      const maxCount = Number(work.pcExMaxCount ?? 0);
      const hasQuota = maxCount > 0 && Number(work.pcExCount ?? 0) < maxCount;
      const deadline = getTempExtendDeadline(work);
      const withinDeadline = !deadline || now <= deadline;
      setVisible(btnExtendEl, (timeOk || maxCount > 0) && hasQuota && withinDeadline);
      break;
    }
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
    let message = work.lockScreenLeaveMessage || work.pcOnMsg || fallback.leave.message;
    const detectedAtRange = formatDetectedAtRange(work);
    if (detectedAtRange) message = message ? `${message}\n${detectedAtRange}` : detectedAtRange;
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

// 현재 근태/이석 정책 (bootstrap·onLockInitialWork에서 갱신, PC-ON 등 클릭 시 사용)
let currentWork = null;
let currentLeaveSeatPolicy = { isLeaveSeat: false, requireReason: false, isBreakTime: false, detectedAt: null, detectedAtRange: null };

// 보조 잠금창: 메인에서 동일 근태/배경 데이터 수신 후 적용 (주모니터와 동일 문구·배경). 수신 시 currentWork/currentLeaveSeatPolicy 갱신해 PC-ON 분기(이석 비밀번호 등) 반영.
if (typeof window !== "undefined" && window.pcoffApi?.onLockInitialWork) {
  window.pcoffApi.onLockInitialWork((data) => {
    if (data && data.isSecondary === true) {
      lockIsSecondary = true;
      applySecondaryDisplayMode();
      hideOfflineOverlay();
    }
    currentWork = coerceWorkTimeFromApi(data);
    currentLeaveSeatPolicy = calcLeaveSeatPolicy(currentWork);
    if (extendCountEl) extendCountEl.textContent = String(currentWork.pcExCount ?? 0);
    applyLockInfo(currentWork);
    applyButtonDisp(currentWork);
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
  if (!btnEmergencyUnlockEl) return;
  try {
    if (window.pcoffApi?.getEmergencyUnlockEligibility) {
      const elig = await window.pcoffApi.getEmergencyUnlockEligibility();
      btnEmergencyUnlockEl.style.display = "";
      // 잠금 해제 대기 중(시도 제한)일 때만 비활성화. 미설정(eligible false)이어도 클릭 가능하게 해 모달에서 안내
      const inLockout = elig.isLockedOut && (elig.remainingLockoutMs ?? 0) > 0;
      btnEmergencyUnlockEl.disabled = inLockout;
      btnEmergencyUnlockEl.title = inLockout
        ? `시도 제한으로 ${Math.ceil((elig.remainingLockoutMs ?? 0) / 60000)}분 후에 다시 시도할 수 있습니다.`
        : (elig.eligible ? "" : "관리자가 긴급해제를 설정한 경우에만 사용할 수 있습니다.");
    } else {
      btnEmergencyUnlockEl.style.display = "";
      btnEmergencyUnlockEl.disabled = false;
      btnEmergencyUnlockEl.title = "";
    }
  } catch {
    btnEmergencyUnlockEl.style.display = "";
    btnEmergencyUnlockEl.disabled = false;
    btnEmergencyUnlockEl.title = "긴급해제 사용 불가";
  }
}

async function showEmergencyUnlockModal() {
  const overlay = document.getElementById("emergency-unlock-modal");
  const input = document.getElementById("emergency-unlock-password");
  const hintEl = document.getElementById("emergency-unlock-hint");
  const btnCancel = document.getElementById("emergency-unlock-cancel");
  const btnConfirm = document.getElementById("emergency-unlock-confirm");
  if (!overlay || !input) {
    showToast("잠금 해제 화면을 불러올 수 없습니다.");
    return;
  }

  if (!window.pcoffApi?.requestEmergencyUnlock) {
    showToast("긴급해제를 사용할 수 없습니다. 앱을 다시 시작해 보세요.");
    return;
  }

  if (window.pcoffApi?.getEmergencyUnlockEligibility) {
    const elig = await window.pcoffApi.getEmergencyUnlockEligibility();
    // 시도 제한(lockout) 중일 때만 모달 열기 차단. 미설정(eligible false)이어도 모달은 열고 확인 시 안내
    if (elig.isLockedOut && (elig.remainingLockoutMs ?? 0) > 0) {
      showToast(`시도 제한으로 ${Math.ceil((elig.remainingLockoutMs ?? 0) / 60000)}분 후에 다시 시도할 수 있습니다.`);
      return;
    }
  }

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
    // 자격 검사로 막지 않고 항상 서버에 해제 요청. 실패 시 메시지는 result.message로 표시
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

/** 긴급사용 버튼 클릭 — 먼저 OTP 옵션에 따른 안내 표시 → 확인 시에만 Step1(OTP 발송) 후 입력 화면으로 */
function setupEmergencyUseListener() {
  btnUseEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestEmergencyUseStep1) {
      showToast("긴급사용을 사용할 수 없습니다. 앱을 다시 시작해 보세요.");
      return;
    }
    btnUseEl.disabled = true;
    try {
      // OTP 발송 대상: Main에서 반환 (lastWorkTimeData 또는 config.emergencyOtpSendTo). getPcOffWorkTime에 필드 없어도 config로 조직장 수신 적용 가능
      let sendTo = DEFAULT_WORK.emergencyOtpSendTo;
      if (window.pcoffApi?.getEmergencyOtpSendTo) {
        try {
          const res = await window.pcoffApi.getEmergencyOtpSendTo();
          if (res?.emergencyOtpSendTo === "MANAGER" || res?.emergencyOtpSendTo === "SELF") sendTo = res.emergencyOtpSendTo;
        } catch (_) {}
      }
      if ((sendTo === DEFAULT_WORK.emergencyOtpSendTo) && (currentWork?.emergencyOtpSendTo === "MANAGER" || currentWork?.emergencyOtpSendTo === "SELF")) {
        sendTo = currentWork.emergencyOtpSendTo;
      }
      const introMessage = getEmergencyOtpMessage(sendTo);

      const confirmed = await showEmergencyIntroModal(introMessage);
      if (!confirmed) {
        btnUseEl.disabled = false;
        return;
      }

      const result = await window.pcoffApi.requestEmergencyUseStep1("긴급사용 요청");
      if (result?.success && result?.serverPass != null) {
        await showEmergencyReasonModal(result.serverPass, introMessage);
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
}

/* ──── FR-17: 오프라인 유예/잠금 UI ──── */
let offlineCountdownTimer = null;
/** 보조 모니터 잠금창 여부. true면 네트워크 끊김 팝업 미표시(주 모니터에서만 표시), 각종 버튼·근태정보 링크도 숨김. URL ?secondary=1 또는 lock-initial-work isSecondary로 설정 */
let lockIsSecondary = typeof window !== "undefined" && window.location && new URLSearchParams(window.location.search || "").get("secondary") === "1";

/** 보조 모니터 잠금창일 때 버튼(임시연장·긴급사용·긴급해제·PC-ON·PC-OFF)·나의 근태정보 불러오기 링크 숨김 */
function applySecondaryDisplayMode() {
  if (!lockIsSecondary || typeof document === "undefined") return;
  document.body.classList.add("lock-secondary-display");
}

function showOfflineOverlay(snapshot) {
  if (lockIsSecondary) return;
  const overlay = document.getElementById("offline-overlay");
  const titleEl = document.getElementById("offline-title");
  const descEl = document.getElementById("offline-desc");
  const countdownEl = document.getElementById("offline-countdown");
  const retryBtn = document.getElementById("offline-retry-btn");
  const retryInfoEl = document.getElementById("offline-retry-info");
  const graceUseBtn = document.getElementById("offline-grace-use-btn");
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
    if (descEl) descEl.textContent = "네트워크 없음으로 30분 후에 PC OFF됩니다.";
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
      } catch (e) {
        console.warn("retryConnectivity error:", e);
        showToast("재시도 실패");
      } finally {
        retryBtn.disabled = false;
        retryBtn.textContent = "다시 시도";
      }
    });
  }

  if (graceUseBtn && !graceUseBtn._graceUseBound) {
    graceUseBtn._graceUseBound = true;
    graceUseBtn.addEventListener("click", async () => {
      if (!window.pcoffApi?.requestOfflineGraceUse) return;
      try {
        graceUseBtn.disabled = true;
        const res = await window.pcoffApi.requestOfflineGraceUse();
        if (res?.success) {
          showToast("30분 동안 사용 가능합니다. 이후 다시 잠깁니다.");
          hideOfflineOverlay();
        }
      } catch (e) {
        console.warn("requestOfflineGraceUse error:", e);
        showToast("요청 실패");
      } finally {
        graceUseBtn.disabled = false;
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
  if (lockIsSecondary) applySecondaryDisplayMode();
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
      if (response.source === "fallback" && response.networkFailure) {
        showToast("네트워크 없음으로 30분 후에 PC OFF됩니다");
      }
    } catch (error) {
      showToast(`근태정보 조회 실패: ${String(error)}`);
    }
  }
  if (extendCountEl) extendCountEl.textContent = String(work.pcExCount);
  applyLockInfo(work);
  applyButtonDisp(work);

  // 이석 정책 계산 (사유 필수 여부 / 휴게시간 여부). PC-ON 등 클릭 시 사용할 currentWork/currentLeaveSeatPolicy 갱신
  currentWork = work;
  currentLeaveSeatPolicy = calcLeaveSeatPolicy(work);

  // 이석 상태일 때 UI 힌트 추가 (휴게시간 면제 안내)
  if (currentLeaveSeatPolicy.isLeaveSeat && currentLeaveSeatPolicy.isBreakTime) {
    showToast("휴게시간 중: 사유 입력 없이 PC-ON 가능");
  }

  btnExtendEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestPcExtend) return showToast("preview 모드: 임시연장");
    const w = currentWork || work;
    await runAction("임시연장", () => window.pcoffApi.requestPcExtend(w.pcOffYmdTime));
  });
  // 긴급사용 리스너는 setupEmergencyUseListener()에서 스크립트 로드 시 이미 등록됨
  btnPlayEl?.addEventListener("click", async () => {
    if (!window.pcoffApi?.requestPcOnOffLog) return showToast("preview 모드: PC-ON");
    // PC-ON 클릭 시점에 최신 근태 조회해 이석·비밀번호 여부 판단 (bootstrap/onLockInitialWork 순서 이슈 회피)
    let w = currentWork || work;
    let policy = currentLeaveSeatPolicy;
    if (window.pcoffApi?.getWorkTime) {
      try {
        const res = await window.pcoffApi.getWorkTime();
        if (res?.data) {
          w = coerceWorkTimeFromApi(res.data);
          policy = calcLeaveSeatPolicy(w);
        }
      } catch (_) {}
    }

    // FR-14: 이석 시 설정(leaveSeatUnlockRequirePassword)이 true이거나 미설정이면 비밀번호 모달 후 검증 PC-ON (false로 둔 경우만 스킵)
    const needLeaveSeatPassword = policy.isLeaveSeat && (w.leaveSeatUnlockRequirePassword === true || (w.leaveSeatUnlockRequirePassword !== false && window.pcoffApi?.requestPcOnWithLeaveSeatUnlock));
    if (needLeaveSeatPassword && window.pcoffApi?.requestPcOnWithLeaveSeatUnlock) {
      const result = await showLeaveSeatUnlockPasswordModal(policy);
      if (!result) return;
      if (actionProgressOverlayEl) actionProgressOverlayEl.classList.remove("hidden");
      try {
        const res = await window.pcoffApi.requestPcOnWithLeaveSeatUnlock(result.password, result.reason || undefined, result.leaveSeatOffInputValue);
        if (res?.success === false) {
          showToast(res?.error || "비밀번호가 맞지 않습니다.");
          return;
        }
        if (res?.stillLocked) {
          showToast("이석 해제되었습니다. 근무 시간이 아니면 PC-ON이 반영되지 않을 수 있습니다.", 5500);
          await refreshLockScreenFromWorkTime();
        } else {
          showToast("PC-ON (이석 해제) 완료", 3500);
        }
      } catch (e) {
        showToast("PC-ON (이석 해제) 오류");
        console.error(e);
      } finally {
        if (actionProgressOverlayEl) actionProgressOverlayEl.classList.add("hidden");
      }
      return;
    }

    // 이석 상태이고 사유 입력이 필요한 경우 → 모달 표시
    if (policy.requireReason) {
      const reasonResult = await showLeaveSeatReasonModal(policy);
      if (reasonResult == null) return; // 취소
      const reason = typeof reasonResult === "string" ? reasonResult : reasonResult.reason;
      const leaveSeatOffInputValue = typeof reasonResult === "object" ? reasonResult.leaveSeatOffInputValue : undefined;
      if (typeof reason !== "string" || reason === "") return;
      await runAction("PC-ON (이석해제)", () =>
        window.pcoffApi.requestPcOnOffLog("IN", "Lock Off - 이석해제", reason, true, leaveSeatOffInputValue)
      );
      return;
    }

    // 이석 상태이지만 사유 면제 (휴게시간 중)
    if (policy.isLeaveSeat && policy.isBreakTime) {
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
  getAttendEl?.addEventListener("click", () => openAttendPanel(currentWork || work));
  document.getElementById("close-attend")?.addEventListener("click", () => {
    if (attendPanelEl) attendPanelEl.classList.remove("active");
  });

  setupPasswordChangeListener();
  setupConnectivityListener();
  void checkEmergencyUnlockEligibility();

  // 잠금화면 로그
  if (window.pcoffApi?.logEvent) {
    window.pcoffApi.logEvent("LOCK_SCREEN_OPENED", { screenType: work.screenType });

    // 이석 상태이면 LEAVE_SEAT_DETECTED 로그
    if (currentLeaveSeatPolicy.isLeaveSeat) {
      window.pcoffApi.logEvent("LEAVE_SEAT_DETECTED", {
        detectedAt: currentLeaveSeatPolicy.detectedAt,
        requireReason: currentLeaveSeatPolicy.requireReason,
        isBreakTime: currentLeaveSeatPolicy.isBreakTime
      });
    }
  }
}

// 긴급해제·긴급사용 클릭 리스너는 스크립트 로드 시 바로 등록(bootstrap 완료 전에도 클릭 반응)
setupEmergencyUnlockListeners();
setupEmergencyUseListener();

void bootstrap();
