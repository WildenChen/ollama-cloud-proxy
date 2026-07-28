import { deriveServiceReadiness } from "./readiness.js";

const dismissedKey = "ollamaProxyOnboardingDismissed";
const serviceRoot = document.getElementById("serviceReadinessRoot");
const onboardingRoot = document.getElementById("onboardingRoot");

const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>';

const words = {
  "zh-Hant": {
    serviceStatus: "服務狀態",
    readyTitle: "可正常使用",
    readyDescription: "代理、Client API 金鑰與模型清單都已就緒。",
    partialTitle: "部分可用",
    partialDescription: "服務可以使用，但部分金鑰或驗證項目需要注意。",
    setupTitle: "尚未完成設定",
    setupDescription: "依照設定指南完成必要步驟後即可連線使用。",
    unavailableTitle: "暫時無可用金鑰",
    unavailableDescription: "已建立金鑰，但目前沒有任何金鑰可處理請求。",
    errorTitle: "狀態讀取失敗",
    errorDescription: "管理台暫時無法取得完整狀態，請重新整理。",
    availableSummary: (available, total) => `${available}/${total} 把上游金鑰可用`,
    clientSummary: (count) => `${count} 把 Client API 金鑰啟用`,
    guide: "設定指南",
    hideGuide: "隱藏設定指南",
    continueSetup: "繼續設定",
    refresh: "重新整理",
    addKey: "新增上游金鑰",
    createClientKey: "建立 Client API 金鑰",
    testModels: "檢查模型清單",
    reviewKeys: "查看金鑰狀態",
    onboardingTitle: "首次設定指南",
    onboardingDescription: "完成必要步驟後，工具即可透過此服務使用 Ollama Cloud。",
    progress: (done, total) => `必要步驟 ${done}/${total}`,
    required: "必要",
    optional: "選填",
    completed: "已完成",
    pending: "待完成",
    adminStep: "建立管理密碼並登入",
    adminHint: "保護管理設定與測試操作。",
    upstreamStep: "新增 Ollama Cloud API Key",
    upstreamHint: "這是代理連接 Ollama Cloud 使用的上游憑證。",
    clientStep: "建立 Client API Key",
    clientHint: "OpenClaw、VS Code 或其他工具應使用這把金鑰連接代理。",
    proxyStep: "確認至少一把上游金鑰可用",
    proxyHint: "若全部冷卻或額度受限，服務會暫時無法處理模型請求。",
    modelStep: "讀取模型清單",
    modelHint: "確認代理可從上游取得模型並完成基本連線驗證。",
    cookieStep: "設定 Usage Cookie",
    cookieHint: "選填；只影響官方用量顯示，不影響模型代理。",
    connectionTitle: "工具連線資訊",
    connectionDescription: "建立 Client API Key 後，把下列 Base URL 與金鑰填入工具。",
    openAiLabel: "OpenAI-compatible Base URL",
    nativeLabel: "Ollama native Base URL",
    copy: "複製",
    copied: "已複製",
    signIn: "登入管理台",
    openSettings: "前往設定",
    setCookie: "設定 Cookie",
  },
  en: {
    serviceStatus: "Service status",
    readyTitle: "Ready to use",
    readyDescription: "The proxy, Client API key, and model discovery are ready.",
    partialTitle: "Partially available",
    partialDescription: "The service works, but some keys or checks need attention.",
    setupTitle: "Setup incomplete",
    setupDescription: "Complete the guided steps before connecting a client.",
    unavailableTitle: "No available upstream key",
    unavailableDescription: "Keys exist, but none can currently process requests.",
    errorTitle: "Status unavailable",
    errorDescription: "The console could not load the full status. Refresh and try again.",
    availableSummary: (available, total) => `${available}/${total} upstream keys available`,
    clientSummary: (count) => `${count} Client API keys enabled`,
    guide: "Setup guide",
    hideGuide: "Hide setup guide",
    continueSetup: "Continue setup",
    refresh: "Refresh",
    addKey: "Add upstream key",
    createClientKey: "Create Client API key",
    testModels: "Check model list",
    reviewKeys: "Review key status",
    onboardingTitle: "First-time setup guide",
    onboardingDescription: "Complete the required steps so clients can use Ollama Cloud through this service.",
    progress: (done, total) => `Required steps ${done}/${total}`,
    required: "Required",
    optional: "Optional",
    completed: "Complete",
    pending: "Pending",
    adminStep: "Create an admin password and sign in",
    adminHint: "Protects settings and test actions.",
    upstreamStep: "Add an Ollama Cloud API key",
    upstreamHint: "The proxy uses this upstream credential to reach Ollama Cloud.",
    clientStep: "Create a Client API key",
    clientHint: "OpenClaw, VS Code, and other tools should use this key to connect to the proxy.",
    proxyStep: "Confirm at least one upstream key is available",
    proxyHint: "If every key is cooling down or quota-blocked, model requests are temporarily unavailable.",
    modelStep: "Load the model list",
    modelHint: "Confirms the proxy can discover upstream models and complete a basic connection check.",
    cookieStep: "Set a Usage Cookie",
    cookieHint: "Optional; it only affects official usage display, not model proxying.",
    connectionTitle: "Client connection",
    connectionDescription: "After creating a Client API key, use these Base URLs in your tool.",
    openAiLabel: "OpenAI-compatible Base URL",
    nativeLabel: "Ollama native Base URL",
    copy: "Copy",
    copied: "Copied",
    signIn: "Sign in",
    openSettings: "Open settings",
    setCookie: "Set cookie",
  },
};

let snapshot = null;
let loadingTimer = null;

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

async function fetchJson(path) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "cache-control": "no-store" },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function loadReadiness() {
  if (!serviceRoot || !onboardingRoot) return;
  try {
    const [authStatus, stats] = await Promise.all([
      fetchJson("/admin/auth/status"),
      fetchJson("/admin/stats"),
    ]);

    let clientKeys = [];
    let models = null;
    if (authStatus.authenticated) {
      const [clientResponse, modelResponse] = await Promise.all([
        fetchJson("/admin/client-keys"),
        fetchJson("/admin/models"),
      ]);
      clientKeys = clientResponse.clientKeys || [];
      models = modelResponse;
    }

    const totals = stats?.usage?.overview?.totals;
    snapshot = deriveServiceReadiness({
      initialized: authStatus.initialized,
      authenticated: authStatus.authenticated,
      totalKeys: stats?.keys?.totalKeys,
      availableKeys: stats?.keys?.availableKeys,
      enabledClientKeys: clientKeys.filter((key) => key.enabled !== false).length,
      modelCount: models?.count ?? models?.models?.length ?? 0,
      usageCookieCount: totals?.official?.available ?? 0,
    });
  } catch {
    snapshot = deriveServiceReadiness({ loadError: true });
  }
  render();
}

function statusCopy(status) {
  if (status === "ready") return [w("readyTitle"), w("readyDescription")];
  if (status === "partial") return [w("partialTitle"), w("partialDescription")];
  if (status === "setup") return [w("setupTitle"), w("setupDescription")];
  if (status === "unavailable") return [w("unavailableTitle"), w("unavailableDescription")];
  return [w("errorTitle"), w("errorDescription")];
}

function actionLabel(action) {
  if (action === "sign-in") return w("signIn");
  if (action === "add-key") return w("addKey");
  if (action === "create-client-key") return w("createClientKey");
  if (action === "test-models") return w("testModels");
  if (action === "review-keys") return w("reviewKeys");
  if (action === "set-cookie") return w("setCookie");
  if (action === "focus-guide") return w("continueSetup");
  return w("refresh");
}

function render() {
  if (!snapshot || !serviceRoot || !onboardingRoot) return;
  const [title, description] = statusCopy(snapshot.status);
  const counts = snapshot.counts;
  const dismissed = localStorage.getItem(dismissedKey) === "1";
  const guideAction = snapshot.requiredComplete ? "show-guide" : "focus-guide";
  const guideLabel = snapshot.requiredComplete
    ? (dismissed ? w("guide") : w("hideGuide"))
    : w("continueSetup");

  serviceRoot.innerHTML = `
    <section class="serviceReadinessCard ${escapeHtml(snapshot.status)}" aria-labelledby="serviceReadinessTitle">
      <div class="serviceReadinessMain">
        <span class="eyebrow">${escapeHtml(w("serviceStatus"))}</span>
        <div class="serviceReadinessHeading">
          <span class="serviceStateIcon" aria-hidden="true"></span>
          <div>
            <h2 id="serviceReadinessTitle">${escapeHtml(title)}</h2>
            <p>${escapeHtml(description)}</p>
          </div>
        </div>
        <div class="serviceReadinessFacts">
          <span>${escapeHtml(w("availableSummary")(counts.availableKeys, counts.totalKeys))}</span>
          <span>${escapeHtml(w("clientSummary")(counts.enabledClientKeys))}</span>
        </div>
      </div>
      <div class="serviceReadinessActions">
        ${snapshot.nextAction !== "none" ? `<button class="button primary" type="button" data-readiness-action="${escapeHtml(snapshot.nextAction)}">${escapeHtml(actionLabel(snapshot.nextAction))}</button>` : ""}
        <button class="button" type="button" data-readiness-action="${escapeHtml(guideAction)}">${escapeHtml(guideLabel)}</button>
      </div>
    </section>
  `;

  const showGuide = !snapshot.requiredComplete || !dismissed;
  onboardingRoot.classList.toggle("hidden", !showGuide);
  if (!showGuide) {
    onboardingRoot.innerHTML = "";
    return;
  }

  const requiredSteps = [
    ["adminReady", "adminStep", "adminHint", "sign-in"],
    ["upstreamKeyReady", "upstreamStep", "upstreamHint", "add-key"],
    ["clientKeyReady", "clientStep", "clientHint", "create-client-key"],
    ["proxyReady", "proxyStep", "proxyHint", "refresh"],
    ["modelDiscoveryReady", "modelStep", "modelHint", "test-models"],
  ];
  const done = requiredSteps.filter(([key]) => snapshot.steps[key]).length;
  const origin = window.location.origin;

  onboardingRoot.innerHTML = `
    <section class="panel onboardingPanel" aria-labelledby="onboardingTitle">
      <div class="onboardingHeader">
        <div>
          <span class="eyebrow">${escapeHtml(w("progress")(done, requiredSteps.length))}</span>
          <h2 id="onboardingTitle">${escapeHtml(w("onboardingTitle"))}</h2>
          <p>${escapeHtml(w("onboardingDescription"))}</p>
        </div>
        ${snapshot.requiredComplete ? `<button class="button compact" type="button" data-readiness-action="dismiss-guide">${escapeHtml(w("hideGuide"))}</button>` : ""}
      </div>
      <div class="onboardingGrid">
        <div class="onboardingChecklist">
          ${requiredSteps.map(([key, label, hint, action]) => renderStep(snapshot.steps[key], label, hint, action, false)).join("")}
          ${renderStep(snapshot.steps.usageCookieReady, "cookieStep", "cookieHint", "set-cookie", true)}
        </div>
        <aside class="connectionPanel">
          <h3>${escapeHtml(w("connectionTitle"))}</h3>
          <p>${escapeHtml(w("connectionDescription"))}</p>
          ${renderConnectionValue(w("openAiLabel"), `${origin}/v1`, "copy-openai")}
          ${renderConnectionValue(w("nativeLabel"), origin, "copy-native")}
        </aside>
      </div>
    </section>
  `;
}

function renderStep(completed, labelKey, hintKey, action, optional) {
  const badge = optional ? w("optional") : w("required");
  const stateLabel = completed ? w("completed") : w("pending");
  return `
    <article class="onboardingStep ${completed ? "complete" : "pending"}">
      <span class="stepIndicator" aria-hidden="true">${completed ? "✓" : ""}</span>
      <div class="stepCopy">
        <div class="stepTitleRow">
          <strong>${escapeHtml(w(labelKey))}</strong>
          <span class="stepRequirement">${escapeHtml(badge)}</span>
          <span class="stepState">${escapeHtml(stateLabel)}</span>
        </div>
        <p>${escapeHtml(w(hintKey))}</p>
      </div>
      ${completed ? "" : `<button class="button compact" type="button" data-readiness-action="${escapeHtml(action)}">${escapeHtml(actionLabel(action))}</button>`}
    </article>
  `;
}

function renderConnectionValue(label, value, action) {
  return `
    <div class="connectionValue">
      <span>${escapeHtml(label)}</span>
      <div>
        <code>${escapeHtml(value)}</code>
        <button class="iconButton ghost" type="button" data-readiness-action="${escapeHtml(action)}" data-copy-value="${escapeHtml(value)}" title="${escapeHtml(w("copy"))}" aria-label="${escapeHtml(w("copy"))}">${copyIcon}</button>
      </div>
    </div>
  `;
}

function clickTab(page) {
  document.querySelector(`.tab[data-page="${page}"]`)?.click();
}

function runAction(action, button) {
  if (action === "focus-guide") {
    onboardingRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "show-guide") {
    const visible = !onboardingRoot.classList.contains("hidden");
    localStorage.setItem(dismissedKey, visible ? "1" : "0");
    render();
    if (!visible) onboardingRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "dismiss-guide") {
    localStorage.setItem(dismissedKey, "1");
    render();
    return;
  }
  if (action === "sign-in") {
    clickTab("settings");
    return;
  }
  if (action === "add-key") {
    document.getElementById("addKeyButton")?.click();
    return;
  }
  if (action === "create-client-key") {
    clickTab("settings");
    window.setTimeout(() => document.getElementById("clientKeyForm")?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return;
  }
  if (action === "test-models") {
    clickTab("modelTest");
    window.setTimeout(() => {
      document.getElementById("refreshModelsButton")?.click();
      scheduleReload(1200);
    }, 120);
    return;
  }
  if (action === "review-keys") {
    clickTab("overview");
    document.getElementById("usageOverview")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "set-cookie") {
    const settingsButton = document.querySelector("#usageOverview button[data-action='key-settings']");
    if (settingsButton) settingsButton.click();
    else document.getElementById("addKeyButton")?.click();
    return;
  }
  if (action === "copy-openai" || action === "copy-native") {
    copyValue(button?.dataset.copyValue || "", button);
    return;
  }
  document.getElementById("refreshButton")?.click();
  scheduleReload(800);
}

async function copyValue(value, button) {
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  } else {
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
  if (button) {
    const previous = button.getAttribute("title");
    button.setAttribute("title", w("copied"));
    button.setAttribute("aria-label", w("copied"));
    window.setTimeout(() => {
      button.setAttribute("title", previous || w("copy"));
      button.setAttribute("aria-label", w("copy"));
    }, 1500);
  }
}

function scheduleReload(delay = 500) {
  window.clearTimeout(loadingTimer);
  loadingTimer = window.setTimeout(loadReadiness, delay);
}

if (serviceRoot && onboardingRoot) {
  serviceRoot.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-readiness-action]");
    if (button) runAction(button.dataset.readinessAction, button);
  });
  onboardingRoot.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-readiness-action]");
    if (button) runAction(button.dataset.readinessAction, button);
  });

  const mutationObserver = new MutationObserver(() => scheduleReload());
  [document.getElementById("usageOverview"), document.getElementById("clientKeyList")]
    .filter(Boolean)
    .forEach((element) => mutationObserver.observe(element, { childList: true, subtree: true }));

  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.addEventListener("focus", () => scheduleReload(100));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleReload(100);
  });
  loadReadiness();
}
