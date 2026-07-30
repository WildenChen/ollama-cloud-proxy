import {
  deriveCredentialKeyState,
  deriveUsageCookieState,
  matchesCredentialFilter,
  summarizeCredentials,
} from "./credential-status.js";

const guideRoot = document.getElementById("credentialGuideRoot");
const filterRoot = document.getElementById("keyFilterRoot");
const usageRoot = document.getElementById("usageOverview");
const clientKeyList = document.getElementById("clientKeyList");
const keyForm = document.getElementById("keyForm");
const clientKeyForm = document.getElementById("clientKeyForm");
const filterStorageKey = "ollamaProxyCredentialFilter";

const words = {
  "zh-Hant": {
    title: "憑證設定指南",
    description: "三種憑證用途不同。工具端只填 Client API Key，不要填上游 API Key 或 Usage Cookie。",
    upstreamTitle: "上游帳號｜Ollama Cloud API Key",
    upstreamPurpose: "代理服務用它連接 Ollama Cloud。只在管理台新增，不要填進 OpenClaw、VS Code 或其他工具。",
    usageTitle: "用量讀取｜Usage Cookie",
    usagePurpose: "選填。只用來讀取官方 5hr／每週用量；未設定仍可正常使用模型代理。",
    clientTitle: "工具連線｜Client API Key",
    clientPurpose: "OpenClaw、VS Code 與其他工具連接本服務時使用。完整 token 只在建立或更換時顯示一次。",
    upstreamCount: (available, total) => `${available}/${total} 可用`,
    usageCount: (count, total) => `${count}/${total} 已設定`,
    clientCount: (count) => `${count} 把已啟用`,
    addUpstream: "新增上游金鑰",
    manageUsage: "管理 Usage Cookie",
    createClient: "建立 Client API Key",
    filterTitle: "金鑰狀態篩選",
    all: "全部",
    available: "可用",
    attention: "需要注意",
    disabled: "已停用",
    noCookie: "未設定 Cookie",
    noFilterResult: "目前沒有符合此篩選條件的金鑰。",
    verifying: "正在驗證新加入的 Ollama Cloud API Key…",
    verifySuccess: "Ollama Cloud API Key 驗證成功，已可處理請求。",
    verifyInvalid: "Ollama Cloud API Key 驗證失敗。請確認金鑰是否有效或已被撤銷。",
    verifyNetwork: "暫時無法連上 Ollama Cloud。金鑰已保存，可稍後按「測試」重試。",
    availableState: "驗證成功，可處理模型請求",
    pendingState: "尚未驗證，請按「測試」確認",
    invalidState: "API Key 無效或已撤銷，請更換金鑰",
    disabledState: "已停用，不會被代理選用",
    sessionBlockedState: "5 小時額度已用完",
    weeklyBlockedState: "每週額度已用完",
    coolingState: "暫時冷卻中",
    temporaryRetryState: "上游暫時異常，系統稍後可重試",
    recoveryAt: (value) => `預計 ${value} 恢復`,
    usageReady: "官方用量已同步",
    usageStale: "本次用量讀取失敗；保留上次成功資料，不影響模型",
    usagePending: "Cookie 已設定，等待讀取官方用量",
    usageError: "Cookie 讀取失敗；只影響用量顯示，不影響模型",
    noCookieState: "未設定 Cookie；模型代理仍可正常使用",
    oneTimeTitle: "請立即保存 Client API Key",
    oneTimeDescription: "完整 token 只在這個畫面顯示。關閉後管理台只保留前綴預覽；遺失時請更換金鑰。",
    copy: "複製完整金鑰",
    copied: "已複製",
    done: "我已保存，關閉",
    createFailed: "Client API Key 建立失敗",
    rotateFailed: "Client API Key 更換失敗",
    rotateConfirm: "確定要更換 Client API Key？舊 token 會立即失效，使用此金鑰的工具都必須更新。",
    tokenUnavailable: "無法取得一次性 token，請建立替代金鑰並測試成功後，再停用舊金鑰。",
    loginRequired: "請先登入管理台再修改憑證。",
  },
  en: {
    title: "Credential setup guide",
    description: "Each credential has a different purpose. Clients should use only a Client API Key.",
    upstreamTitle: "Upstream account | Ollama Cloud API Key",
    upstreamPurpose: "The proxy uses it to reach Ollama Cloud. Add it only in Admin; never paste it into client tools.",
    usageTitle: "Usage reader | Usage Cookie",
    usagePurpose: "Optional. It only reads official 5-hour and weekly usage; model proxying works without it.",
    clientTitle: "Client connection | Client API Key",
    clientPurpose: "OpenClaw, VS Code, and other clients use it to connect here. The full token is shown only when created or rotated.",
    upstreamCount: (available, total) => `${available}/${total} available`,
    usageCount: (count, total) => `${count}/${total} configured`,
    clientCount: (count) => `${count} enabled`,
    addUpstream: "Add upstream key",
    manageUsage: "Manage Usage Cookie",
    createClient: "Create Client API Key",
    filterTitle: "Filter key status",
    all: "All",
    available: "Available",
    attention: "Needs attention",
    disabled: "Disabled",
    noCookie: "Cookie missing",
    noFilterResult: "No keys match this filter.",
    verifying: "Verifying the new Ollama Cloud API Key…",
    verifySuccess: "The Ollama Cloud API Key is valid and ready for requests.",
    verifyInvalid: "The Ollama Cloud API Key failed verification. Check whether it is valid or revoked.",
    verifyNetwork: "Ollama Cloud is temporarily unreachable. The key was saved; use Test to retry later.",
    availableState: "Verified and ready for model requests",
    pendingState: "Not verified yet; use Test to check it",
    invalidState: "API Key is invalid or revoked; replace it",
    disabledState: "Disabled and excluded from proxy selection",
    sessionBlockedState: "5-hour quota is exhausted",
    weeklyBlockedState: "Weekly quota is exhausted",
    coolingState: "Temporarily cooling down",
    temporaryRetryState: "Temporary upstream issue; retry later",
    recoveryAt: (value) => `Expected recovery ${value}`,
    usageReady: "Official usage is synchronized",
    usageStale: "This usage refresh failed; keeping the last successful data and model proxying is unaffected",
    usagePending: "Cookie is set; waiting for official usage",
    usageError: "Cookie read failed; model proxying is unaffected",
    noCookieState: "Cookie is not set; model proxying still works",
    oneTimeTitle: "Save this Client API Key now",
    oneTimeDescription: "The full token is shown only here. After closing, Admin keeps only a preview; rotate it if lost.",
    copy: "Copy full key",
    copied: "Copied",
    done: "I saved it, close",
    createFailed: "Client API Key creation failed",
    rotateFailed: "Client API Key rotation failed",
    rotateConfirm: "Rotate this Client API Key? The old token stops working immediately and every client must be updated.",
    tokenUnavailable: "The one-time token could not be retrieved. Create and test a replacement before disabling the old key.",
    loginRequired: "Sign in to Admin before changing credentials.",
  },
};

let snapshot = { cards: [], clientKeys: [], authenticated: false };
let currentFilter = localStorage.getItem(filterStorageKey) || "all";
let refreshTimer = null;
let pendingUpstreamCreate = null;
let verificationRunning = false;
let tokenDialog = null;

function locale() {
  return document.documentElement.lang === "en" ? "en" : "zh-Hant";
}

function w(key) {
  return words[locale()][key];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.error?.code || null;
    throw error;
  }
  return data;
}

async function loadSnapshot() {
  if (!guideRoot || !filterRoot) return;
  try {
    const [auth, stats] = await Promise.all([
      request("/admin/auth/status"),
      request("/admin/stats"),
    ]);
    let clientKeys = [];
    if (auth.authenticated) {
      const clientResponse = await request("/admin/client-keys");
      clientKeys = clientResponse.clientKeys || [];
    }
    snapshot = {
      authenticated: auth.authenticated === true,
      cards: stats?.usage?.overview?.keyCards || [],
      clientKeys,
    };
    renderGuide();
    decorateKeyCards();
    await tryAutoVerifyNewKey();
  } catch {
    snapshot = { cards: [], clientKeys: [], authenticated: false };
    renderGuide();
  }
}

function renderGuide() {
  if (!guideRoot) return;
  const summary = summarizeCredentials({ keyCards: snapshot.cards, clientKeys: snapshot.clientKeys });
  guideRoot.innerHTML = `
    <section class="panel credentialGuide" aria-labelledby="credentialGuideTitle">
      <div class="credentialGuideHeader">
        <div>
          <span class="eyebrow">${escapeHtml(w("title"))}</span>
          <h2 id="credentialGuideTitle">${escapeHtml(w("title"))}</h2>
          <p>${escapeHtml(w("description"))}</p>
        </div>
      </div>
      <div class="credentialGuideGrid">
        ${credentialCard("upstream", w("upstreamTitle"), w("upstreamPurpose"), w("upstreamCount")(summary.upstreamAvailable, summary.upstreamTotal), w("addUpstream"), "add-upstream")}
        ${credentialCard("usage", w("usageTitle"), w("usagePurpose"), w("usageCount")(summary.usageCookies, summary.upstreamTotal), w("manageUsage"), "manage-usage")}
        ${credentialCard("client", w("clientTitle"), w("clientPurpose"), w("clientCount")(summary.clientKeysEnabled), w("createClient"), "create-client")}
      </div>
      <div id="credentialAnnouncement" class="credentialAnnouncement hidden" role="status" aria-live="polite"></div>
    </section>
  `;

  filterRoot.innerHTML = `
    <section class="credentialFilterBar" aria-label="${escapeHtml(w("filterTitle"))}">
      <strong>${escapeHtml(w("filterTitle"))}</strong>
      <div class="credentialFilterButtons">
        ${filterButton("all", w("all"), summary.upstreamTotal)}
        ${filterButton("available", w("available"), summary.upstreamAvailable)}
        ${filterButton("attention", w("attention"), summary.upstreamAttention)}
        ${filterButton("disabled", w("disabled"), snapshot.cards.filter((card) => deriveCredentialKeyState(card).category === "disabled").length)}
        ${filterButton("no-cookie", w("noCookie"), snapshot.cards.filter((card) => deriveUsageCookieState(card).category === "no-cookie").length)}
      </div>
    </section>
  `;
}

function credentialCard(kind, title, description, count, actionLabel, action) {
  return `
    <article class="credentialTypeCard ${escapeHtml(kind)}">
      <div class="credentialTypeHeading">
        <span class="credentialTypeIcon" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(count)}</span>
        </div>
      </div>
      <p>${escapeHtml(description)}</p>
      <button class="button compact" type="button" data-credential-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>
    </article>
  `;
}

function filterButton(value, label, count) {
  return `<button class="credentialFilterButton ${currentFilter === value ? "active" : ""}" type="button" data-credential-filter="${escapeHtml(value)}" aria-pressed="${currentFilter === value}">${escapeHtml(label)} <span>${count}</span></button>`;
}

function decorateKeyCards() {
  if (!usageRoot) return;
  const byId = new Map(snapshot.cards.map((card) => [String(card.id), card]));
  const elements = [...usageRoot.querySelectorAll(".officialQuotaCard[data-key-id]")];
  let visibleCount = 0;

  for (const element of elements) {
    const card = byId.get(String(element.dataset.keyId));
    if (!card) continue;
    const keyState = deriveCredentialKeyState(card);
    const cookieState = deriveUsageCookieState(card);
    const visible = matchesCredentialFilter(card, currentFilter);
    element.classList.toggle("credentialFilteredOut", !visible);
    element.dataset.credentialState = keyState.category;
    element.dataset.cookieState = cookieState.category;
    if (visible) visibleCount += 1;

    const existing = element.querySelector(".credentialHumanState");
    const html = humanStateHtml(card, keyState, cookieState);
    if (existing) {
      if (existing.outerHTML !== html) existing.outerHTML = html;
    } else {
      element.querySelector(".officialQuotaHeader")?.insertAdjacentHTML("afterend", html);
    }
  }

  let empty = usageRoot.querySelector(".credentialFilterEmpty");
  if (elements.length > 0 && visibleCount === 0) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "credentialFilterEmpty empty";
      usageRoot.querySelector(".officialQuotaGrid")?.appendChild(empty);
    }
    empty.textContent = w("noFilterResult");
  } else {
    empty?.remove();
  }

  hidePersistentClientTokenReveal();
}

function humanStateHtml(card, keyState, cookieState) {
  const keyText = localizedKeyState(keyState);
  const cookieText = localizedCookieState(cookieState);
  const recovery = keyState.recoveryAt ? `<span>${escapeHtml(w("recoveryAt")(formatRecovery(keyState.recoveryAt)))}</span>` : "";
  return `<div class="credentialHumanState ${escapeHtml(keyState.tone)}"><div><strong>${escapeHtml(keyText)}</strong>${recovery}</div><small class="${escapeHtml(cookieState.tone)}">${escapeHtml(cookieText)}</small></div>`;
}

function localizedKeyState(state) {
  if (state.label === "available") return w("availableState");
  if (state.label === "invalid") return w("invalidState");
  if (state.label === "disabled") return w("disabledState");
  if (state.label === "session_blocked") return w("sessionBlockedState");
  if (state.label === "weekly_blocked") return w("weeklyBlockedState");
  if (state.label === "temporary_retry") return w("temporaryRetryState");
  if (state.label === "cooling_down") return w("coolingState");
  return w("pendingState");
}

function localizedCookieState(state) {
  if (state.label === "usage_ready") return w("usageReady");
  if (state.label === "usage_stale") return w("usageStale");
  if (state.label === "usage_pending") return w("usagePending");
  if (state.label === "usage_error") return w("usageError");
  return w("noCookieState");
}

function formatRecovery(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "-");
  return new Intl.DateTimeFormat(locale() === "en" ? "en-US" : "zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function announce(message, kind = "info") {
  const root = document.getElementById("credentialAnnouncement");
  if (!root) return;
  root.textContent = message;
  root.className = `credentialAnnouncement ${kind}`;
  root.classList.remove("hidden");
}

function scheduleSnapshot(delay = 450) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(loadSnapshot, delay);
}

function clickPage(page) {
  document.querySelector(`.tab[data-page="${page}"]`)?.click();
}

function runCredentialAction(action) {
  if (!snapshot.authenticated) {
    clickPage("settings");
    announce(w("loginRequired"), "warning");
    return;
  }
  if (action === "add-upstream") {
    clickPage("overview");
    window.setTimeout(() => document.getElementById("addKeyButton")?.click(), 80);
    return;
  }
  if (action === "manage-usage") {
    clickPage("overview");
    window.setTimeout(() => {
      const button = document.querySelector("#usageOverview button[data-action='key-settings']");
      if (button) button.click();
      else document.getElementById("addKeyButton")?.click();
    }, 80);
    return;
  }
  if (action === "create-client") {
    clickPage("settings");
    window.setTimeout(() => clientKeyForm?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }
}

function hidePersistentClientTokenReveal() {
  if (!clientKeyList) return;
  for (const button of clientKeyList.querySelectorAll("button[data-client-action='copy']")) {
    button.remove();
  }
}

function ensureTokenDialog() {
  if (tokenDialog) return tokenDialog;
  tokenDialog = document.createElement("dialog");
  tokenDialog.id = "oneTimeTokenDialog";
  tokenDialog.innerHTML = `
    <form method="dialog" class="dialogCard oneTimeTokenCard">
      <header><h2 data-token-title></h2></header>
      <p data-token-description></p>
      <div class="oneTimeTokenValue"><code data-token-value></code></div>
      <footer>
        <button class="button primary" type="button" data-token-copy></button>
        <button class="button" type="submit" data-token-done></button>
      </footer>
    </form>
  `;
  document.body.appendChild(tokenDialog);
  tokenDialog.querySelector("[data-token-copy]")?.addEventListener("click", async () => {
    const value = tokenDialog.querySelector("[data-token-value]")?.textContent || "";
    await copyText(value);
    tokenDialog.querySelector("[data-token-copy]").textContent = w("copied");
  });
  tokenDialog.addEventListener("close", clearTokenDialog);
  return tokenDialog;
}

function showOneTimeToken(token) {
  if (!token) {
    announce(w("tokenUnavailable"), "error");
    return;
  }
  const dialog = ensureTokenDialog();
  dialog.querySelector("[data-token-title]").textContent = w("oneTimeTitle");
  dialog.querySelector("[data-token-description]").textContent = w("oneTimeDescription");
  dialog.querySelector("[data-token-value]").textContent = token;
  dialog.querySelector("[data-token-copy]").textContent = w("copy");
  dialog.querySelector("[data-token-done]").textContent = w("done");
  dialog.showModal();
}

function clearTokenDialog() {
  if (!tokenDialog) return;
  const value = tokenDialog.querySelector("[data-token-value]");
  if (value) value.textContent = "";
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

async function createClientKeyOnce(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!snapshot.authenticated) {
    announce(w("loginRequired"), "warning");
    return;
  }
  const form = new FormData(clientKeyForm);
  const name = String(form.get("name") || "").trim();
  if (!name) return;
  try {
    const created = await request("/admin/client-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    clientKeyForm.reset();
    showOneTimeToken(created?.token || "");
    document.getElementById("refreshButton")?.click();
    scheduleSnapshot(700);
  } catch (error) {
    announce(`${w("createFailed")}：${error.message}`, "error");
  }
}

async function rotateClientKeyOnce(button, row, event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!confirm(w("rotateConfirm"))) return;
  const id = row?.dataset.clientKeyId;
  if (!id) return;
  try {
    const rotated = await request(`/admin/client-keys/${encodeURIComponent(id)}/rotate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    showOneTimeToken(rotated?.token || "");
    document.getElementById("refreshButton")?.click();
    scheduleSnapshot(700);
  } catch (error) {
    announce(`${w("rotateFailed")}：${error.message}`, "error");
  }
}

function rememberUpstreamCreate() {
  pendingUpstreamCreate = {
    knownIds: new Set(snapshot.cards.map((card) => String(card.id))),
    attempts: 0,
  };
  announce(w("verifying"));
  scheduleSnapshot(650);
}

async function tryAutoVerifyNewKey() {
  if (!pendingUpstreamCreate || verificationRunning) return;
  const created = snapshot.cards.find((card) => !pendingUpstreamCreate.knownIds.has(String(card.id)));
  if (!created) {
    pendingUpstreamCreate.attempts += 1;
    if (pendingUpstreamCreate.attempts < 6) scheduleSnapshot(600);
    else pendingUpstreamCreate = null;
    return;
  }

  verificationRunning = true;
  pendingUpstreamCreate = null;
  announce(w("verifying"));
  try {
    const result = await request(`/admin/keys/${encodeURIComponent(created.id)}/test`, { method: "POST" });
    announce(result?.ok ? w("verifySuccess") : w("verifyInvalid"), result?.ok ? "success" : "error");
  } catch {
    announce(w("verifyNetwork"), "warning");
  } finally {
    verificationRunning = false;
    document.getElementById("refreshButton")?.click();
    scheduleSnapshot(800);
  }
}

if (guideRoot && filterRoot) {
  guideRoot.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-credential-action]");
    if (button) runCredentialAction(button.dataset.credentialAction);
  });

  filterRoot.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-credential-filter]");
    if (!button) return;
    currentFilter = button.dataset.credentialFilter || "all";
    localStorage.setItem(filterStorageKey, currentFilter);
    renderGuide();
    decorateKeyCards();
  });

  keyForm?.addEventListener("submit", rememberUpstreamCreate, true);
  clientKeyForm?.addEventListener("submit", createClientKeyOnce, true);
  clientKeyList?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-client-action]");
    if (!button) return;
    const row = button.closest("[data-client-key-id]");
    if (button.dataset.clientAction === "rotate") rotateClientKeyOnce(button, row, event);
    if (button.dataset.clientAction === "copy") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  const observer = new MutationObserver(() => {
    decorateKeyCards();
    scheduleSnapshot(500);
  });
  [usageRoot, clientKeyList].filter(Boolean).forEach((root) => observer.observe(root, { childList: true, subtree: true }));
  new MutationObserver(() => {
    renderGuide();
    decorateKeyCards();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  window.addEventListener("focus", () => scheduleSnapshot(100));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleSnapshot(100);
  });
  loadSnapshot();
}
