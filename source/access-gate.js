import "./access-gate.css";
import { grantAccess, isAccessGranted, verifyAccessPassword } from "./access-policy.js";

const root = document.getElementById("root");
let applicationPromise = null;

if (!root) {
  throw new Error("접근 화면을 표시할 영역이 없습니다.");
}

if (isAccessGranted()) {
  await loadApplication();
} else {
  renderAccessGate();
}

async function loadApplication() {
  if (applicationPromise) return applicationPromise;

  document.body.classList.remove("access-gate-active");
  root.replaceChildren();
  applicationPromise = import("./public-app.js");

  try {
    await applicationPromise;
    return true;
  } catch (error) {
    applicationPromise = null;
    renderAccessGate("화면을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.");
    console.error(error);
    return false;
  }
}

function renderAccessGate(initialMessage = "") {
  document.body.classList.add("access-gate-active");
  root.innerHTML = `
    <main class="access-gate-shell">
      <section class="access-gate-panel" aria-labelledby="access-gate-title">
        <div class="access-gate-brand">
          <img src="./favicon.svg" alt="" width="56" height="56" />
          <div>
            <p class="access-gate-eyebrow">비공개 시험 운영</p>
            <h1 id="access-gate-title">기후 타임캡슐</h1>
          </div>
        </div>
        <p class="access-gate-copy">초대받은 사용자만 접속할 수 있습니다.</p>
        <form class="access-gate-form" novalidate>
          <label for="access-password">접속 암호</label>
          <input
            id="access-password"
            name="password"
            type="password"
            autocomplete="current-password"
            aria-describedby="access-gate-status"
            required
          />
          <p id="access-gate-status" class="access-gate-status" aria-live="polite"></p>
          <button type="submit">입장</button>
        </form>
      </section>
    </main>
  `;

  const form = root.querySelector(".access-gate-form");
  const input = root.querySelector("#access-password");
  const button = form?.querySelector("button[type='submit']");
  const status = root.querySelector("#access-gate-status");

  if (initialMessage && status) setStatus(status, initialMessage, true);
  input?.focus();
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input || !button || !status) return;

    if (!input.value) {
      setStatus(status, "접속 암호를 입력하세요.", true);
      input.focus();
      return;
    }

    setFormBusy(form, button, true);
    setStatus(status, "암호를 확인하고 있습니다.");

    try {
      const accepted = await verifyAccessPassword(input.value);
      input.value = "";
      if (!accepted) {
        setStatus(status, "암호가 올바르지 않습니다. 대소문자와 특수문자를 확인하세요.", true);
        setFormBusy(form, button, false);
        input.focus();
        return;
      }

      grantAccess();
      setStatus(status, "확인되었습니다. 화면을 준비하고 있습니다.");
      await loadApplication();
    } catch (error) {
      if (error?.message === "secure-crypto-unavailable") {
        setStatus(status, "이 브라우저에서는 암호를 안전하게 확인할 수 없습니다. 최신 브라우저로 다시 접속하세요.", true);
        setFormBusy(form, button, false);
        return;
      }
      setStatus(status, "화면을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.", true);
      setFormBusy(form, button, false);
    }
  });
}

function setFormBusy(form, button, busy) {
  form.setAttribute("aria-busy", String(busy));
  button.disabled = busy;
  button.textContent = busy ? "확인 중" : "입장";
}

function setStatus(status, message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
  if (isError) status.setAttribute("role", "alert");
  else status.removeAttribute("role");
}
