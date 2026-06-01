const state = {
  token: localStorage.getItem("ollamaProxyAdminToken") || "",
  stats: null,
  keys: [],
  events: [],
  loaded: false,
  loading: false,
  loadNotice: null,
  creatingKey: false,
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

const statusText = {
  available: "可用",
  unknown: "未知",
  cooling_down: "冷卻中",
  session_blocked: "單次額度受限",
  weekly_blocked: "每週額度受限",
  invalid: "無效",
  disabled: "已停用",
};

const actionText = {
  test: "測試",
  enable: "啟用",
  disable: "停用",
  "reset-cooldown": "重置冷卻",
  rotate: "輪替",
  delete: "刪除",
};

const actionTitle = {
  test: "呼叫上游模型列表測試這把金鑰是否可用",
  enable: "重新啟用這把金鑰，讓代理可再次選用",
  disable: "暫停使用這把金鑰，不會刪除保存資料",
  "reset-cooldown": "清除冷卻時間，讓這把金鑰重新進入可選池",
  rotate: "替換這把金鑰的 API key，保留名稱與統計資料",
  delete: "軟刪除這把金鑰，列表不再顯示但保留事件紀錄",
};

const eventTypeText = {
  request_started: "請求開始",
  request_finished: "請求完成",
  request_failed: "請求失敗",
  queue_wait_started: "進入佇列",
  queue_timeout: "佇列逾時",
  queue_rejected: "佇列已滿",
  key_selected: "選用金鑰",
  key_success: "金鑰請求成功",
  key_failure: "金鑰請求失敗",
  key_cooldown_started: "金鑰開始冷卻",
  key_cooldown_reset: "金鑰冷卻已重置",
  key_session_blocked: "金鑰單次額度受限",
  key_weekly_blocked: "金鑰每週額度受限",
  key_invalid: "金鑰無效",
  key_enabled: "金鑰已啟用",
  key_disabled: "金鑰已停用",
  key_created: "金鑰已建立",
  key_updated: "金鑰已更新",
  key_rotated: "金鑰已輪替",
  key_deleted: "金鑰已刪除",
  key_tested: "金鑰已測試",
  no_available_key: "沒有可用金鑰",
  upstream_error: "上游服務錯誤",
  client_aborted: "客戶端中止",
  retry_started: "開始重試",
  retry_finished: "重試完成",
};

const levelText = {
  debug: "除錯",
  info: "資訊",
  warn: "警告",
  error: "錯誤",
};

const usageSourceText = {
  unknown: "來源未知",
  inferred: "系統推斷",
  estimated: "估算",
  manual: "手動",
  upstream: "上游回報",
};

const resetSourceText = {
  unknown: "重置未知",
  fixed_weekly: "固定每週重置",
  inferred: "系統推斷",
  manual: "手動",
};

function showNotice(message, kind = "info") {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = `notice ${kind === "error" ? "error" : ""}`;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => notice.classList.add("hidden"), 5000);
}

function closeKeyDialog() {
  const dialog = $("keyDialog");
  if (dialog.open) dialog.close();
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
    throw new Error(data?.error?.message || `請求失敗：${response.status}`);
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
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return formatDate(value);
}

function statusLabel(key) {
  const status = key.enabled ? key.status : "disabled";
  return `<span class="status ${status}">${statusText[status] || "未知"}</span>`;
}

function translateUsageSource(value) {
  return usageSourceText[value] || "來源未知";
}

function translateResetSource(value) {
  return resetSourceText[value] || "重置未知";
}

function translateEventMessage(event) {
  const name = event.keyName || "金鑰";
  switch (event.type) {
    case "request_started":
      return "代理請求已開始";
    case "request_finished":
      return "代理請求已完成";
    case "request_failed":
      return "代理請求失敗";
    case "queue_wait_started":
      return "請求已進入佇列等待";
    case "queue_timeout":
      return "請求等待佇列逾時";
    case "queue_rejected":
      return "請求因佇列已滿而被拒絕";
    case "key_selected":
      return `已選用「${name}」`;
    case "key_success":
      return `「${name}」請求成功`;
    case "key_failure":
      return `「${name}」請求失敗`;
    case "key_cooldown_started":
      return `「${name}」已進入冷卻`;
    case "key_cooldown_reset":
      return `「${name}」冷卻已重置`;
    case "key_session_blocked":
      return `「${name}」被判定為單次額度受限`;
    case "key_weekly_blocked":
      return `「${name}」被判定為每週額度受限`;
    case "key_invalid":
      return `「${name}」已被上游拒絕，請輪替金鑰`;
    case "key_enabled":
      return `「${name}」已啟用`;
    case "key_disabled":
      return `「${name}」已停用`;
    case "key_created":
      return `「${name}」已建立`;
    case "key_updated":
      return `「${name}」已更新`;
    case "key_rotated":
      return `「${name}」已輪替`;
    case "key_deleted":
      return `「${name}」已刪除`;
    case "key_tested":
      return `「${name}」測試完成`;
    case "no_available_key":
      return "目前沒有可用的 Ollama 金鑰";
    case "upstream_error":
      return "上游服務回應錯誤";
    case "client_aborted":
      return "客戶端已中止請求";
    case "retry_started":
      return "已改用其他金鑰重試";
    case "retry_finished":
      return "重試已完成";
    default:
      return eventTypeText[event.type] || "事件已記錄";
  }
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;
  $("activeRequests").textContent = formatNumber(stats.concurrency.activeRequests);
  $("queuedRequests").textContent = formatNumber(stats.concurrency.queuedRequests);
  $("queueLimit").textContent = `上限 ${stats.concurrency.requestQueueMax}，逾時 ${stats.concurrency.requestQueueTimeoutMs} 毫秒`;
  $("availableKeys").textContent = formatNumber(stats.keys.availableKeys);
  $("totalKeys").textContent = `共 ${formatNumber(stats.keys.totalKeys)} 把金鑰`;
  $("weeklyReset").textContent = formatDate(stats.usage.nextWeeklyResetAt);
  $("weeklyBlocked").textContent = `${formatNumber(stats.usage.weeklyBlockedKeysCount)} 把每週額度受限`;
  $("summaryLine").textContent = `${stats.keys.availableKeys}/${stats.keys.totalKeys} 把金鑰可用，${stats.concurrency.activeRequests} 個處理中，${stats.concurrency.queuedRequests} 個排隊中`;
}

function renderKeys() {
  const root = $("keyList");
  if (!state.token) {
    root.innerHTML = `<div class="empty">請先輸入管理權杖，再按「儲存」載入金鑰池。</div>`;
    return;
  }
  if (state.loading) {
    root.innerHTML = `<div class="empty">正在載入金鑰池。</div>`;
    return;
  }
  if (state.loadNotice) {
    root.innerHTML = `<div class="empty">${escapeHtml(state.loadNotice)}</div>`;
    return;
  }
  if (state.keys.length === 0) {
    root.innerHTML = `<div class="empty">目前沒有金鑰。請新增第一把已加密保存的 Ollama 金鑰。</div>`;
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
            <small>${escapeHtml(key.apiKeyPreview)}</small>
          </div>
          <div class="keyMeta">
            <div class="cell"><span>狀態</span><strong>${statusLabel(key)}</strong><small>${escapeHtml(key.blockReason || "無封鎖原因")}</small></div>
            <div class="cell"><span>處理中</span><strong>${formatNumber(key.activeRequests)}</strong><small>每把上限 1</small></div>
            <div class="cell"><span>成功</span><strong>${formatNumber(key.totalSuccesses)}</strong><small>${lastSuccess}</small></div>
            <div class="cell"><span>失敗</span><strong>${formatNumber(key.totalFailures)}</strong><small>連續 ${formatNumber(key.consecutiveFailures)} 次</small></div>
            <div class="cell"><span>冷卻</span><strong>${cooldown}</strong><small>${escapeHtml(translateUsageSource(key.usageSource))} / ${escapeHtml(translateResetSource(key.resetSource))}</small></div>
          </div>
          <div class="actions">
            <button class="button" data-action="test" title="${actionTitle.test}" aria-label="${actionTitle.test}">${actionText.test}</button>
            <button class="button" data-action="${key.enabled ? "disable" : "enable"}" title="${key.enabled ? actionTitle.disable : actionTitle.enable}" aria-label="${key.enabled ? actionTitle.disable : actionTitle.enable}">${key.enabled ? actionText.disable : actionText.enable}</button>
            <button class="button warn" data-action="reset-cooldown" title="${actionTitle["reset-cooldown"]}" aria-label="${actionTitle["reset-cooldown"]}">${actionText["reset-cooldown"]}</button>
            <button class="button" data-action="rotate" title="${actionTitle.rotate}" aria-label="${actionTitle.rotate}">${actionText.rotate}</button>
            <button class="button danger" data-action="delete" title="${actionTitle.delete}" aria-label="${actionTitle.delete}">${actionText.delete}</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderEvents() {
  const root = $("eventList");
  if (state.events.length === 0) {
    root.innerHTML = `<div class="empty">目前沒有近期事件。</div>`;
    return;
  }

  root.innerHTML = state.events
    .map((event) => {
      const meta = [
        relativeDate(event.createdAt),
        levelText[event.level],
        event.clientName,
        event.keyName,
        event.statusCode ? `HTTP ${event.statusCode}` : null,
        event.durationMs ? `${event.durationMs} 毫秒` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <article class="eventRow ${event.level}">
          <strong>${escapeHtml(eventTypeText[event.type] || "其他事件")}</strong>
          <div>${escapeHtml(translateEventMessage(event))}</div>
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
    root.innerHTML = `<div class="empty">今日尚無客戶端流量。</div>`;
    return;
  }
  root.innerHTML = clients
    .map(
      (client) => `
        <div class="miniRow">
          <strong>${escapeHtml(client.clientName)}</strong>
          <span>處理中 ${formatNumber(client.activeRequests)}</span>
          <span>排隊中 ${formatNumber(client.queuedRequests)}</span>
          <span>成功 ${formatNumber(client.totalSuccessesToday)}</span>
          <span>失敗 ${formatNumber(client.totalFailuresToday)}</span>
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
      a: "別名",
      b: model,
      c: "",
      d: "",
    })),
    ...today.map((model) => ({
      name: model.model,
      a: `請求 ${formatNumber(model.totalRequests)}`,
      b: `成功 ${formatNumber(model.totalSuccesses)}`,
      c: `失敗 ${formatNumber(model.totalFailures)}`,
      d: "",
    })),
  ];
  if (rows.length === 0) {
    root.innerHTML = `<div class="empty">目前沒有模型統計或別名設定。</div>`;
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

async function refresh(options = {}) {
  const showErrors = options.showErrors ?? true;
  const preserveOnError = options.preserveOnError ?? false;
  if (!state.token) {
    state.loaded = false;
    state.loading = false;
    state.loadNotice = null;
    renderAll();
    if (showErrors) showNotice("請先輸入並儲存管理權杖。", "error");
    return false;
  }
  try {
    state.loading = true;
    state.loadNotice = null;
    if (!preserveOnError) renderAll();
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
    state.loaded = true;
    state.loading = false;
    state.loadNotice = null;
    renderAll();
    return true;
  } catch (error) {
    state.loading = false;
    if (!preserveOnError) {
      state.loaded = false;
      state.loadNotice = "無法載入資料，請確認管理權杖後按「儲存」或「重新整理」。";
      renderAll();
    }
    if (showErrors) showNotice(error.message, "error");
    return false;
  }
}

async function actionForKey(keyId, action) {
  if (action === "delete" && !confirm("確定要停用並刪除這把金鑰嗎？")) return;
  try {
    if (action === "rotate") {
      const apiKey = prompt("新的 Ollama API 金鑰");
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
    showNotice(`金鑰操作完成：${actionText[action] || "已處理"}`);
    await refresh({ showErrors: true });
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
    refresh({ showErrors: true });
  });
  $("refreshButton").addEventListener("click", () => refresh({ showErrors: true }));
  $("eventLevel").addEventListener("change", () => refresh({ showErrors: true }));
  $("eventType").addEventListener("change", () => refresh({ showErrors: true }));
  $("addKeyButton").addEventListener("click", () => $("keyDialog").showModal());
  $("cancelKeyButton").addEventListener("click", closeKeyDialog);
  $("closeKeyDialogButton").addEventListener("click", closeKeyDialog);
  $("keyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.creatingKey) return;
    state.creatingKey = true;
    const submitButton = $("createKeyButton");
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "建立中";
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || ""),
      apiKey: String(form.get("apiKey") || ""),
      notes: String(form.get("notes") || ""),
    };
    try {
      const created = await api("/admin/keys", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (created?.key) {
        state.loaded = true;
        state.keys = [...state.keys.filter((key) => key.id !== created.key.id), created.key];
        renderKeys();
      }
      event.currentTarget.reset();
      closeKeyDialog();
      showNotice("金鑰已建立。");
      refresh({ showErrors: false, preserveOnError: true });
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      state.creatingKey = false;
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });
  $("keyList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest("[data-key-id]");
    actionForKey(card.dataset.keyId, button.dataset.action);
  });
  $("eventType").innerHTML += eventTypes.map((type) => `<option value="${type}">${eventTypeText[type] || "其他事件"}</option>`).join("");
}

bindEvents();
renderAll();
if (state.token) refresh({ showErrors: false });
