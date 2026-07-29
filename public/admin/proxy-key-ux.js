const root = document.getElementById("proxyKeyRoot");
const securityNoticeKey = "ollamaProxyClientProtectionNoticeDismissed";
let snapshot = null;
let createDialog = null;
let tokenDialog = null;
let refreshTimer = null;

const words = {
  "zh-Hant": {
    eyebrow: "工具連線憑證",
    title: "Proxy 專屬金鑰",
    description: "OpenClaw、Kilo Code、VS Code 或其他工具連線到本服務時使用。不要把 Ollama Cloud 上游金鑰直接填入工具。",
    flow: "工具 → Proxy 專屬金鑰 → ollama-cloud-proxy → Ollama Cloud 上游金鑰",
    effective: "有效金鑰",
    database: "管理台建立",
    environment: "環境變數管理",
    protection: "存取保護",
    protected: "已啟用",
    anonymous: "尚未啟用",
    create: "建立 Proxy 專屬金鑰",
    signIn: "登入後管理",
    manage: "前往完整設定",
    listTitle: "目前的 Proxy 專屬金鑰",
    noKeys: "目前尚未建立 Proxy 專屬金鑰。服務仍沿用既有匿名模式，但建議建立金鑰保護工具入口。",
    anonymousTitle: "服務可用，但尚未啟用 Proxy 專屬金鑰保護",
    anonymousDescription: "升級不會中斷現有匿名連線。建立並測試新金鑰後，再由你決定何時讓工具改用金鑰。",
    later: "稍後處理",
    openAiUrl: "OpenAI-compatible Base URL",
    nativeUrl: "Ollama native Base URL",
    copy: "複製",
    copied: "已複製",
    sourceDatabase: "管理台管理",
    sourceEnvironment: "環境變數管理｜唯讀",
    enabled: "已啟用",
    disabled: "已停用",
    duplicateName: "同名來源",
    duplicateSource: "重複 token 來源",
    preview: "前綴",
    notes: "備註",
    lastUsed: "最近使用",
    neverUsed: "尚無紀錄",
    usageUnreliable: "依名稱彙整，來源重疊時無法精確區分",
    edit: "編輯",
    enable: "啟用",
    disable: "停用",
    replacement: "建立替代金鑰",
    delete: "刪除",
    migrate: "建立管理台替代金鑰",
    confirmDisable: "停用後，仍使用這把金鑰的工具會立即無法連線。確定要停用嗎？",
    confirmDelete: "刪除後無法復原。請先確認所有工具已改用其他金鑰。",
    createTitle: "建立 Proxy 專屬金鑰",
    replacementTitle: "建立不中斷服務的替代金鑰",
    editTitle: "編輯 Proxy 專屬金鑰",
    name: "金鑰名稱",
    notesLabel: "備註（選填）",
    save: "儲存",
    cancel: "取消",
    oneTimeTitle: "請立即保存新的 Proxy 專屬金鑰",
    oneTimeDescription: "完整 token 只在這個畫面顯示。舊金鑰不會自動失效；先更新並測試工具，再停用舊金鑰。",
    copyToken: "複製完整金鑰",
    test: "測試連線",
    done: "我已保存，關閉",
    testing: "測試中…",
    authCheck: "金鑰驗證",
    upstreamCheck: "上游可用性",
    modelCheck: "模型狀態",
    ok: "正常",
    unavailable: "暫時不可用",
    notReady: "尚未就緒",
    failed: "失敗",
    loginRequired: "請先登入管理台。",
    loadFailed: "暫時無法讀取 Proxy 專屬金鑰狀態。",
    createFailed: "建立失敗",
    updateFailed: "更新失敗",
    testFailed: "測試失敗",
    duplicateHint: "偵測到相同 token 同時存在於資料庫與環境變數。驗證行為維持不變；完成切換前不要任意移除來源。",
  },
  en: {
    eyebrow: "Client credentials",
    title: "Proxy access keys",
    description: "OpenClaw, Kilo Code, VS Code, and other clients use these keys to connect to this service. Never paste an Ollama Cloud upstream key into a client.",
    flow: "Client → Proxy access key → ollama-cloud-proxy → Ollama Cloud upstream key",
    effective: "Effective keys",
    database: "Admin managed",
    environment: "Environment managed",
    protection: "Access protection",
    protected: "Enabled",
    anonymous: "Not enabled",
    create: "Create proxy access key",
    signIn: "Sign in to manage",
    manage: "Open full settings",
    listTitle: "Current proxy access keys",
    noKeys: "No proxy access key exists yet. The service keeps the existing anonymous mode, but creating a key is recommended.",
    anonymousTitle: "Service works, but proxy access protection is not enabled",
    anonymousDescription: "Upgrading does not interrupt existing anonymous clients. Create and test a new key before deciding when clients should switch.",
    later: "Later",
    openAiUrl: "OpenAI-compatible Base URL",
    nativeUrl: "Ollama native Base URL",
    copy: "Copy",
    copied: "Copied",
    sourceDatabase: "Admin managed",
    sourceEnvironment: "Environment managed | read-only",
    enabled: "Enabled",
    disabled: "Disabled",
    duplicateName: "Duplicate name",
    duplicateSource: "Duplicate token source",
    preview: "Preview",
    notes: "Notes",
    lastUsed: "Last used",
    neverUsed: "No record",
    usageUnreliable: "Aggregated by name; overlapping sources cannot be distinguished precisely",
    edit: "Edit",
    enable: "Enable",
    disable: "Disable",
    replacement: "Create replacement",
    delete: "Delete",
    migrate: "Create Admin replacement",
    confirmDisable: "Clients still using this key will immediately lose access. Disable it?",
    confirmDelete: "Deletion cannot be undone. Confirm every client has switched to another key first.",
    createTitle: "Create proxy access key",
    replacementTitle: "Create a no-downtime replacement key",
    editTitle: "Edit proxy access key",
    name: "Key name",
    notesLabel: "Notes (optional)",
    save: "Save",
    cancel: "Cancel",
    oneTimeTitle: "Save this new proxy access key now",
    oneTimeDescription: "The full token is shown only here. The old key remains active; update and test clients before disabling it.",
    copyToken: "Copy full key",
    test: "Test connection",
    done: "I saved it, close",
    testing: "Testing…",
    authCheck: "Key authentication",
    upstreamCheck: "Upstream availability",
    modelCheck: "Model status",
    ok: "OK",
    unavailable: "Temporarily unavailable",
    notReady: "Not ready",
    failed: "Failed",
    loginRequired: "Sign in to Admin first.",
    loadFailed: "Proxy access key status is temporarily unavailable.",
    createFailed: "Creation failed",
    updateFailed: "Update failed",
    testFailed: "Test failed",
    duplicateHint: "The same token exists in both the database and environment variables. Authentication remains unchanged; do not remove either source until migration is complete.",
  },
};

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
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.error?.code || null;
    throw error;
  }
  return data;
}

function relativeTime(value) {
  if (!value) return w("neverUsed");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return w("neverUsed");
  return new Intl.DateTimeFormat(locale() === "en" ? "en-US" : "zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

async function load() {
  if (!root) return;
  try {
    const [auth, stats] = await Promise.all([
      request("/admin/auth/status"),
      request("/admin/stats"),
    ]);
    let summary = null;
    if (auth.authenticated) summary = await request("/admin/client-key-summary");
    snapshot = {
      authenticated: auth.authenticated === true,
      summary: summary || {
        ...(stats?.clientAccess || {}),
        items: [],
      },
    };
    render();
  } catch (error) {
    snapshot = { error: error.message };
    render();
  }
}

function fact(label, value) {
  return `<div class="proxyKeyFact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function connectionValue(label, value) {
  return `<div class="proxyKeyConnectionValue"><span>${escapeHtml(label)}</span><div><code>${escapeHtml(value)}</code><button class="iconButton ghost" type="button" data-proxy-copy="${escapeHtml(value)}" title="${escapeHtml(w("copy"))}" aria-label="${escapeHtml(w("copy"))}">⧉</button></div></div>`;
}

function keyItem(item) {
  const sourceLabel = item.source === "environment" ? w("sourceEnvironment") : w("sourceDatabase");
  const meta = [
    item.tokenPreview ? `${w("preview")} ${item.tokenPreview}` : null,
    item.notes ? `${w("notes")} ${item.notes}` : null,
    `${w("lastUsed")} ${relativeTime(item.lastRequestAt)}`,
    item.lastRequestAtReliable === false ? w("usageUnreliable") : null,
  ].filter(Boolean);
  const actions = item.source === "environment"
    ? `<button class="button compact" type="button" data-proxy-action="replacement" data-proxy-id="${escapeHtml(item.id)}">${escapeHtml(w("migrate"))}</button>`
    : [
        `<button class="button compact" type="button" data-proxy-action="edit" data-proxy-id="${escapeHtml(item.id)}">${escapeHtml(w("edit"))}</button>`,
        `<button class="button compact" type="button" data-proxy-action="toggle" data-proxy-id="${escapeHtml(item.id)}">${escapeHtml(item.enabled ? w("disable") : w("enable"))}</button>`,
        `<button class="button compact" type="button" data-proxy-action="replacement" data-proxy-id="${escapeHtml(item.id)}">${escapeHtml(w("replacement"))}</button>`,
        `<button class="button compact danger" type="button" data-proxy-action="delete" data-proxy-id="${escapeHtml(item.id)}">${escapeHtml(w("delete"))}</button>`,
      ].join("");
  return `
    <article class="proxyKeyItem ${escapeHtml(item.source)}" data-proxy-key-id="${escapeHtml(item.id)}">
      <div>
        <div class="proxyKeyItemTitle">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="proxyKeySource ${escapeHtml(item.source)}">${escapeHtml(sourceLabel)}</span>
          <span class="proxyKeyState ${item.enabled ? "enabled" : "disabled"}">${escapeHtml(item.enabled ? w("enabled") : w("disabled"))}</span>
          ${item.duplicateName ? `<span class="proxyKeyDuplicate">${escapeHtml(w("duplicateName"))}</span>` : ""}
          ${item.duplicateSource ? `<span class="proxyKeyDuplicate">${escapeHtml(w("duplicateSource"))}</span>` : ""}
        </div>
        <div class="proxyKeyItemMeta">${meta.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>
      </div>
      <div class="proxyKeyItemActions">${actions}</div>
    </article>`;
}

function render() {
  if (!root) return;
  if (snapshot?.error) {
    root.innerHTML = `<section class="panel proxyKeyPanel"><div class="proxyKeyHeader"><div><span class="eyebrow">${escapeHtml(w("eyebrow"))}</span><h2>${escapeHtml(w("title"))}</h2><p>${escapeHtml(w("loadFailed"))}</p></div></div></section>`;
    return;
  }
  if (!snapshot) return;
  const summary = snapshot.summary || {};
  const origin = window.location.origin;
  const noticeDismissed = localStorage.getItem(securityNoticeKey) === "1";
  const showAnonymousNotice = summary.anonymousMode === true && !noticeDismissed;
  const items = Array.isArray(summary.items) ? summary.items : [];
  root.innerHTML = `
    <section class="panel proxyKeyPanel" aria-labelledby="proxyKeyTitle">
      <div class="proxyKeyHeader">
        <div>
          <span class="eyebrow">${escapeHtml(w("eyebrow"))}</span>
          <h2 id="proxyKeyTitle">${escapeHtml(w("title"))}</h2>
          <p>${escapeHtml(w("description"))}</p>
        </div>
        <div class="proxyKeyHeaderActions">
          <button class="button primary" type="button" data-proxy-action="${snapshot.authenticated ? "create" : "sign-in"}">${escapeHtml(snapshot.authenticated ? w("create") : w("signIn"))}</button>
          <button class="button" type="button" data-proxy-action="settings">${escapeHtml(w("manage"))}</button>
        </div>
      </div>
      <div class="proxyKeySummary">
        ${fact(w("effective"), String(summary.effectiveTotal || 0))}
        ${fact(w("database"), String(summary.databaseManagedTotal || 0))}
        ${fact(w("environment"), String(summary.environmentManagedTotal || 0))}
        ${fact(w("protection"), summary.protectionEnabled ? w("protected") : w("anonymous"))}
        <div class="proxyKeyFlow">${escapeHtml(w("flow"))}</div>
      </div>
      ${showAnonymousNotice ? `<div class="proxyKeyUpgradeNotice"><strong>${escapeHtml(w("anonymousTitle"))}</strong><p>${escapeHtml(w("anonymousDescription"))}</p><div class="proxyKeyHeaderActions"><button class="button primary" type="button" data-proxy-action="create">${escapeHtml(w("create"))}</button><button class="button" type="button" data-proxy-action="dismiss-security">${escapeHtml(w("later"))}</button></div></div>` : ""}
      ${summary.duplicateSourceCount > 0 ? `<div class="proxyKeyUpgradeNotice"><strong>${escapeHtml(w("duplicateSource"))}</strong><p>${escapeHtml(w("duplicateHint"))}</p></div>` : ""}
      <div class="proxyKeyConnection">
        ${connectionValue(w("openAiUrl"), `${origin}/v1`)}
        ${connectionValue(w("nativeUrl"), origin)}
      </div>
      <div class="proxyKeyList">
        <div class="proxyKeyListHeading"><strong>${escapeHtml(w("listTitle"))}</strong></div>
        ${snapshot.authenticated
          ? (items.length ? items.map(keyItem).join("") : `<div class="proxyKeyEmpty"><p>${escapeHtml(w("noKeys"))}</p></div>`)
          : `<div class="proxyKeyEmpty"><p>${escapeHtml(w("signIn"))}</p></div>`}
      </div>
    </section>`;
}

function findItem(id) {
  return snapshot?.summary?.items?.find((item) => String(item.id) === String(id)) || null;
}

function ensureCreateDialog() {
  if (createDialog) return createDialog;
  createDialog = document.createElement("dialog");
  createDialog.innerHTML = `
    <form class="dialogCard proxyKeyDialog" data-proxy-create-form>
      <header><h2 data-proxy-create-title></h2></header>
      <label><span data-proxy-name-label></span><input name="name" required maxlength="80" autocomplete="off" /></label>
      <label><span data-proxy-notes-label></span><textarea name="notes" rows="3" maxlength="240"></textarea></label>
      <input type="hidden" name="editId" />
      <footer><button class="button primary" type="submit" data-proxy-save></button><button class="button" type="button" data-proxy-cancel></button></footer>
    </form>`;
  document.body.appendChild(createDialog);
  createDialog.querySelector("[data-proxy-cancel]").addEventListener("click", () => createDialog.close());
  createDialog.querySelector("[data-proxy-create-form]").addEventListener("submit", submitCreateDialog);
  return createDialog;
}

function openCreateDialog({ title, name = "", notes = "", editId = "" }) {
  if (!snapshot?.authenticated) return runAction("sign-in");
  const dialog = ensureCreateDialog();
  dialog.querySelector("[data-proxy-create-title]").textContent = title;
  dialog.querySelector("[data-proxy-name-label]").textContent = w("name");
  dialog.querySelector("[data-proxy-notes-label]").textContent = w("notesLabel");
  dialog.querySelector("[data-proxy-save]").textContent = w("save");
  dialog.querySelector("[data-proxy-cancel]").textContent = w("cancel");
  dialog.querySelector("[name='name']").value = name;
  dialog.querySelector("[name='notes']").value = notes;
  dialog.querySelector("[name='editId']").value = editId;
  dialog.showModal();
  dialog.querySelector("[name='name']").focus();
}

async function submitCreateDialog(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const editId = String(form.get("editId") || "");
  const body = { name: String(form.get("name") || "").trim(), notes: String(form.get("notes") || "").trim() || null };
  try {
    if (editId) {
      await request(`/admin/client-keys/${encodeURIComponent(editId)}`, { method: "PATCH", body: JSON.stringify(body) });
      createDialog.close();
      scheduleLoad(150);
      return;
    }
    const created = await request("/admin/client-keys", { method: "POST", body: JSON.stringify(body) });
    createDialog.close();
    showToken(created?.token || "", created?.clientKey?.name || body.name);
    scheduleLoad(150);
  } catch (error) {
    window.alert(`${editId ? w("updateFailed") : w("createFailed")}：${error.message}`);
  }
}

function ensureTokenDialog() {
  if (tokenDialog) return tokenDialog;
  tokenDialog = document.createElement("dialog");
  tokenDialog.innerHTML = `
    <form method="dialog" class="dialogCard proxyKeyDialog">
      <header><h2 data-proxy-token-title></h2></header>
      <p data-proxy-token-description></p>
      <div class="proxyKeyTokenValue"><code data-proxy-token></code></div>
      <div class="proxyKeyConnection" data-proxy-token-connections></div>
      <div class="proxyKeyTestResults hidden" data-proxy-test-results></div>
      <footer class="proxyKeyTokenActions">
        <button class="button primary" type="button" data-proxy-copy-token></button>
        <button class="button" type="button" data-proxy-test></button>
        <button class="button" type="submit" data-proxy-token-done></button>
      </footer>
    </form>`;
  document.body.appendChild(tokenDialog);
  tokenDialog.querySelector("[data-proxy-copy-token]").addEventListener("click", async (event) => {
    await copyText(tokenDialog.querySelector("[data-proxy-token]").textContent || "", event.currentTarget);
  });
  tokenDialog.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("button[data-proxy-copy]");
    if (copyButton) await copyText(copyButton.dataset.proxyCopy || "", copyButton);
  });
  tokenDialog.querySelector("[data-proxy-test]").addEventListener("click", testCurrentToken);
  tokenDialog.addEventListener("close", () => {
    tokenDialog.querySelector("[data-proxy-token]").textContent = "";
    tokenDialog.querySelector("[data-proxy-test-results]").innerHTML = "";
    tokenDialog.querySelector("[data-proxy-test-results]").classList.add("hidden");
  });
  return tokenDialog;
}

function showToken(token, name) {
  if (!token) {
    window.alert(w("createFailed"));
    return;
  }
  const dialog = ensureTokenDialog();
  const origin = window.location.origin;
  dialog.querySelector("[data-proxy-token-title]").textContent = w("oneTimeTitle");
  dialog.querySelector("[data-proxy-token-description]").textContent = `${name}｜${w("oneTimeDescription")}`;
  dialog.querySelector("[data-proxy-token]").textContent = token;
  dialog.querySelector("[data-proxy-copy-token]").textContent = w("copyToken");
  dialog.querySelector("[data-proxy-test]").textContent = w("test");
  dialog.querySelector("[data-proxy-token-done]").textContent = w("done");
  dialog.querySelector("[data-proxy-token-connections]").innerHTML = connectionValue(w("openAiUrl"), `${origin}/v1`) + connectionValue(w("nativeUrl"), origin);
  dialog.showModal();
}

function testRow(label, state, detail) {
  const tone = state === "ok" ? "good" : state === "warning" ? "warning" : "bad";
  const text = state === "ok" ? w("ok") : state === "warning" ? w("notReady") : w("unavailable");
  return `<div class="proxyKeyTestResult"><span>${escapeHtml(label)}${detail ? ` · ${escapeHtml(detail)}` : ""}</span><strong class="${tone}">${escapeHtml(text)}</strong></div>`;
}

async function testCurrentToken(event) {
  const button = event.currentTarget;
  const token = tokenDialog.querySelector("[data-proxy-token]").textContent || "";
  if (!token) return;
  button.disabled = true;
  button.textContent = w("testing");
  const results = tokenDialog.querySelector("[data-proxy-test-results]");
  try {
    const data = await request("/admin/client-key-test", { method: "POST", body: JSON.stringify({ token }) });
    results.innerHTML = [
      testRow(w("authCheck"), data.authentication?.ok ? "ok" : "bad", data.authentication?.message),
      testRow(w("upstreamCheck"), data.upstream?.ok ? "ok" : "warning", data.upstream?.message),
      testRow(w("modelCheck"), data.models?.ok ? "ok" : "warning", data.models?.message),
    ].join("");
  } catch (error) {
    results.innerHTML = testRow(w("authCheck"), "bad", `${w("testFailed")}：${error.message}`);
  } finally {
    results.classList.remove("hidden");
    button.disabled = false;
    button.textContent = w("test");
  }
}

async function copyText(value, button) {
  if (!value) return;
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
  else {
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
    const previous = button.textContent;
    button.textContent = w("copied");
    window.setTimeout(() => { button.textContent = previous; }, 1200);
  }
}

function clickPage(page) {
  document.querySelector(`.tab[data-page="${page}"]`)?.click();
}

async function runAction(action, id = "") {
  if (action === "sign-in" || action === "settings") {
    clickPage("settings");
    return;
  }
  if (action === "dismiss-security") {
    localStorage.setItem(securityNoticeKey, "1");
    render();
    return;
  }
  if (!snapshot?.authenticated) {
    window.alert(w("loginRequired"));
    clickPage("settings");
    return;
  }
  const item = findItem(id);
  if (action === "create") {
    openCreateDialog({ title: w("createTitle") });
    return;
  }
  if (action === "edit" && item) {
    openCreateDialog({ title: w("editTitle"), name: item.name, notes: item.notes || "", editId: item.id });
    return;
  }
  if (action === "replacement" && item) {
    const suffix = item.source === "environment" ? "-managed" : "-new";
    openCreateDialog({ title: w("replacementTitle"), name: `${item.name}${suffix}`, notes: `Replacement for ${item.name}` });
    return;
  }
  if (action === "toggle" && item) {
    if (item.enabled && !window.confirm(w("confirmDisable"))) return;
    try {
      await request(`/admin/client-keys/${encodeURIComponent(item.id)}/${item.enabled ? "disable" : "enable"}`, { method: "POST" });
      scheduleLoad(100);
    } catch (error) { window.alert(`${w("updateFailed")}：${error.message}`); }
    return;
  }
  if (action === "delete" && item) {
    if (!window.confirm(w("confirmDelete"))) return;
    try {
      await request(`/admin/client-keys/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      scheduleLoad(100);
    } catch (error) { window.alert(`${w("updateFailed")}：${error.message}`); }
  }
}

function scheduleLoad(delay = 300) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(load, delay);
}

if (root) {
  root.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("button[data-proxy-copy]");
    if (copyButton) {
      await copyText(copyButton.dataset.proxyCopy || "", copyButton);
      return;
    }
    const actionButton = event.target.closest("button[data-proxy-action]");
    if (actionButton) await runAction(actionButton.dataset.proxyAction, actionButton.dataset.proxyId || "");
  });
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  [document.getElementById("clientKeyList"), document.getElementById("usageOverview")]
    .filter(Boolean)
    .forEach((element) => new MutationObserver(() => scheduleLoad(450)).observe(element, { childList: true, subtree: true }));
  window.addEventListener("focus", () => scheduleLoad(100));
  load();
}
