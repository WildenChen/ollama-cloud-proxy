const state = {
  token: localStorage.getItem("ollamaProxyAdminToken") || "",
  locale:
    localStorage.getItem("ollamaProxyAdminLocale") ||
    (navigator.language?.toLowerCase().startsWith("zh") ? "zh-Hant" : "en"),
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

const dictionaries = {
  "zh-Hant": {
    title: "Ollama 雲端代理管理台",
    appTitle: "Ollama 雲端代理",
    summaryDefault: "管理總覽",
    languageLabel: "語言",
    adminTokenLabel: "管理權杖",
    adminTokenPlaceholder: "輸入管理權杖",
    save: "儲存",
    saveTitle: "儲存管理權杖並載入後台資料",
    refreshTitle: "重新向後端載入最新狀態",
    refreshAria: "重新整理後台狀態",
    systemMetrics: "系統指標",
    activeRequestsMetric: "處理中",
    queuedRequestsMetric: "排隊中",
    availableKeysMetric: "可用金鑰",
    weeklyResetMetric: "每週重置",
    upstreamRequests: "上游請求",
    keyPoolTitle: "金鑰池",
    keyPoolDescription: "管理已加密的 Ollama 金鑰、冷卻與封鎖狀態。",
    addKey: "新增金鑰",
    addKeyTitle: "新增一把 Ollama API 金鑰到金鑰池",
    addKeyAria: "新增 Ollama 金鑰",
    eventsTitle: "事件",
    eventsDescription: "近期代理與金鑰活動。",
    eventLevelLabel: "事件層級",
    eventTypeLabel: "事件類型",
    allLevels: "所有層級",
    allTypes: "所有類型",
    levelDebug: "除錯",
    levelInfo: "資訊",
    levelWarn: "警告",
    levelError: "錯誤",
    clientsTitle: "客戶端",
    clientsDescription: "依今日權杖身分統計。",
    modelsTitle: "模型",
    modelsDescription: "別名與請求次數。",
    dialogTitle: "新增 Ollama 金鑰",
    closeDialogTitle: "關閉新增金鑰視窗",
    nameLabel: "名稱",
    apiKeyLabel: "API 金鑰",
    notesLabel: "備註",
    notesPlaceholder: "可留空",
    cancel: "取消",
    cancelTitle: "放棄輸入並關閉視窗",
    createKey: "建立金鑰",
    createKeyTitle: "加密保存這把金鑰並加入輪替池",
    queueLimit: (max, timeout) => `上限 ${max}，逾時 ${timeout} 毫秒`,
    totalKeys: (count) => `共 ${count} 把金鑰`,
    weeklyBlocked: (count) => `${count} 把每週額度受限`,
    summaryLine: (available, total, active, queued) => `${available}/${total} 把金鑰可用，${active} 個處理中，${queued} 個排隊中`,
    noToken: "請先輸入管理權杖，再按「儲存」載入金鑰池。",
    loadingKeys: "正在載入金鑰池。",
    loadNotice: "無法載入資料，請確認管理權杖後按「儲存」或「重新整理」。",
    noKeys: "目前沒有金鑰。請新增第一把已加密保存的 Ollama 金鑰。",
    noEvents: "目前沒有近期事件。",
    noClients: "今日尚無客戶端流量。",
    noModels: "目前沒有模型統計或別名設定。",
    tokenRequired: "請先輸入並儲存管理權杖。",
    requestFailed: (status) => `請求失敗：${status}`,
    keyCreated: "金鑰已建立。",
    actionDone: (action) => `金鑰操作完成：${action}`,
    confirmDelete: "確定要停用並刪除這把金鑰嗎？",
    promptNewKey: "新的 Ollama API 金鑰",
    creating: "建立中",
    noBlockReason: "無封鎖原因",
    perKeyLimit: "每把上限 1",
    consecutiveFailures: (count) => `連續 ${count} 次`,
    todayRequests: (count) => `請求 ${count}`,
    successCount: (count) => `成功 ${count}`,
    failureCount: (count) => `失敗 ${count}`,
    activeCount: (count) => `處理中 ${count}`,
    queuedCount: (count) => `排隊中 ${count}`,
    alias: "別名",
    statusCell: "狀態",
    activeCell: "處理中",
    successCell: "成功",
    failureCell: "失敗",
    cooldownCell: "冷卻",
    eventFallback: "事件已記錄",
    otherEvent: "其他事件",
    durationMs: (value) => `${value} 毫秒`,
    justNow: "剛剛",
    minutesAgo: (value) => `${value} 分鐘前`,
    hoursAgo: (value) => `${value} 小時前`,
    keyNameFallback: "金鑰",
    status: {
      available: "可用",
      unknown: "未知",
      cooling_down: "冷卻中",
      session_blocked: "單次額度受限",
      weekly_blocked: "每週額度受限",
      invalid: "無效",
      disabled: "已停用",
    },
    action: {
      test: "測試",
      enable: "啟用",
      disable: "停用",
      "reset-cooldown": "重置冷卻",
      rotate: "輪替",
      delete: "刪除",
      handled: "已處理",
    },
    actionTitle: {
      test: "呼叫上游模型列表測試這把金鑰是否可用",
      enable: "重新啟用這把金鑰，讓代理可再次選用",
      disable: "暫停使用這把金鑰，不會刪除保存資料",
      "reset-cooldown": "清除冷卻時間，讓這把金鑰重新進入可選池",
      rotate: "替換這把金鑰的 API key，保留名稱與統計資料",
      delete: "軟刪除這把金鑰，列表不再顯示但保留事件紀錄",
    },
    level: {
      debug: "除錯",
      info: "資訊",
      warn: "警告",
      error: "錯誤",
    },
    usageSource: {
      unknown: "來源未知",
      not_available: "來源未知",
      inferred: "系統推斷",
      inferred_from_error: "系統推斷",
      estimated: "估算",
      estimated_by_proxy: "代理估算",
      manual: "手動",
      dashboard_scraped: "後台擷取",
      official_api: "官方 API",
      upstream: "上游回報",
    },
    resetSource: {
      unknown: "重置未知",
      fallback: "備援推算",
      fixed_weekly: "固定每週重置",
      inferred: "系統推斷",
      inferred_from_error: "系統推斷",
      manual: "手動",
      manual_anchor: "手動基準",
      dashboard_observed: "後台觀察",
      official_api: "官方 API",
    },
    eventType: {
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
    },
  },
  en: {
    title: "Ollama Cloud Proxy Admin",
    appTitle: "Ollama Cloud Proxy",
    summaryDefault: "Admin overview",
    languageLabel: "Language",
    adminTokenLabel: "Admin token",
    adminTokenPlaceholder: "Enter admin token",
    save: "Save",
    saveTitle: "Save admin token and load admin data",
    refreshTitle: "Reload latest backend status",
    refreshAria: "Refresh admin status",
    systemMetrics: "System metrics",
    activeRequestsMetric: "Active",
    queuedRequestsMetric: "Queued",
    availableKeysMetric: "Available keys",
    weeklyResetMetric: "Weekly reset",
    upstreamRequests: "Upstream requests",
    keyPoolTitle: "Key Pool",
    keyPoolDescription: "Manage encrypted Ollama keys, cooldowns, and blocked states.",
    addKey: "Add Key",
    addKeyTitle: "Add an Ollama API key to the key pool",
    addKeyAria: "Add Ollama key",
    eventsTitle: "Events",
    eventsDescription: "Recent proxy and key activity.",
    eventLevelLabel: "Event level",
    eventTypeLabel: "Event type",
    allLevels: "All levels",
    allTypes: "All types",
    levelDebug: "Debug",
    levelInfo: "Info",
    levelWarn: "Warn",
    levelError: "Error",
    clientsTitle: "Clients",
    clientsDescription: "Today by client token identity.",
    modelsTitle: "Models",
    modelsDescription: "Aliases and request counts.",
    dialogTitle: "Add Ollama Key",
    closeDialogTitle: "Close add-key dialog",
    nameLabel: "Name",
    apiKeyLabel: "API key",
    notesLabel: "Notes",
    notesPlaceholder: "Optional",
    cancel: "Cancel",
    cancelTitle: "Discard input and close dialog",
    createKey: "Create Key",
    createKeyTitle: "Encrypt and save this key into the rotation pool",
    queueLimit: (max, timeout) => `Limit ${max}, timeout ${timeout} ms`,
    totalKeys: (count) => `${count} total keys`,
    weeklyBlocked: (count) => `${count} weekly-blocked keys`,
    summaryLine: (available, total, active, queued) => `${available}/${total} keys available, ${active} active, ${queued} queued`,
    noToken: "Enter the admin token, then press Save to load the key pool.",
    loadingKeys: "Loading key pool.",
    loadNotice: "Unable to load data. Check the admin token, then press Save or Refresh.",
    noKeys: "No keys yet. Add the first encrypted Ollama key.",
    noEvents: "No recent events.",
    noClients: "No client traffic today.",
    noModels: "No model stats or aliases yet.",
    tokenRequired: "Enter and save the admin token first.",
    requestFailed: (status) => `Request failed: ${status}`,
    keyCreated: "Key created.",
    actionDone: (action) => `Key action completed: ${action}`,
    confirmDelete: "Disable and delete this key?",
    promptNewKey: "New Ollama API key",
    creating: "Creating",
    noBlockReason: "No block reason",
    perKeyLimit: "Per-key limit 1",
    consecutiveFailures: (count) => `${count} consecutive`,
    todayRequests: (count) => `Requests ${count}`,
    successCount: (count) => `Success ${count}`,
    failureCount: (count) => `Failure ${count}`,
    activeCount: (count) => `Active ${count}`,
    queuedCount: (count) => `Queued ${count}`,
    alias: "Alias",
    statusCell: "Status",
    activeCell: "Active",
    successCell: "Success",
    failureCell: "Failure",
    cooldownCell: "Cooldown",
    eventFallback: "Event recorded",
    otherEvent: "Other event",
    durationMs: (value) => `${value} ms`,
    justNow: "just now",
    minutesAgo: (value) => `${value} min ago`,
    hoursAgo: (value) => `${value} hr ago`,
    keyNameFallback: "Key",
    status: {
      available: "Available",
      unknown: "Unknown",
      cooling_down: "Cooling down",
      session_blocked: "Session blocked",
      weekly_blocked: "Weekly blocked",
      invalid: "Invalid",
      disabled: "Disabled",
    },
    action: {
      test: "Test",
      enable: "Enable",
      disable: "Disable",
      "reset-cooldown": "Reset Cooldown",
      rotate: "Rotate",
      delete: "Delete",
      handled: "Handled",
    },
    actionTitle: {
      test: "Call upstream /v1/models to test whether this key works",
      enable: "Enable this key so the proxy can select it again",
      disable: "Pause this key without deleting saved data",
      "reset-cooldown": "Clear cooldown and return this key to the candidate pool",
      rotate: "Replace this API key while keeping name and statistics",
      delete: "Soft-delete this key; events remain available",
    },
    level: {
      debug: "Debug",
      info: "Info",
      warn: "Warn",
      error: "Error",
    },
    usageSource: {
      unknown: "Unknown source",
      not_available: "Unknown source",
      inferred: "Inferred",
      inferred_from_error: "Inferred",
      estimated: "Estimated",
      estimated_by_proxy: "Proxy estimate",
      manual: "Manual",
      dashboard_scraped: "Dashboard scrape",
      official_api: "Official API",
      upstream: "Upstream",
    },
    resetSource: {
      unknown: "Unknown reset",
      fallback: "Fallback",
      fixed_weekly: "Fixed weekly reset",
      inferred: "Inferred",
      inferred_from_error: "Inferred",
      manual: "Manual",
      manual_anchor: "Manual anchor",
      dashboard_observed: "Dashboard observed",
      official_api: "Official API",
    },
    eventType: {
      request_started: "Request Started",
      request_finished: "Request Finished",
      request_failed: "Request Failed",
      queue_wait_started: "Queued",
      queue_timeout: "Queue Timeout",
      queue_rejected: "Queue Full",
      key_selected: "Key Selected",
      key_success: "Key Success",
      key_failure: "Key Failure",
      key_cooldown_started: "Key Cooldown Started",
      key_cooldown_reset: "Key Cooldown Reset",
      key_session_blocked: "Key Session Blocked",
      key_weekly_blocked: "Key Weekly Blocked",
      key_invalid: "Key Invalid",
      key_enabled: "Key Enabled",
      key_disabled: "Key Disabled",
      key_created: "Key Created",
      key_updated: "Key Updated",
      key_rotated: "Key Rotated",
      key_deleted: "Key Deleted",
      key_tested: "Key Tested",
      no_available_key: "No Available Key",
      upstream_error: "Upstream Error",
      client_aborted: "Client Aborted",
      retry_started: "Retry Started",
      retry_finished: "Retry Finished",
    },
  },
};

function t(key) {
  return dictionaries[state.locale]?.[key] ?? dictionaries["zh-Hant"][key] ?? key;
}

function mapText(group, key) {
  return dictionaries[state.locale]?.[group]?.[key] ?? dictionaries["zh-Hant"][group]?.[key] ?? key;
}

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
    throw new Error(data?.error?.message || t("requestFailed")(response.status));
  }
  return data;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(state.locale === "en" ? "en-US" : "zh-TW", {
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
  if (diff < 60_000) return t("justNow");
  if (diff < 3_600_000) return t("minutesAgo")(Math.floor(diff / 60_000));
  if (diff < 86_400_000) return t("hoursAgo")(Math.floor(diff / 3_600_000));
  return formatDate(value);
}

function statusLabel(key) {
  const status = key.enabled ? key.status : "disabled";
  return `<span class="status ${status}">${mapText("status", status)}</span>`;
}

function translateUsageSource(value) {
  return mapText("usageSource", value);
}

function translateResetSource(value) {
  return mapText("resetSource", value);
}

function translateEventMessage(event) {
  const name = event.keyName || t("keyNameFallback");
  switch (event.type) {
    case "request_started":
      return state.locale === "en" ? "Proxy request started" : "代理請求已開始";
    case "request_finished":
      return state.locale === "en" ? "Proxy request finished" : "代理請求已完成";
    case "request_failed":
      return state.locale === "en" ? "Proxy request failed" : "代理請求失敗";
    case "queue_wait_started":
      return state.locale === "en" ? "Request entered the queue" : "請求已進入佇列等待";
    case "queue_timeout":
      return state.locale === "en" ? "Request timed out in queue" : "請求等待佇列逾時";
    case "queue_rejected":
      return state.locale === "en" ? "Request rejected because the queue is full" : "請求因佇列已滿而被拒絕";
    case "key_selected":
      return state.locale === "en" ? `Selected "${name}"` : `已選用「${name}」`;
    case "key_success":
      return state.locale === "en" ? `"${name}" request succeeded` : `「${name}」請求成功`;
    case "key_failure":
      return state.locale === "en" ? `"${name}" request failed` : `「${name}」請求失敗`;
    case "key_cooldown_started":
      return state.locale === "en" ? `"${name}" entered cooldown` : `「${name}」已進入冷卻`;
    case "key_cooldown_reset":
      return state.locale === "en" ? `"${name}" cooldown reset` : `「${name}」冷卻已重置`;
    case "key_session_blocked":
      return state.locale === "en" ? `"${name}" is session-blocked` : `「${name}」被判定為單次額度受限`;
    case "key_weekly_blocked":
      return state.locale === "en" ? `"${name}" is weekly-blocked` : `「${name}」被判定為每週額度受限`;
    case "key_invalid":
      return state.locale === "en" ? `"${name}" was rejected upstream; rotate the key` : `「${name}」已被上游拒絕，請輪替金鑰`;
    case "key_enabled":
      return state.locale === "en" ? `"${name}" enabled` : `「${name}」已啟用`;
    case "key_disabled":
      return state.locale === "en" ? `"${name}" disabled` : `「${name}」已停用`;
    case "key_created":
      return state.locale === "en" ? `"${name}" created` : `「${name}」已建立`;
    case "key_updated":
      return state.locale === "en" ? `"${name}" updated` : `「${name}」已更新`;
    case "key_rotated":
      return state.locale === "en" ? `"${name}" rotated` : `「${name}」已輪替`;
    case "key_deleted":
      return state.locale === "en" ? `"${name}" deleted` : `「${name}」已刪除`;
    case "key_tested":
      return state.locale === "en" ? `"${name}" test completed` : `「${name}」測試完成`;
    case "no_available_key":
      return state.locale === "en" ? "No Ollama key is currently available" : "目前沒有可用的 Ollama 金鑰";
    case "upstream_error":
      return state.locale === "en" ? "Upstream service returned an error" : "上游服務回應錯誤";
    case "client_aborted":
      return state.locale === "en" ? "Client aborted the request" : "客戶端已中止請求";
    case "retry_started":
      return state.locale === "en" ? "Retrying with another key" : "已改用其他金鑰重試";
    case "retry_finished":
      return state.locale === "en" ? "Retry finished" : "重試已完成";
    default:
      return mapText("eventType", event.type) || t("eventFallback");
  }
}

function renderStats() {
  const stats = state.stats;
  if (!stats) {
    $("summaryLine").textContent = t("summaryDefault");
    return;
  }
  const version = `v${stats.version || "1.1.1"}`;
  $("appVersion").textContent = version;
  $("activeRequests").textContent = formatNumber(stats.concurrency.activeRequests);
  $("queuedRequests").textContent = formatNumber(stats.concurrency.queuedRequests);
  $("queueLimit").textContent = t("queueLimit")(
    formatNumber(stats.concurrency.requestQueueMax),
    formatNumber(stats.concurrency.requestQueueTimeoutMs)
  );
  $("availableKeys").textContent = formatNumber(stats.keys.availableKeys);
  $("totalKeys").textContent = t("totalKeys")(formatNumber(stats.keys.totalKeys));
  $("weeklyReset").textContent = formatDate(stats.usage.nextWeeklyResetAt);
  $("weeklyBlocked").textContent = t("weeklyBlocked")(formatNumber(stats.usage.weeklyBlockedKeysCount));
  $("summaryLine").textContent = t("summaryLine")(
    formatNumber(stats.keys.availableKeys),
    formatNumber(stats.keys.totalKeys),
    formatNumber(stats.concurrency.activeRequests),
    formatNumber(stats.concurrency.queuedRequests)
  );
}

function renderKeys() {
  const root = $("keyList");
  if (!state.token) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noToken"))}</div>`;
    return;
  }
  if (state.loading) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("loadingKeys"))}</div>`;
    return;
  }
  if (state.loadNotice) {
    root.innerHTML = `<div class="empty">${escapeHtml(state.loadNotice)}</div>`;
    return;
  }
  if (state.keys.length === 0) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noKeys"))}</div>`;
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
            <div class="cell"><span>${escapeHtml(t("statusCell"))}</span><strong>${statusLabel(key)}</strong><small>${escapeHtml(key.blockReason || t("noBlockReason"))}</small></div>
            <div class="cell"><span>${escapeHtml(t("activeCell"))}</span><strong>${formatNumber(key.activeRequests)}</strong><small>${escapeHtml(t("perKeyLimit"))}</small></div>
            <div class="cell"><span>${escapeHtml(t("successCell"))}</span><strong>${formatNumber(key.totalSuccesses)}</strong><small>${lastSuccess}</small></div>
            <div class="cell"><span>${escapeHtml(t("failureCell"))}</span><strong>${formatNumber(key.totalFailures)}</strong><small>${escapeHtml(t("consecutiveFailures")(formatNumber(key.consecutiveFailures)))}</small></div>
            <div class="cell"><span>${escapeHtml(t("cooldownCell"))}</span><strong>${cooldown}</strong><small>${escapeHtml(translateUsageSource(key.usageSource))} / ${escapeHtml(translateResetSource(key.resetSource))}</small></div>
          </div>
          <div class="actions">
            <button class="button" data-action="test" title="${mapText("actionTitle", "test")}" aria-label="${mapText("actionTitle", "test")}">${mapText("action", "test")}</button>
            <button class="button" data-action="${key.enabled ? "disable" : "enable"}" title="${key.enabled ? mapText("actionTitle", "disable") : mapText("actionTitle", "enable")}" aria-label="${key.enabled ? mapText("actionTitle", "disable") : mapText("actionTitle", "enable")}">${key.enabled ? mapText("action", "disable") : mapText("action", "enable")}</button>
            <button class="button warn" data-action="reset-cooldown" title="${mapText("actionTitle", "reset-cooldown")}" aria-label="${mapText("actionTitle", "reset-cooldown")}">${mapText("action", "reset-cooldown")}</button>
            <button class="button" data-action="rotate" title="${mapText("actionTitle", "rotate")}" aria-label="${mapText("actionTitle", "rotate")}">${mapText("action", "rotate")}</button>
            <button class="button danger" data-action="delete" title="${mapText("actionTitle", "delete")}" aria-label="${mapText("actionTitle", "delete")}">${mapText("action", "delete")}</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderEvents() {
  const root = $("eventList");
  if (state.events.length === 0) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noEvents"))}</div>`;
    return;
  }

  root.innerHTML = state.events
    .map((event) => {
      const meta = [
        relativeDate(event.createdAt),
        mapText("level", event.level),
        event.clientName,
        event.keyName,
        event.statusCode ? `HTTP ${event.statusCode}` : null,
        event.durationMs ? t("durationMs")(event.durationMs) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <article class="eventRow ${event.level}">
          <strong>${escapeHtml(mapText("eventType", event.type) || t("otherEvent"))}</strong>
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
    root.innerHTML = `<div class="empty">${escapeHtml(t("noClients"))}</div>`;
    return;
  }
  root.innerHTML = clients
    .map(
      (client) => `
        <div class="miniRow">
          <strong>${escapeHtml(client.clientName)}</strong>
          <span>${escapeHtml(t("activeCount")(formatNumber(client.activeRequests)))}</span>
          <span>${escapeHtml(t("queuedCount")(formatNumber(client.queuedRequests)))}</span>
          <span>${escapeHtml(t("successCount")(formatNumber(client.totalSuccessesToday)))}</span>
          <span>${escapeHtml(t("failureCount")(formatNumber(client.totalFailuresToday)))}</span>
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
      a: t("alias"),
      b: model,
      c: "",
      d: "",
    })),
    ...today.map((model) => ({
      name: model.model,
      a: t("todayRequests")(formatNumber(model.totalRequests)),
      b: t("successCount")(formatNumber(model.totalSuccesses)),
      c: t("failureCount")(formatNumber(model.totalFailures)),
      d: "",
    })),
  ];
  if (rows.length === 0) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noModels"))}</div>`;
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
  applyLocale();
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
    if (showErrors) showNotice(t("tokenRequired"), "error");
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
      state.loadNotice = t("loadNotice");
      renderAll();
    }
    if (showErrors) showNotice(error.message, "error");
    return false;
  }
}

async function actionForKey(keyId, action) {
  if (action === "delete" && !confirm(t("confirmDelete"))) return;
  try {
    if (action === "rotate") {
      const apiKey = prompt(t("promptNewKey"));
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
    showNotice(t("actionDone")(mapText("action", action) || mapText("action", "handled")));
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

function applyLocale() {
  const dictionary = dictionaries[state.locale] || dictionaries["zh-Hant"];
  document.documentElement.lang = state.locale;
  document.title = dictionary.title;
  $("localeSelect").value = state.locale;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    const value = dictionary[key];
    if (typeof value === "string") element.textContent = value;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    const value = dictionary[key];
    if (typeof value === "string") element.setAttribute("placeholder", value);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    const key = element.dataset.i18nTitle;
    const value = dictionary[key];
    if (typeof value === "string") element.setAttribute("title", value);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    const key = element.dataset.i18nAriaLabel;
    const value = dictionary[key];
    if (typeof value === "string") element.setAttribute("aria-label", value);
  });
  renderEventTypeOptions();
}

function renderEventTypeOptions() {
  const selected = $("eventType").value;
  $("eventType").innerHTML = [
    `<option value="">${escapeHtml(t("allTypes"))}</option>`,
    ...eventTypes.map((type) => `<option value="${type}">${escapeHtml(mapText("eventType", type) || t("otherEvent"))}</option>`),
  ].join("");
  $("eventType").value = selected;
}

function bindEvents() {
  applyLocale();
  $("adminToken").value = state.token;
  $("localeSelect").addEventListener("change", () => {
    state.locale = $("localeSelect").value;
    localStorage.setItem("ollamaProxyAdminLocale", state.locale);
    renderAll();
  });
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
    submitButton.textContent = t("creating");
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
      showNotice(t("keyCreated"));
      refresh({ showErrors: false, preserveOnError: true });
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      state.creatingKey = false;
      submitButton.disabled = false;
      submitButton.textContent = originalLabel || t("createKey");
    }
  });
  $("keyList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest("[data-key-id]");
    actionForKey(card.dataset.keyId, button.dataset.action);
  });
}

bindEvents();
renderAll();
if (state.token) refresh({ showErrors: false });
