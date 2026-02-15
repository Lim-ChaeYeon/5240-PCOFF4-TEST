const loginViewEl = document.getElementById("login-view");
const mainViewEl = document.getElementById("main-view");
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
const checkUpdateEl = document.getElementById("check-update");
const userDisplayEl = document.getElementById("user-display");

function showView(name) {
  if (loginViewEl) loginViewEl.classList.toggle("hidden", name !== "login");
  if (mainViewEl) mainViewEl.classList.toggle("hidden", name !== "main");
}

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

/** 긴급사용 사유 입력 모달 표시 (prompt 대체). 확인 시 사유 문자열, 취소 시 null */
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
  dateTextEl.textContent = dateText;
  timeTextEl.textContent = timeText;
}

function openAttendPanel(work) {
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
    lockTitleEl.textContent = work.pcOnMsg;
    lockInfoEl.textContent = "긴급사용 또는 휴일근무신청을 한 경우 PC-ON 하여 주세요.";
    return;
  }

  if (work.screenType === "before" || (startTime && now < startTime)) {
    lockTitleEl.textContent = "시업 전 잠금 상태입니다.";
    lockInfoEl.textContent = `PC 사용가능시간은 ${hm(work.pcOnYmdTime)}~${hm(work.pcOffYmdTime)}입니다.`;
    return;
  }

  if (work.screenType === "empty") {
    lockTitleEl.textContent = "이석 감지 상태입니다.";
    lockInfoEl.textContent = "이석 사유 확인 후 PC-ON 하여 주세요.";
    return;
  }

  lockTitleEl.textContent = "PC 사용이 종료되었습니다.";
  if (offTime && now >= offTime) {
    lockInfoEl.textContent = `임시연장은 PC-OFF 시간부터 ${work.pcExTime}분씩 ${work.pcExMaxCount}회 사용할 수 있습니다.`;
  } else {
    lockInfoEl.textContent = `PC 사용가능시간은 ${hm(work.pcOnYmdTime)}~${hm(work.pcOffYmdTime)}입니다.`;
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
  stateBadgeEl.textContent = `state: ${currentState}`;

  if (window.pcoffApi?.getCurrentUser && userDisplayEl) {
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

  let work = parseQueryWork();
  if (window.pcoffApi?.getWorkTime) {
    try {
      const response = await window.pcoffApi.getWorkTime();
      work = { ...work, ...coerceWorkTimeFromApi(response.data) };
      stateBadgeEl.textContent = `state: ${currentState} (${response.source})`;
    } catch (error) {
      showToast(`근태정보 조회 실패: ${String(error)}`);
    }
  }
  extendCountEl.textContent = String(work.pcExCount);
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
  document.getElementById("close-attend")?.addEventListener("click", () => attendPanelEl.classList.remove("active"));

  // 업데이트 버튼 및 상태 표시
  if (window.pcoffApi) {
    checkUpdateEl?.addEventListener("click", async () => {
      checkUpdateEl.disabled = true;
      checkUpdateEl.textContent = "확인 중...";
      try {
        const status = await window.pcoffApi.requestUpdateCheck();
        updateCheckButton(status);
      } catch (e) {
        showToast("업데이트 확인 오류");
        checkUpdateEl.disabled = false;
        checkUpdateEl.textContent = "업데이트 확인";
      }
    });

    // 업데이트 진행률 실시간 수신
    if (window.pcoffApi.onUpdateProgress) {
      window.pcoffApi.onUpdateProgress((data) => {
        const pct = Math.round(data.percent);
        checkUpdateEl.textContent = `다운로드 ${pct}%`;
      });
    }

    // 앱 버전 표시
    if (window.pcoffApi.getAppVersion) {
      window.pcoffApi.getAppVersion().then((ver) => {
        const versionEl = document.getElementById("app-version");
        if (versionEl) versionEl.textContent = `v${ver}`;
      });
    }
  } else {
    checkUpdateEl?.addEventListener("click", () => showToast("preview 모드: update check"));
  }
}

/** 업데이트 상태에 따라 버튼 텍스트 업데이트 */
function updateCheckButton(status) {
  const checkUpdateEl = document.getElementById("check-update");
  if (!checkUpdateEl) return;

  switch (status.state) {
    case "checking":
      checkUpdateEl.textContent = "확인 중...";
      checkUpdateEl.disabled = true;
      break;
    case "available":
      checkUpdateEl.textContent = `v${status.version} 다운로드 중`;
      checkUpdateEl.disabled = true;
      break;
    case "downloading":
      checkUpdateEl.textContent = `다운로드 ${status.progress ?? 0}%`;
      checkUpdateEl.disabled = true;
      break;
    case "downloaded":
      checkUpdateEl.textContent = "재시작 대기";
      checkUpdateEl.disabled = true;
      showToast("업데이트 다운로드 완료, 곧 재시작됩니다");
      break;
    case "not-available":
      checkUpdateEl.textContent = "최신 버전";
      checkUpdateEl.disabled = false;
      showToast("현재 최신 버전입니다");
      setTimeout(() => {
        checkUpdateEl.textContent = "업데이트 확인";
      }, 3000);
      break;
    case "error":
      checkUpdateEl.textContent = "업데이트 오류";
      checkUpdateEl.disabled = false;
      showToast(status.error || "업데이트 확인 실패");
      setTimeout(() => {
        checkUpdateEl.textContent = "업데이트 확인";
      }, 3000);
      break;
    default:
      checkUpdateEl.textContent = "업데이트 확인";
      checkUpdateEl.disabled = false;
  }
}

function setupLoginFlow() {
  const step1 = document.getElementById("login-step1");
  const step2 = document.getElementById("login-step2");
  const phoneInput = document.getElementById("login-phone");
  const servareaSelect = document.getElementById("login-servarea");
  const useridInput = document.getElementById("login-userid");
  const passwordInput = document.getElementById("login-password");
  const step1Error = document.getElementById("login-step1-error");
  const step2Error = document.getElementById("login-step2-error");
  let servareaList = [];
  let userMobileNo = "";

  document.getElementById("login-next")?.addEventListener("click", async () => {
    userMobileNo = (phoneInput?.value ?? "").trim().replace(/-/g, "");
    step1Error.textContent = "";
    if (!userMobileNo) {
      step1Error.textContent = "전화번호를 입력해 주세요.";
      return;
    }
    if (!window.pcoffApi?.getServareaInfo) {
      step1Error.textContent = "Preload가 로드되지 않았습니다. 터미널에서 npm start 실행 후 [PCOFF] Preload 로그를 확인하고, 문제 시 개발자 도구(Cmd+Option+I) 콘솔을 확인해 주세요.";
      return;
    }
    const res = await window.pcoffApi.getServareaInfo(userMobileNo);
    if (!res.success) {
      step1Error.textContent = res.error ?? "서비스 영역 조회에 실패했습니다.";
      return;
    }
    servareaList = res.list ?? [];
    servareaSelect.innerHTML = "";
    const validItems = [];
    for (const item of servareaList) {
      const id =
        item.userServareaId ??
        item.servareaId ??
        item.servareaCd ??
        item.id ??
        "";
      const nm =
        (item.servareaNm ??
          item.servareaName ??
          item.name ??
          item.servareaCd ??
          id) || "(서비스 영역)";
      if (!id && !nm) continue;
      validItems.push({ id, nm });
      const opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = String(nm);
      servareaSelect?.appendChild(opt);
    }
    if (validItems.length === 0) {
      step1Error.textContent =
        "등록된 서비스 영역이 없습니다. 전화번호가 서버에 등록되어 있는지 확인해 주세요. (개발자 도구 네트워크 탭에서 getPcOffServareaInfo.do 응답을 확인할 수 있습니다.)";
      return;
    }
    step1?.classList.add("hidden");
    step2?.classList.remove("hidden");
  });

  document.getElementById("login-back")?.addEventListener("click", () => {
    step2Error.textContent = "";
    step2?.classList.add("hidden");
    step1?.classList.remove("hidden");
  });

  document.getElementById("login-submit")?.addEventListener("click", async () => {
    const loginServareaId = servareaSelect?.value ?? "";
    const loginUserId = (useridInput?.value ?? "").trim();
    const loginPassword = passwordInput?.value ?? "";
    step2Error.textContent = "";
    if (!loginUserId || !loginPassword) {
      step2Error.textContent = "사용자 ID와 비밀번호를 입력해 주세요.";
      return;
    }
    if (!window.pcoffApi?.login) return;
    const res = await window.pcoffApi.login({
      userMobileNo,
      loginServareaId,
      loginUserId,
      loginPassword
    });
    if (!res.success) {
      step2Error.textContent = res.error ?? "로그인에 실패했습니다.";
      return;
    }
    showToast(res.loginUserNm ? `${res.loginUserNm}님 로그인됨` : "로그인 성공");
    showView("main");
    bootstrap();
  });
}

function setupLogoutHotkey() {
  document.addEventListener("keydown", (e) => {
    if (!window.pcoffApi?.logout) return;
    const isLogout = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key?.toLowerCase() === "l";
    if (!isLogout) return;
    e.preventDefault();
    window.pcoffApi.logout().then((res) => {
      if (res?.success) {
        showView("login");
        setupLoginFlow();
        showToast("로그아웃됨 (개발자 핫키)");
      }
    });
  });
}

/**
 * FR-04: 비밀번호 변경 확인 모달 표시
 * 비밀번호 검증 없이 확인만 수행
 */
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

    // FR-04: 확인 API 호출 (비밀번호 검증 없음)
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
    // 모달 외부 클릭 시에도 확인 처리 (강제 닫기 방지 - 확인만 가능)
    // 단, 사용자 편의를 위해 외부 클릭도 확인으로 처리
    if (e.target === overlay) close();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape" || e.key === "Enter") close();
  };

  btnConfirm?.addEventListener("click", onConfirm);
  overlay.addEventListener("click", onOverlayClick);
  document.addEventListener("keydown", onKeydown);
}

/**
 * 비밀번호 변경 이벤트 리스너 설정
 */
function setupPasswordChangeListener() {
  if (!window.pcoffApi?.onPasswordChangeDetected) return;

  window.pcoffApi.onPasswordChangeDetected((data) => {
    showPasswordChangeModal(data.message);
  });

  // 앱 시작 시 이미 비밀번호 변경이 감지된 상태인지 확인
  if (window.pcoffApi.getPasswordChangeState) {
    window.pcoffApi.getPasswordChangeState().then((state) => {
      if (state.detected) {
        showPasswordChangeModal(state.message);
      }
    });
  }
}

async function init() {
  setupLogoutHotkey();
  setupPasswordChangeListener(); // FR-04: 비밀번호 변경 이벤트 리스너
  if (!window.pcoffApi) {
    showView("login");
    setupLoginFlow();
    return;
  }
  try {
    const { hasLogin } = await window.pcoffApi.hasLogin();
    if (hasLogin) {
      showView("main");
      bootstrap();
    } else {
      showView("login");
      setupLoginFlow();
    }
  } catch (e) {
    showView("main");
    bootstrap();
  }
}

void init();
