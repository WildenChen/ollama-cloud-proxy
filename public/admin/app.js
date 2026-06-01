const state = {
  token: localStorage.getItem("ollamaProxyAdminToken") || "",
  stats: null,
  keys: [],
  events: [],
};

const eventTypes = [
  "request_started",
  "request_finished",
  "request_failed",
  "queue_wait_started",
  "queue_timeout",
  "queue_rejected",
  "key_selected",
  "key_success",
  "key_failure",
  "key_cooldown_started",
  "key_cooldown_reset",
  "key_session_blocked",
  "key_weekly_blocked",
  "key_invalid",
  "key_enabled",
  "key_disabled",
  "key_created",
  "key_updated",
  "key_rotated",
  "key_deleted",
  "key_tested",
  "no_available_key",
  "upstream_error",
  "client_aborted",
  "retry_started",
  "retry_finished",
];

const $ = (id) => document.getElementById(id);

function showNotice(message, kind = "info") {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = `notice ${kind === "error" ? "error" : ""}`;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => notice.classList.add("hidden"), 5000);
}

function headers(json = false) {
  const result = { Authorization: `Bearer ${state.token}` };
  if (json) result["Content-Type"] = "application/json";
  return result;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `Request failed: ${response.status}`);
  }
  return data;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function relativeDate(value) {
  if (!value) return "-";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return value;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return formatDate(value);
}

function statusLabel(key) {
  const status = key.enabled ? key.status : "disabled";
  return `<span class="status ${status}">${status}</span>`;
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;
  $("activeRequests").textContent = formatNumber(stats.concurrency.activeRequests);
  $("queuedRequests").textContent = formatNumber(stats.concurrency.queuedRequests);
  $("queueLimit").textContent = `max ${stats.concurrency.requestQueueMax}, timeout ${stats.concurrency.requestQueueTimeoutMs}ms`;
  $("availableKeys").textContent = formatNumber(stats.keys.availableKeys);
  $("totalKeys").textContent = `${formatNumber(stats.keys.totalKeys)} total keys`;
  $("weeklyReset").textContent = formatDate(stats.usage.nextWeeklyResetAt);
  $("weeklyBlocked").textContent = `${formatNumber(stats.usage.weeklyBlockedKeysCount)} weekly blocked`;
  $("summaryLine").textContent = `${stats.keys.availableKeys}/${stats.keys.totalKeys} keys available, ${stats.concurrency.activeRequests} active, ${stats.concurrency.queuedRequests} queued`;
}

function renderKeys() {
  const root = $("keyList");
  if (state.keys.length === 0) {
    root.innerHTML = `<div class="empty">Enter ADMIN_TOKEN and refresh. If the pool is empty, add the first encrypted Ollama key here.</div>`;
    return;
  }

  root.innerHTML = state.keys
    .map((key) => {
      const cooldown = key.cooldownUntil ? formatDate(key.cooldownUntil) : "-";
      const lastSuccess = key.lastSuccessAt ? relativeDate(key.lastSuccessAt) : "-";
      return `
        <article class="keyCard" data-key-id="${key.id}">
          <div class="keyTitle">
            <strong>${escapeHtml(key.name)}</strong>
            <small>${escapeHtml(key.accountLabel || "no account label")} · ${escapeHtml(key.apiKeyPreview)}</small>
          </div>
          <div class="cell"><span>Status</span><strong>${statusLabel(key)}</strong><small>${escapeHtml(key.blockReason)}</small></div>
          <div class="cell"><span>Active</span><strong>${formatNumber(key.activeRequests)}</strong><small>per-key max 1</small></div>
          <div class="cell"><span>Success</span><strong>${formatNumber(key.totalSuccesses)}</strong><small>${lastSuccess}</small></div>
          <div class="cell"><span>Failures</span><strong>${formatNumber(key.totalFailures)}</strong><small>${formatNumber(key.consecutiveFailures)} consecutive</small></div>
          <div class="cell"><span>Cooldown</span><strong>${cooldown}</strong><small>${escapeHtml(key.usageSource)} / ${escapeHtml(key.resetSource)}</small></div>
          <div class="actions">
            <button class="button" data-action="test">Test</button>
            <button class="button" data-action="${key.enabled ? "disable" : "enable"}">${key.enabled ? "Disable" : "Enable"}</button>
            <button class="button warn" data-action="reset-cooldown">Reset</button>
            <button class="button" data-action="rotate">Rotate</button>
            <button class="button danger" data-action="delete">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderEvents() {
  const root = $("eventList");
  if (state.events.length === 0) {
    root.innerHTML = `<div class="empty">No recent events.</div>`;
    return;
  }

  root.innerHTML = state.events
    .map((event) => {
      const meta = [
        relativeDate(event.createdAt),
        event.clientName,
        event.keyName,
        event.statusCode ? `HTTP ${event.statusCode}` : null,
        event.durationMs ? `${event.durationMs}ms` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <article class="eventRow ${event.level}">
          <strong>${escapeHtml(event.type)}</strong>
          <div>${escapeHtml(event.message)}</div>
          <div class="eventMeta">${escapeHtml(meta)}</div>
        </article>
      `;
    })
    .join("");
}

function renderClients() {
  const root = $("clientList");
  const clients = state.stats?.clients || [];
  if (clients.length === 0) {
    root.innerHTML = `<div class="empty">No client traffic today.</div>`;
    return;
  }
  root.innerHTML = clients
    .map(
      (client) => `
        <div class="miniRow">
          <strong>${escapeHtml(client.clientName)}</strong>
          <span>active ${formatNumber(client.activeRequests)}</span>
          <span>queued ${formatNumber(client.queuedRequests)}</span>
          <span>ok ${formatNumber(client.totalSuccessesToday)}</span>
          <span>fail ${formatNumber(client.totalFailuresToday)}</span>
        </div>
      `
    )
    .join("");
}

function renderModels() {
  const root = $("modelList");
  const aliases = Object.entries(state.stats?.models?.aliases || {});
  const today = state.stats?.models?.today || [];
  const rows = [
    ...aliases.map(([alias, model]) => ({
      name: alias,
      a: "alias",
      b: model,
      c: "",
      d: "",
    })),
    ...today.map((model) => ({
      name: model.model,
      a: `req ${formatNumber(model.totalRequests)}`,
      b: `ok ${formatNumber(model.totalSuccesses)}`,
      c: `fail ${formatNumber(model.totalFailures)}`,
      d: "",
    })),
  ];
  if (rows.length === 0) {
    root.innerHTML = `<div class="empty">No model stats or aliases yet.</div>`;
    return;
  }
  root.innerHTML = rows
    .map(
      (row) => `
        <div class="miniRow">
          <strong>${escapeHtml(row.name)}</strong>
          <span>${escapeHtml(row.a)}</span>
          <span>${escapeHtml(row.b)}</span>
          <span>${escapeHtml(row.c)}</span>
          <span>${escapeHtml(row.d)}</span>
        </div>
      `
    )
    .join("");
}

function renderAll() {
  renderStats();
  renderKeys();
  renderEvents();
  renderClients();
  renderModels();
}

async function refresh() {
  if (!state.token) {
    showNotice("Enter and save ADMIN_TOKEN first.", "error");
    return;
  }
  try {
    const level = $("eventLevel").value;
    const type = $("eventType").value;
    const eventQuery = new URLSearchParams({ limit: "80" });
    if (level) eventQuery.set("level", level);
    if (type) eventQuery.set("type", type);
    const [stats, keys, events] = await Promise.all([
      api("/admin/stats"),
      api("/admin/keys"),
      api(`/admin/events?${eventQuery.toString()}`),
    ]);
    state.stats = stats;
    state.keys = keys.keys || [];
    state.events = events.events || [];
    renderAll();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function actionForKey(keyId, action) {
  if (action === "delete" && !confirm("Soft delete this key?")) return;
  try {
    if (action === "rotate") {
      const apiKey = prompt("New Ollama API key");
      if (!apiKey) return;
      await api(`/admin/keys/${keyId}/rotate`, {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      });
    } else if (action === "delete") {
      await api(`/admin/keys/${keyId}`, { method: "DELETE" });
    } else {
      await api(`/admin/keys/${keyId}/${action}`, { method: "POST" });
    }
    showNotice(`Key action completed: ${action}`);
    await refresh();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bindEvents() {
  $("adminToken").value = state.token;
  $("tokenForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.token = $("adminToken").value.trim();
    localStorage.setItem("ollamaProxyAdminToken", state.token);
    refresh();
  });
  $("refreshButton").addEventListener("click", refresh);
  $("eventLevel").addEventListener("change", refresh);
  $("eventType").addEventListener("change", refresh);
  $("addKeyButton").addEventListener("click", () => $("keyDialog").showModal());
  $("cancelKeyButton").addEventListener("click", () => $("keyDialog").close());
  $("keyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/admin/keys", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      event.currentTarget.reset();
      $("keyDialog").close();
      showNotice("Key created.");
      await refresh();
    } catch (error) {
      showNotice(error.message, "error");
    }
  });
  $("keyList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest("[data-key-id]");
    actionForKey(card.dataset.keyId, button.dataset.action);
  });
  $("eventType").innerHTML += eventTypes.map((type) => `<option value="${type}">${type}</option>`).join("");
}

bindEvents();
renderAll();
if (state.token) refresh();
