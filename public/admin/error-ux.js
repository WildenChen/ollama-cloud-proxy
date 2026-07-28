import {
  buildSafeDiagnostic,
  classifyUserFacingError,
  redactDiagnostic,
} from "./error-guidance.js";

const nativeFetch = window.fetch.bind(window);
const pendingErrors = [];
let guidanceRoot = null;
let notice = null;
let currentError = null;
let currentField = null;
let lastSignature = "";

const words = {
  "zh-Hant": {
    heading: "問題處理指引",
    impactLabel: "影響範圍",
    nextLabel: "建議下一步",
    autoRetry: "這類問題通常是暫時性的；系統既有重試機制仍會運作，也可以手動重試。",
    usageOnly: "模型代理不受影響，只有官方用量資料無法更新。",
    originalLabel: "技術資訊",
    copyDiagnostic: "複製安全診斷資訊",
    copied: "診斷資訊已複製",
    dismiss: "關閉指引",
    retry: "重新嘗試",
    signIn: "重新登入",
    reviewKeys: "查看金鑰狀態",
    updateCookie: "更新 Usage Cookie",
    updateClientKey: "查看 Client API Key",
    fixField: "回到錯誤欄位",
    refresh: "重新整理狀態",
    impacts: {
      proxy: "模型請求目前無法正常完成。",
      usage: "只影響官方用量顯示，不影響模型請求。",
      temporary: "目前操作暫時失敗，既有資料與設定不會被刪除。",
      configuration: "這次設定沒有儲存，其他既有設定仍保留。",
      admin: "只影響目前的管理台操作。",
    },
    kinds: {
      admin_auth: ["管理登入已失效", "管理 Cookie 可能已過期，或管理密碼已變更。", "重新輸入管理密碼即可繼續。"],
      client_auth: ["Client API Key 不正確", "工具送出的 Client API Key 不存在、已停用或已更換。", "在工具中更新為管理台目前有效的 Client API Key。"],
      no_available_key: ["目前沒有可用的上游金鑰", "所有 Ollama Cloud API Key 可能失效、停用、冷卻或額度受限。", "查看金鑰狀態與預計恢復時間，必要時新增或更換金鑰。"],
      upstream_key_invalid: ["Ollama Cloud API Key 無效", "上游拒絕這把金鑰，可能已撤銷、貼錯或過期。", "開啟該金鑰設定，更換 API Key 後重新測試。"],
      quota_limited: ["Ollama Cloud 額度暫時受限", "5 小時或每週額度已用完，代理會改用其他可用金鑰。", "查看受限金鑰的重置時間；若仍有其他可用金鑰，不需要手動處理。"],
      usage_cookie: ["官方用量讀取失敗", "Usage Cookie 缺失、過期或無法讀取，但模型代理仍可使用。", "更新該帳號的 Usage Cookie，或忽略官方用量顯示。"],
      upstream_unavailable: ["Ollama Cloud 暫時無法連線", "可能是網路、上游服務或逾時問題，已保存的設定不受影響。", "稍後重試；若持續發生，再確認網路與上游服務狀態。"],
      queue_busy: ["目前請求量過高", "佇列已滿或等待逾時，這次請求未送到上游。", "稍後重試，或降低同時請求數。"],
      invalid_setting: ["設定值不正確", "這次修改未儲存，畫面上的其他非敏感輸入仍會保留。", "修正標示的欄位後再提交。"],
      not_found: ["目標資料已不存在", "畫面可能仍保留已刪除或已更新的舊資料。", "重新整理管理台取得最新狀態。"],
      unknown: ["操作未完成", "管理台收到未分類的錯誤，既有設定通常不受影響。", "先重新嘗試；若持續發生，可複製安全診斷資訊。"],
    },
    fieldRequired: "此欄位為必填。",
    fieldInvalid: "請檢查此欄位的格式或範圍。",
  },
  en: {
    heading: "Troubleshooting guidance",
    impactLabel: "Impact",
    nextLabel: "Next step",
    autoRetry: "This is usually temporary. Existing retry behavior remains active, and you can also retry manually.",
    usageOnly: "Model proxying is unaffected; only official usage data cannot update.",
    originalLabel: "Technical detail",
    copyDiagnostic: "Copy safe diagnostics",
    copied: "Diagnostics copied",
    dismiss: "Dismiss",
    retry: "Retry",
    signIn: "Sign in again",
    reviewKeys: "Review key status",
    updateCookie: "Update Usage Cookie",
    updateClientKey: "Review Client API Key",
    fixField: "Return to invalid field",
    refresh: "Refresh status",
    impacts: {
      proxy: "Model requests cannot currently complete.",
      usage: "Only official usage display is affected; model requests still work.",
      temporary: "This operation failed temporarily. Existing data and settings remain intact.",
      configuration: "This change was not saved. Existing settings remain intact.",
      admin: "Only the current Admin operation is affected.",
    },
    kinds: {
      admin_auth: ["Admin session expired", "The Admin cookie may have expired or the password changed.", "Enter the Admin password again."],
      client_auth: ["Client API Key is invalid", "The client token is missing, disabled, or was rotated.", "Update the client tool with an active Client API Key."],
      no_available_key: ["No upstream key is available", "Every Ollama Cloud API Key may be invalid, disabled, cooling down, or quota-limited.", "Review key status and recovery time, then add or replace a key if needed."],
      upstream_key_invalid: ["Ollama Cloud API Key is invalid", "The upstream rejected this key because it may be revoked, mistyped, or expired.", "Replace the API Key and test it again."],
      quota_limited: ["Ollama Cloud quota is limited", "A 5-hour or weekly limit is exhausted; the proxy will use another available key.", "Check reset times. No manual action is needed when another key is available."],
      usage_cookie: ["Official usage could not be read", "The Usage Cookie is missing or expired, but model proxying still works.", "Update the Usage Cookie or ignore official usage display."],
      upstream_unavailable: ["Ollama Cloud is temporarily unavailable", "This may be a network, upstream service, or timeout issue. Saved settings are unaffected.", "Retry later. Check network and upstream status only if it continues."],
      queue_busy: ["Request capacity is busy", "The queue is full or timed out before this request reached upstream.", "Retry later or reduce concurrent requests."],
      invalid_setting: ["A setting is invalid", "This change was not saved; other non-sensitive input remains in the form.", "Correct the highlighted field and submit again."],
      not_found: ["The item no longer exists", "The page may contain stale data for an item that was deleted or changed.", "Refresh Admin to load current state."],
      unknown: ["The operation did not complete", "Admin received an unclassified error. Existing settings are usually unaffected.", "Retry first; copy safe diagnostics if the issue continues."],
    },
    fieldRequired: "This field is required.",
    fieldInvalid: "Check this field's format or range.",
  },
};

function locale() {
  return document.documentElement.lang === "en" ? "en" : "zh-Hant";
}

function w(key) {
  return words[locale()][key];
}

function kindCopy(kind) {
  return words[locale()].kinds[kind] || words[locale()].kinds.unknown;
}

function impactCopy(impact) {
  return words[locale()].impacts[impact] || words[locale()].impacts.admin;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function endpointFrom(input) {
  try {
    const raw = typeof input === "string" ? input : input?.url;
    const url = new URL(raw, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return String(input || "");
  }
}

function dispatchApiError(detail) {
  pendingErrors.push(detail);
  if (pendingErrors.length > 10) pendingErrors.shift();
  window.dispatchEvent(new CustomEvent("ocp:api-error", { detail }));
}

if (!window.__ocpErrorFetchWrapped) {
  window.__ocpErrorFetchWrapped = true;
  window.fetch = async function monitoredFetch(input, init = {}) {
    const endpoint = endpointFrom(input);
    const method = String(init.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
    try {
      const response = await nativeFetch(input, init);
      if (!response.ok) {
        response.clone().text().then((text) => {
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = null;
          }
          dispatchApiError({
            endpoint,
            method,
            status: response.status,
            code: data?.error?.code || null,
            message: data?.error?.message || `HTTP ${response.status}`,
            details: data?.error?.details || null,
            source: "fetch",
          });
        }).catch(() => {});
      }
      return response;
    } catch (error) {
      dispatchApiError({
        endpoint,
        method,
        status: 0,
        code: "network_error",
        message: error instanceof Error ? error.message : String(error),
        details: null,
        source: "network",
      });
      throw error;
    }
  };
}

function initErrorUx() {
  guidanceRoot = document.getElementById("errorGuidanceRoot");
  notice = document.getElementById("notice");
  if (!guidanceRoot || !notice) return;

  window.addEventListener("ocp:api-error", (event) => presentError(event.detail));

  const observer = new MutationObserver(() => {
    if (notice.classList.contains("hidden") || !notice.classList.contains("error")) return;
    const message = notice.textContent?.trim();
    if (!message) return;
    window.setTimeout(() => {
      if (currentError && normalizeText(currentError.message) === normalizeText(message)) return;
      presentError({
        endpoint: window.location.pathname,
        method: null,
        status: null,
        code: null,
        message,
        details: null,
        source: "notice",
      });
    }, 0);
  });
  observer.observe(notice, { attributes: true, childList: true, subtree: true });

  document.addEventListener("invalid", handleInvalidField, true);
  document.addEventListener("input", clearValidField, true);
  document.addEventListener("change", clearValidField, true);

  guidanceRoot.addEventListener("click", handleGuidanceAction);
  while (pendingErrors.length) presentError(pendingErrors.shift());
}

function presentError(detail = {}) {
  const classification = classifyUserFacingError({
    ...detail,
    context: `${detail.endpoint || ""} ${detail.source || ""}`,
  });
  const safeMessage = String(redactDiagnostic(detail.message || ""));
  const signature = `${classification.kind}:${detail.status || ""}:${detail.code || ""}:${safeMessage}`;
  if (signature === lastSignature) return;
  lastSignature = signature;

  currentField = classification.kind === "invalid_setting" ? findRelevantField(detail) : null;
  if (currentField) setFieldError(currentField, safeMessage || w("fieldInvalid"));

  currentError = {
    ...detail,
    message: safeMessage,
    classification,
    diagnostic: buildSafeDiagnostic({
      ...detail,
      message: safeMessage,
      kind: classification.kind,
      version: document.getElementById("appVersion")?.textContent || null,
      page: window.location.pathname,
    }),
  };
  renderError();
}

function renderError() {
  if (!guidanceRoot || !currentError) return;
  const classification = currentError.classification;
  const [title, description, nextStep] = kindCopy(classification.kind);
  const technical = currentError.message && normalizeText(currentError.message) !== normalizeText(description)
    ? `<details><summary>${escapeHtml(w("originalLabel"))}</summary><code>${escapeHtml(currentError.message)}</code></details>`
    : "";

  guidanceRoot.innerHTML = `
    <section class="errorGuidanceCard ${escapeHtml(classification.severity)}" role="alert" aria-labelledby="errorGuidanceTitle">
      <div class="errorGuidanceHeader">
        <span class="errorGuidanceIcon" aria-hidden="true">!</span>
        <div>
          <span class="eyebrow">${escapeHtml(w("heading"))}</span>
          <h2 id="errorGuidanceTitle">${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
        <span class="errorImpactBadge ${escapeHtml(classification.impact)}">${escapeHtml(impactShortLabel(classification))}</span>
      </div>
      <div class="errorGuidanceBody">
        <div>
          <strong>${escapeHtml(w("impactLabel"))}</strong>
          <p>${escapeHtml(impactCopy(classification.impact))}</p>
        </div>
        <div>
          <strong>${escapeHtml(w("nextLabel"))}</strong>
          <p>${escapeHtml(nextStep)}</p>
        </div>
      </div>
      ${classification.autoRetry ? `<p class="errorRetryHint">${escapeHtml(w("autoRetry"))}</p>` : ""}
      ${classification.usageOnly ? `<p class="errorUsageOnly">${escapeHtml(w("usageOnly"))}</p>` : ""}
      ${technical}
      <div class="errorGuidanceActions">
        <button class="button primary" type="button" data-error-action="${escapeHtml(classification.action)}">${escapeHtml(primaryActionLabel(classification.action))}</button>
        <button class="button" type="button" data-error-action="copy">${escapeHtml(w("copyDiagnostic"))}</button>
        <button class="button ghost" type="button" data-error-action="dismiss">${escapeHtml(w("dismiss"))}</button>
      </div>
    </section>
  `;
  guidanceRoot.classList.remove("hidden");
}

function impactShortLabel(classification) {
  if (classification.usageOnly) return locale() === "en" ? "Usage only" : "僅影響用量";
  if (classification.impact === "proxy") return locale() === "en" ? "Proxy unavailable" : "代理不可用";
  if (classification.impact === "temporary") return locale() === "en" ? "Temporary" : "暫時性";
  if (classification.impact === "configuration") return locale() === "en" ? "Not saved" : "未儲存";
  return locale() === "en" ? "Admin only" : "僅管理操作";
}

function primaryActionLabel(action) {
  if (action === "sign_in") return w("signIn");
  if (action === "review_keys") return w("reviewKeys");
  if (action === "update_cookie") return w("updateCookie");
  if (action === "update_client_key") return w("updateClientKey");
  if (action === "fix_field") return w("fixField");
  if (action === "refresh") return w("refresh");
  return w("retry");
}

async function handleGuidanceAction(event) {
  const button = event.target.closest("button[data-error-action]");
  if (!button || !currentError) return;
  const action = button.dataset.errorAction;

  if (action === "dismiss") {
    currentError = null;
    lastSignature = "";
    guidanceRoot.innerHTML = "";
    guidanceRoot.classList.add("hidden");
    return;
  }
  if (action === "copy") {
    await copyText(JSON.stringify(currentError.diagnostic, null, 2));
    button.textContent = w("copied");
    return;
  }
  if (action === "sign_in") {
    document.querySelector("#authGate input:not([type='hidden'])")?.focus();
    return;
  }
  if (action === "update_client_key") {
    clickPage("settings");
    window.setTimeout(() => document.getElementById("clientKeyForm")?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return;
  }
  if (action === "review_keys") {
    clickPage("overview");
    window.setTimeout(() => {
      document.querySelector("button[data-credential-filter='attention']")?.click();
      document.getElementById("keyFilterRoot")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return;
  }
  if (action === "update_cookie") {
    clickPage("overview");
    window.setTimeout(() => {
      const settings = document.querySelector("#usageOverview button[data-action='key-settings']");
      if (settings) settings.click();
      else document.getElementById("addKeyButton")?.click();
    }, 80);
    return;
  }
  if (action === "fix_field") {
    currentField?.focus();
    currentField?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (action === "refresh") {
    document.getElementById("refreshButton")?.click();
    return;
  }
  retryCurrentOperation();
}

function retryCurrentOperation() {
  const endpoint = String(currentError?.endpoint || "");
  const keyTest = endpoint.match(/^\/admin\/keys\/([^/]+)\/test/);
  if (keyTest) {
    const card = document.querySelector(`.officialQuotaCard[data-key-id="${cssEscape(decodeURIComponent(keyTest[1]))}"]`);
    card?.querySelector("button[data-action='test']")?.click();
    return;
  }
  if (endpoint.includes("/admin/models/refresh")) {
    document.getElementById("refreshModelsButton")?.click();
    return;
  }
  document.getElementById("refreshButton")?.click();
}

function clickPage(page) {
  document.querySelector(`.tab[data-page="${page}"]`)?.click();
}

function findRelevantField(detail) {
  const endpoint = String(detail.endpoint || "");
  const message = normalizeText(detail.message);
  if (endpoint.includes("/admin/client-keys")) return document.querySelector("#clientKeyForm [name='name']");
  if (endpoint === "/admin/keys" || /\/admin\/keys\/?$/.test(endpoint)) {
    return message.includes("name")
      ? document.querySelector("#keyForm [name='name']")
      : document.querySelector("#keyForm [name='apiKey']");
  }
  if (endpoint.includes("auth")) {
    return document.querySelector("#authGate form:not(.hidden) input:not([type='hidden'])");
  }
  if (endpoint.includes("usage-settings")) return fieldByKeywords("#usageSettingsForm", message);
  if (endpoint.includes("system-settings")) return document.querySelector("#systemSettingsForm select, #systemSettingsForm input");
  if (endpoint.includes("models")) return document.querySelector("#modelTestPage select, #modelTestPage input");
  return document.querySelector("form:has(:invalid) :invalid");
}

function fieldByKeywords(formSelector, message) {
  const form = document.querySelector(formSelector);
  if (!form) return null;
  const candidates = [...form.querySelectorAll("input, select, textarea")];
  return candidates.find((field) => message.includes(String(field.name || "").toLowerCase())) || candidates[0] || null;
}

function handleInvalidField(event) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
  setFieldError(field, field.validity.valueMissing ? w("fieldRequired") : (field.validationMessage || w("fieldInvalid")));
}

function clearValidField(event) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
  if (field.checkValidity()) clearFieldError(field);
}

function setFieldError(field, message) {
  if (!field) return;
  const id = field.dataset.errorMessageId || `field-error-${crypto.randomUUID()}`;
  field.dataset.errorMessageId = id;
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", id);
  let error = document.getElementById(id);
  if (!error) {
    error = document.createElement("small");
    error.id = id;
    error.className = "fieldErrorMessage";
    field.insertAdjacentElement("afterend", error);
  }
  error.textContent = String(redactDiagnostic(message || w("fieldInvalid")));
}

function clearFieldError(field) {
  const id = field.dataset.errorMessageId;
  if (id) document.getElementById(id)?.remove();
  delete field.dataset.errorMessageId;
  field.removeAttribute("aria-invalid");
  field.removeAttribute("aria-describedby");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initErrorUx, { once: true });
} else {
  initErrorUx();
}
