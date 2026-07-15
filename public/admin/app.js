const credentialStorageKey = "ollamaProxyAdminCredential";
const legacyCredentialStorageKey = "ollamaProxyAdminToken";
const savedCredential =
  localStorage.getItem(credentialStorageKey) || localStorage.getItem(legacyCredentialStorageKey) || "";
if (savedCredential && !localStorage.getItem(credentialStorageKey)) {
  localStorage.setItem(credentialStorageKey, savedCredential);
  localStorage.removeItem(legacyCredentialStorageKey);
}

const state = {
  token: savedCredential,
  locale:
    localStorage.getItem("ollamaProxyAdminLocale") ||
    (navigator.language?.toLowerCase().startsWith("zh") ? "zh-Hant" : "en"),
  stats: null,
  keys: [],
  clientKeys: [],
  events: [],
  modelOverview: null,
  usageSettings: null,
  systemSettings: null,
  authStatus: null,
  authMessage: null,
  page: "overview",
  testingModels: new Set(),
  loaded: false,
  loading: false,
  loadNotice: null,
  creatingKey: false,
  editingKeySettingsId: null,
  editingThresholdKeyId: null,
  savingKeySettings: false,
  savingThresholds: false,
};

const eventCategories = ["success", "failure", "quota", "auth", "network", "provider", "client"];

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
  "official_usage_refreshed",
  "official_usage_refresh_failed",
  "official_usage_blocked",
  "no_available_key",
  "upstream_error",
  "client_aborted",
  "retry_started",
  "retry_finished",
  "admin_password_changed",
  "client_key_created",
  "client_key_updated",
  "client_key_rotated",
  "client_key_enabled",
  "client_key_disabled",
  "client_key_deleted",
];

const $ = (id) => document.getElementById(id);

const dictionaries = {
  "zh-Hant": {
    title: "Ollama 雲端代理管理台",
    appTitle: "Ollama 雲端代理",
    summaryDefault: "管理總覽",
    adminPagesLabel: "管理頁面",
    overviewTab: "總覽",
    usageTab: "用量",
    settingsTab: "設定",
    modelTestTab: "模型測試",
    languageLabel: "語言",
    authChecking: "檢查登入狀態",
    signInTitle: "登入管理台",
    signInDescription: "輸入管理密碼以載入金鑰與用量資料。",
    signIn: "登入",
    signInReady: "需要登入",
    signInHint: "管理密碼會保存在這個瀏覽器，登出後即移除。",
    setupReady: "首次設定",
    setupTitle: "建立管理密碼",
    setupDescription: "這是第一次設定。建立管理密碼後即可進入管理台。",
    setupHint: "尚未建立密碼時，能連到管理頁的人都可以完成首次設定，請立即建立管理密碼。",
    authStatusUnavailable: "目前無法確認登入狀態，請確認服務是否正常。",
    savedCredentialInvalid: "已保存的管理密碼無效或已變更，請重新登入。",
    signedOutMessage: "已登出。請輸入管理密碼重新登入。",
    adminPasswordLabel: "管理密碼",
    confirmAdminPasswordLabel: "確認管理密碼",
    save: "儲存",
    refreshTitle: "重新向後端載入最新狀態",
    refreshAria: "重新整理後台狀態",
    systemMetrics: "系統指標",
    activeRequestsMetric: "處理中",
    queuedRequestsMetric: "排隊中",
    availableKeysMetric: "可用金鑰",
    weeklyResetMetric: "每週重置",
    sessionResetMetric: "5hr 重置",
    upstreamRequests: "上游請求",
    addKey: "新增金鑰",
    addKeyTitle: "新增一把 Ollama API 金鑰",
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
    systemSettingsTitle: "系統設定",
    systemSettingsDescription: "調整金鑰選取方式與介面偏好。",
    keySelectionModeLabel: "金鑰選取模式",
    keySelectionOrdered: "依序使用",
    keySelectionBalanced: "平衡分散",
    keySelectionOrderedHint: "固定從第一把可用金鑰開始，5hr 或每週額度受限後再換下一把。",
    keySelectionBalancedHint: "依可用狀態與近期負載分散請求，避免流量集中在單一金鑰。",
    saveSystemSettings: "儲存系統設定",
    systemSettingsSaved: "系統設定已儲存。",
    adminPasswordTitle: "管理密碼",
    adminPasswordDescription: "管理頁與所有管理 API 都只使用管理密碼。",
    signOut: "登出",
    signedIn: "已登入",
    signedInDescription: "目前管理憑證只保存在這個瀏覽器。",
    newAdminPasswordLabel: "新管理密碼",
    currentAdminPasswordLabel: "目前管理密碼",
    confirmNewAdminPasswordLabel: "確認新管理密碼",
    setupAdminPassword: "建立管理密碼",
    changeAdminPassword: "變更管理密碼",
    adminPasswordSaved: "管理密碼已更新。",
    passwordMismatch: "兩次輸入的管理密碼不一致。",
    backupTitle: "匯入匯出",
    backupDescription: "將金鑰、Cookie 與 client token 匯出或匯入單一 YAML。",
    exportYaml: "匯出 YAML",
    importYaml: "匯入 YAML",
    importDone: "YAML 已匯入。",
    clientKeysTitle: "Client API 金鑰",
    clientKeysDescription: "替不同服務建立命名 token，用於連線紀錄追蹤。",
    clientTokenLabel: "Client token",
    createClientKey: "建立 Client Key",
    clientKeyCreated: "Client key 已建立。",
    rotateClientKeyPrompt: "新的 client token",
    confirmClientKeyDelete: "確定要刪除這個 client key 嗎？",
    noClientKeys: "目前沒有 client API key。",
    eventCategoryLabel: "事件分類",
    allCategories: "所有分類",
    hasUsageOnly: "只看 token 紀錄",
    modelsTitle: "模型",
    modelsDescription: "別名與請求次數。",
    overviewPageTitle: "金鑰用量總覽",
    usageOverviewTitle: "金鑰用量總覽",
    usageOverviewDescription: "管理金鑰與檢視 Ollama Cloud 官方剩餘用量。",
    combinedQuotaTitle: "總額度池",
    combinedQuotaDescription: "合計所有已啟用金鑰的官方剩餘額度。",
    quotaPoolAccounts: (count, total) => `${count}/${total} 把計入`,
    quotaUnavailableLabel: "目前不可用",
    refreshOfficialUsage: "刷新官方用量",
    officialUsageTitle: "官方用量",
    proxyActivityTitle: "代理活動記錄",
    remainingLabel: "剩餘",
    usedLabel: "已用",
    resetAtLabel: "重置",
    planLabel: "方案",
    usageFreshnessLabel: "更新",
    noOfficialUsage: "尚未設定 Ollama 用量 Cookie，正在顯示本 proxy 活動紀錄。",
    usageCookieState: "用量 Cookie",
    setUsageCookie: "設定用量 Cookie",
    clearUsageCookie: "清除用量 Cookie",
    cookieReadyLabel: "Cookie 已設定",
    cookieMissingLabel: "未設定 Cookie",
    usageSyncedLabel: "用量已同步",
    usageReadFailedLabel: "用量讀取失敗",
    officialUnavailable: "尚無官方用量資料",
    quotaOkLabel: "正常",
    quotaWarningLabel: "接近用盡",
    quotaCriticalLabel: "即將耗盡",
    quotaMissingLabel: "待設定",
    requestCooldownLabel: "請求冷卻中",
    cooldownUntilLabel: "冷卻到",
    cooldownReasonLabel: "原因",
    keySettingsTitle: "Key 設定",
    closeKeySettingsTitle: "關閉 Key 設定",
    saveKeySettings: "儲存設定",
    keySettingsSaved: "Key 設定已儲存。",
    thresholdDialogTitle: "編輯截止值",
    closeThresholdTitle: "關閉截止值設定",
    sessionThresholdLabel: "5hr 最低剩餘百分比",
    weeklyThresholdLabel: "每週最低剩餘百分比",
    saveThresholds: "儲存截止值",
    thresholdsSaved: "截止值已儲存。",
    editThresholds: "編輯截止值",
    refreshNow: "立即刷新",
    cookieInputHint: "留空代表不變；勾選清除會移除已保存 Cookie。",
    noAccountLabel: "未設定標籤",
    totalAccountsUsage: "全部帳號總計",
    accountUsageTitle: "帳號分組",
    modelUsageTodayTitle: "今日模型分布",
    proxyEstimated: "代理估算",
    accountFallback: "未分組帳號",
    keysUnit: (count) => `${count} 把金鑰`,
    activeKeysUnit: (available, total) => `${available}/${total} 可用`,
    sessionUsageLabel: "5hr 用量",
    weeklyUsageLabel: "每週用量",
    lifetimeUsageLabel: "累計用量",
    durationLabel: "耗時",
    requestsLabel: "請求",
    successesLabel: "成功",
    failuresLabel: "失敗",
    activeRequestsLabel: "處理中",
    blockedKeysLabel: "受限",
    usageTitle: "用量與快取",
    usageDescription: "依目前可保存的資料顯示請求、token 與模型清單快取。",
    usageSettingsTitle: "重置時間",
    usageSettingsDescription: "調整 Ollama Cloud 5hr 與每週額度重置時間。",
    nextSessionReset: "下次 5hr 重置",
    nextWeeklyReset: "下次每週重置",
    usageTimezoneLabel: "時區",
    sessionAnchorLabel: "5hr 基準時間",
    sessionIntervalLabel: "5hr 週期",
    weeklyDayLabel: "每週重置日",
    weeklyTimeLabel: "每週重置時間",
    weeklyGraceLabel: "每週寬限分鐘",
    weeklyJitterLabel: "每週隨機秒數",
    saveUsageSettings: "儲存重置時間",
    usageSettingsSaved: "重置時間已儲存。",
    hoursUnit: "小時",
    dayNames: {
      1: "週一",
      2: "週二",
      3: "週三",
      4: "週四",
      5: "週五",
      6: "週六",
      7: "週日",
    },
    cacheTitle: "模型清單快取",
    cacheDescription: "顯示 /v1/models cache 狀態與命中率。",
    modelTestTitle: "模型測試",
    modelTestDescription: "顯示可用模型與上次測試結果。",
    refreshModels: "刷新模型清單",
    testModel: "測試",
    testingModel: "測試中",
    modelEnabled: "啟用模型",
    modelDisabled: "已停用",
    availableModelCount: (count, source) => `目前 ${count} 個模型，來源 ${source}`,
    cacheMetric: (label, value) => `${label} ${value}`,
    cacheValid: "有效",
    cacheExpired: "過期",
    cacheMissing: "尚無快取",
    cacheSource: {
      cache: "快取",
      aliases_only: "僅別名",
      cache_parse_error: "快取解析失敗",
      alias: "別名",
      upstream: "上游",
    },
    tokenMetrics: {
      requests: "請求",
      success: "成功",
      failure: "失敗",
      prompt: "輸入 token",
      completion: "輸出 token",
      total: "總 token",
      cached: "快取命中 token",
    },
    lastTest: "上次測試",
    neverTested: "尚未測試",
    responseTime: (value) => `${value} 毫秒`,
    dialogTitle: "新增 Ollama 金鑰",
    closeDialogTitle: "關閉新增金鑰視窗",
    nameLabel: "名稱",
    apiKeyLabel: "API 金鑰",
    accountLabelLabel: "帳號標籤",
    usageCookieLabel: "Ollama 用量 Cookie",
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
    loadingKeys: "正在載入資料。",
    loadNotice: "無法載入資料，請確認管理密碼後重新登入。",
    noKeys: "目前沒有金鑰。請新增第一把已加密保存的 Ollama 金鑰。",
    noEvents: "目前沒有近期事件。",
    noClients: "今日尚無客戶端流量。",
    noModels: "目前沒有模型統計或別名設定。",
    passwordRequired: "請先使用管理密碼登入。",
    requestFailed: (status) => `請求失敗：${status}`,
    keyCreated: "金鑰已建立。",
    actionDone: (action) => `金鑰操作完成：${action}`,
    confirmDelete: "確定要停用並刪除這把金鑰嗎？",
    promptNewKey: "新的 Ollama API 金鑰",
    creating: "建立中",
    saving: "儲存中",
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
      cooling_down: "請求冷卻中",
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
      "set-usage-cookie": "設定 Cookie",
      "clear-usage-cookie": "清除 Cookie",
      "usage-refresh": "刷新用量",
      "key-settings": "Key 設定",
      "edit-thresholds": "編輯截止值",
      delete: "刪除",
      handled: "已處理",
    },
    actionTitle: {
      test: "呼叫上游模型列表測試這把金鑰是否可用",
      enable: "重新啟用這把金鑰，讓代理可再次選用",
      disable: "暫停使用這把金鑰，不會刪除保存資料",
      "reset-cooldown": "清除冷卻時間，讓這把金鑰重新進入可選池",
      rotate: "替換這把金鑰的 API key，保留名稱與統計資料",
      "set-usage-cookie": "設定這把金鑰的 Ollama Cloud 用量 Cookie",
      "clear-usage-cookie": "清除這把金鑰保存的用量 Cookie",
      "usage-refresh": "只刷新這把金鑰的 Ollama Cloud 官方用量",
      "key-settings": "編輯這把金鑰的名稱、標籤、備註與用量 Cookie",
      "edit-thresholds": "設定這把金鑰用量剩餘百分比截止值",
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
    blockReason: {
      none: "無",
      session_usage_inferred: "5hr 額度推斷",
      weekly_usage_inferred: "每週額度推斷",
      rate_limited: "上游限流",
      invalid_api_key: "API key 無效",
      auth_failed: "認證失敗",
      network_error: "網路錯誤",
      provider_error: "上游暫時錯誤",
      manual_disabled: "手動停用",
      unknown: "未知",
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
      official_usage_refreshed: "官方用量已刷新",
      official_usage_refresh_failed: "官方用量刷新失敗",
      official_usage_blocked: "官方用量封鎖",
      no_available_key: "沒有可用金鑰",
      upstream_error: "上游服務錯誤",
      client_aborted: "客戶端中止",
      retry_started: "開始重試",
      retry_finished: "重試完成",
      admin_password_changed: "管理密碼已變更",
      client_key_created: "Client key 已建立",
      client_key_updated: "Client key 已更新",
      client_key_rotated: "Client key 已輪替",
      client_key_enabled: "Client key 已啟用",
      client_key_disabled: "Client key 已停用",
      client_key_deleted: "Client key 已刪除",
    },
    eventCategory: {
      success: "成功",
      failure: "失敗",
      quota: "額度",
      auth: "權限",
      network: "網路",
      provider: "上游",
      client: "客戶端",
    },
  },
  en: {
    title: "Ollama Cloud Proxy Admin",
    appTitle: "Ollama Cloud Proxy",
    summaryDefault: "Admin overview",
    adminPagesLabel: "Admin pages",
    overviewTab: "Overview",
    usageTab: "Usage",
    settingsTab: "Settings",
    modelTestTab: "Model Tests",
    languageLabel: "Language",
    authChecking: "Checking sign-in status",
    signInTitle: "Sign in to Admin",
    signInDescription: "Enter the admin password to load keys and usage data.",
    signIn: "Sign In",
    signInReady: "Sign-in required",
    signInHint: "The admin password is saved in this browser and removed when you sign out.",
    setupReady: "First-time setup",
    setupTitle: "Create Admin Password",
    setupDescription: "This is the first setup. Create an admin password to enter the console.",
    setupHint: "Until a password exists, anyone who can reach Admin can finish setup. Create the admin password now.",
    authStatusUnavailable: "The sign-in state could not be checked. Verify that the service is running.",
    savedCredentialInvalid: "The saved admin password is invalid or has changed. Sign in again.",
    signedOutMessage: "Signed out. Enter the admin password to sign in again.",
    adminPasswordLabel: "Admin password",
    confirmAdminPasswordLabel: "Confirm admin password",
    save: "Save",
    refreshTitle: "Reload latest backend status",
    refreshAria: "Refresh admin status",
    systemMetrics: "System metrics",
    activeRequestsMetric: "Active",
    queuedRequestsMetric: "Queued",
    availableKeysMetric: "Available keys",
    weeklyResetMetric: "Weekly reset",
    sessionResetMetric: "5hr reset",
    upstreamRequests: "Upstream requests",
    addKey: "Add Key",
    addKeyTitle: "Add an Ollama API key",
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
    systemSettingsTitle: "System Settings",
    systemSettingsDescription: "Adjust key selection and interface preferences.",
    keySelectionModeLabel: "Key selection mode",
    keySelectionOrdered: "Use in order",
    keySelectionBalanced: "Balance load",
    keySelectionOrderedHint: "Start with the first available key, then move on when its 5-hour or weekly quota is blocked.",
    keySelectionBalancedHint: "Spread requests using key availability and recent load instead of concentrating on one key.",
    saveSystemSettings: "Save System Settings",
    systemSettingsSaved: "System settings saved.",
    adminPasswordTitle: "Admin Password",
    adminPasswordDescription: "The Admin UI and every admin API use only the admin password.",
    signOut: "Sign Out",
    signedIn: "Signed in",
    signedInDescription: "The current admin credential is stored only in this browser.",
    newAdminPasswordLabel: "New admin password",
    currentAdminPasswordLabel: "Current admin password",
    confirmNewAdminPasswordLabel: "Confirm new admin password",
    setupAdminPassword: "Create Admin Password",
    changeAdminPassword: "Change Admin Password",
    adminPasswordSaved: "Admin password updated.",
    passwordMismatch: "The two admin passwords do not match.",
    backupTitle: "Import / Export",
    backupDescription: "Export or import keys, cookies, and client tokens as one YAML file.",
    exportYaml: "Export YAML",
    importYaml: "Import YAML",
    importDone: "YAML imported.",
    clientKeysTitle: "Client API Keys",
    clientKeysDescription: "Create named service tokens for connection log tracking.",
    clientTokenLabel: "Client token",
    createClientKey: "Create Client Key",
    clientKeyCreated: "Client key created.",
    rotateClientKeyPrompt: "New client token",
    confirmClientKeyDelete: "Delete this client key?",
    noClientKeys: "No client API keys yet.",
    eventCategoryLabel: "Event category",
    allCategories: "All categories",
    hasUsageOnly: "Usage only",
    modelsTitle: "Models",
    modelsDescription: "Aliases and request counts.",
    overviewPageTitle: "Key Usage Overview",
    usageOverviewTitle: "Key Usage Overview",
    usageOverviewDescription: "Manage keys and view Ollama Cloud official remaining usage.",
    combinedQuotaTitle: "Total Quota Pool",
    combinedQuotaDescription: "Counts official quota from every enabled key.",
    quotaPoolAccounts: (count, total) => `${count}/${total} included`,
    quotaUnavailableLabel: "Currently unavailable",
    refreshOfficialUsage: "Refresh Official Usage",
    officialUsageTitle: "Official Usage",
    proxyActivityTitle: "Proxy Activity",
    remainingLabel: "Remaining",
    usedLabel: "Used",
    resetAtLabel: "Reset",
    planLabel: "Plan",
    usageFreshnessLabel: "Updated",
    noOfficialUsage: "No Ollama usage cookie is configured. Showing local proxy activity.",
    usageCookieState: "Usage Cookie",
    setUsageCookie: "Set Usage Cookie",
    clearUsageCookie: "Clear Usage Cookie",
    cookieReadyLabel: "Cookie set",
    cookieMissingLabel: "Cookie missing",
    usageSyncedLabel: "Usage synced",
    usageReadFailedLabel: "Usage read failed",
    officialUnavailable: "No official usage data yet",
    quotaOkLabel: "OK",
    quotaWarningLabel: "Running low",
    quotaCriticalLabel: "Almost exhausted",
    quotaMissingLabel: "Needs setup",
    requestCooldownLabel: "Request cooldown",
    cooldownUntilLabel: "Until",
    cooldownReasonLabel: "Reason",
    keySettingsTitle: "Key Settings",
    closeKeySettingsTitle: "Close key settings",
    saveKeySettings: "Save Settings",
    keySettingsSaved: "Key settings saved.",
    thresholdDialogTitle: "Edit Cutoffs",
    closeThresholdTitle: "Close cutoff settings",
    sessionThresholdLabel: "5h minimum remaining percent",
    weeklyThresholdLabel: "Weekly minimum remaining percent",
    saveThresholds: "Save Cutoffs",
    thresholdsSaved: "Cutoffs saved.",
    editThresholds: "Edit Cutoffs",
    refreshNow: "Refresh Now",
    cookieInputHint: "Leave blank to keep the saved cookie; check clear to remove it.",
    noAccountLabel: "No label",
    totalAccountsUsage: "All accounts total",
    accountUsageTitle: "Account groups",
    modelUsageTodayTitle: "Model mix today",
    proxyEstimated: "Proxy estimated",
    accountFallback: "Ungrouped account",
    keysUnit: (count) => `${count} keys`,
    activeKeysUnit: (available, total) => `${available}/${total} available`,
    sessionUsageLabel: "5h usage",
    weeklyUsageLabel: "Weekly usage",
    lifetimeUsageLabel: "Lifetime usage",
    durationLabel: "Duration",
    requestsLabel: "Requests",
    successesLabel: "Successes",
    failuresLabel: "Failures",
    activeRequestsLabel: "Active",
    blockedKeysLabel: "Blocked",
    usageTitle: "Usage and Cache",
    usageDescription: "Shows persisted requests, tokens, and model-list cache data.",
    usageSettingsTitle: "Reset Times",
    usageSettingsDescription: "Adjust Ollama Cloud 5-hour and weekly quota reset times.",
    nextSessionReset: "Next 5hr reset",
    nextWeeklyReset: "Next weekly reset",
    usageTimezoneLabel: "Timezone",
    sessionAnchorLabel: "5hr anchor",
    sessionIntervalLabel: "5hr interval",
    weeklyDayLabel: "Weekly reset day",
    weeklyTimeLabel: "Weekly reset time",
    weeklyGraceLabel: "Weekly grace minutes",
    weeklyJitterLabel: "Weekly jitter seconds",
    saveUsageSettings: "Save reset times",
    usageSettingsSaved: "Reset times saved.",
    hoursUnit: "hours",
    dayNames: {
      1: "Mon",
      2: "Tue",
      3: "Wed",
      4: "Thu",
      5: "Fri",
      6: "Sat",
      7: "Sun",
    },
    cacheTitle: "Model List Cache",
    cacheDescription: "Shows /v1/models cache state and hit rate.",
    modelTestTitle: "Model Tests",
    modelTestDescription: "Shows available models and the latest test result.",
    refreshModels: "Refresh Models",
    testModel: "Test",
    testingModel: "Testing",
    modelEnabled: "Model enabled",
    modelDisabled: "Disabled",
    availableModelCount: (count, source) => `${count} models, source ${source}`,
    cacheMetric: (label, value) => `${label} ${value}`,
    cacheValid: "Valid",
    cacheExpired: "Expired",
    cacheMissing: "No cache yet",
    cacheSource: {
      cache: "Cache",
      aliases_only: "Aliases only",
      cache_parse_error: "Cache parse error",
      alias: "Alias",
      upstream: "Upstream",
    },
    tokenMetrics: {
      requests: "Requests",
      success: "Success",
      failure: "Failure",
      prompt: "Prompt tokens",
      completion: "Completion tokens",
      total: "Total tokens",
      cached: "Cached tokens",
    },
    lastTest: "Last test",
    neverTested: "Never tested",
    responseTime: (value) => `${value} ms`,
    dialogTitle: "Add Ollama Key",
    closeDialogTitle: "Close add-key dialog",
    nameLabel: "Name",
    apiKeyLabel: "API key",
    accountLabelLabel: "Account label",
    usageCookieLabel: "Ollama usage cookie",
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
    loadingKeys: "Loading data.",
    loadNotice: "Unable to load data. Check the admin password and sign in again.",
    noKeys: "No keys yet. Add the first encrypted Ollama key.",
    noEvents: "No recent events.",
    noClients: "No client traffic today.",
    noModels: "No model stats or aliases yet.",
    passwordRequired: "Sign in with the admin password first.",
    requestFailed: (status) => `Request failed: ${status}`,
    keyCreated: "Key created.",
    actionDone: (action) => `Key action completed: ${action}`,
    confirmDelete: "Disable and delete this key?",
    promptNewKey: "New Ollama API key",
    creating: "Creating",
    saving: "Saving",
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
      cooling_down: "Request cooldown",
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
      "set-usage-cookie": "Set Cookie",
      "clear-usage-cookie": "Clear Cookie",
      "usage-refresh": "Refresh Usage",
      "key-settings": "Key Settings",
      "edit-thresholds": "Edit Cutoffs",
      delete: "Delete",
      handled: "Handled",
    },
    actionTitle: {
      test: "Call upstream /v1/models to test whether this key works",
      enable: "Enable this key so the proxy can select it again",
      disable: "Pause this key without deleting saved data",
      "reset-cooldown": "Clear cooldown and return this key to the candidate pool",
      rotate: "Replace this API key while keeping name and statistics",
      "set-usage-cookie": "Set this key's Ollama Cloud usage cookie",
      "clear-usage-cookie": "Clear this key's saved usage cookie",
      "usage-refresh": "Refresh official Ollama Cloud usage for this key only",
      "key-settings": "Edit this key's name, label, notes, and usage cookie",
      "edit-thresholds": "Edit this key's remaining-percent cutoffs",
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
    blockReason: {
      none: "None",
      session_usage_inferred: "5h usage inferred",
      weekly_usage_inferred: "Weekly usage inferred",
      rate_limited: "Upstream rate limit",
      invalid_api_key: "Invalid API key",
      auth_failed: "Auth failed",
      network_error: "Network error",
      provider_error: "Temporary upstream error",
      manual_disabled: "Manually disabled",
      unknown: "Unknown",
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
      official_usage_refreshed: "Official Usage Refreshed",
      official_usage_refresh_failed: "Official Usage Refresh Failed",
      official_usage_blocked: "Official Usage Blocked",
      no_available_key: "No Available Key",
      upstream_error: "Upstream Error",
      client_aborted: "Client Aborted",
      retry_started: "Retry Started",
      retry_finished: "Retry Finished",
      admin_password_changed: "Admin Password Changed",
      client_key_created: "Client Key Created",
      client_key_updated: "Client Key Updated",
      client_key_rotated: "Client Key Rotated",
      client_key_enabled: "Client Key Enabled",
      client_key_disabled: "Client Key Disabled",
      client_key_deleted: "Client Key Deleted",
    },
    eventCategory: {
      success: "Success",
      failure: "Failure",
      quota: "Quota",
      auth: "Auth",
      network: "Network",
      provider: "Provider",
      client: "Client",
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

function closeKeySettingsDialog() {
  const dialog = $("keySettingsDialog");
  if (dialog.open) dialog.close();
  state.editingKeySettingsId = null;
}

function closeThresholdDialog() {
  const dialog = $("thresholdDialog");
  if (dialog.open) dialog.close();
  state.editingThresholdKeyId = null;
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
    const error = new Error(data?.error?.message || t("requestFailed")(response.status));
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadAuthStatus() {
  try {
    const response = await fetch("/admin/auth/status", { headers: { "cache-control": "no-store" } });
    state.authStatus = response.ok ? await response.json() : null;
  } catch {
    state.authStatus = null;
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatPercent(value) {
  if (value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const percent = Math.abs(number) <= 1 ? number * 100 : number;
  return `${Math.round(percent)}%`;
}

function formatQuotaNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatDuration(value) {
  const ms = Number(value || 0);
  if (ms < 1000) return `${formatNumber(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(state.locale === "en" ? "en-US" : "zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatResetTime(value) {
  if (!value) return "-";
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return formatDate(value);
  const minutes = Math.max(1, Math.round(diff / 60_000));
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours > 0) return `${hours}h ${restMinutes}m`;
  return `${restMinutes}m`;
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value) {
  if (!value) return "";
  return new Date(value).toISOString();
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
  const version = `v${stats.version || "1.1.10"}`;
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
  $("sessionReset").textContent = formatDate(stats.usage.nextSessionResetAt);
  $("weeklyBlocked").textContent = t("weeklyBlocked")(formatNumber(stats.usage.weeklyBlockedKeysCount));
  $("summaryLine").textContent = t("summaryLine")(
    formatNumber(stats.keys.availableKeys),
    formatNumber(stats.keys.totalKeys),
    formatNumber(stats.concurrency.activeRequests),
    formatNumber(stats.concurrency.queuedRequests)
  );
}



function renderEvents() {
  const root = $("eventList");
  if (state.events.length === 0) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noEvents"))}</div>`;
    return;
  }

  root.innerHTML = state.events
    .map((event) => {
      const usage = event.details && event.details.totalTokens !== undefined
        ? [
            `${t("tokenMetrics").prompt} ${formatNumber(event.details.promptTokens)}`,
            `${t("tokenMetrics").completion} ${formatNumber(event.details.completionTokens)}`,
            `${t("tokenMetrics").cached} ${formatNumber(event.details.cachedTokens)}`,
            `${t("tokenMetrics").total} ${formatNumber(event.details.totalTokens)}`,
          ].join(" · ")
        : "";
      const errorType = event.details?.errorType ? ` · ${event.details.errorType}` : "";
      const meta = [
        relativeDate(event.createdAt),
        mapText("level", event.level),
        event.clientName,
        event.keyName,
        event.model,
        event.statusCode ? `HTTP ${event.statusCode}` : null,
        event.durationMs ? t("durationMs")(event.durationMs) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <article class="eventRow ${event.level}">
          <strong>${escapeHtml(mapText("eventType", event.type) || t("otherEvent"))}</strong>
          <div>${escapeHtml(translateEventMessage(event))}</div>
          <div class="eventMeta">${escapeHtml(meta)}${escapeHtml(errorType)}</div>
          ${usage ? `<div class="eventMeta">${escapeHtml(usage)}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderAuthState() {
  const gate = $("authGate");
  const app = $("adminApp");
  const loginForm = $("loginForm");
  const setupForm = $("setupPasswordForm");
  const authenticated = state.loaded && Boolean(state.token);
  const initialized = state.authStatus?.initialized;

  gate.classList.toggle("hidden", authenticated);
  app.classList.toggle("hidden", !authenticated);
  loginForm.classList.toggle("hidden", initialized !== true || authenticated);
  setupForm.classList.toggle("hidden", initialized !== false || authenticated);

  const badge = $("authGateBadge");
  const title = $("authGateTitle");
  const description = $("authGateDescription");
  const hint = $("authGateHint");
  if (initialized === true) {
    badge.textContent = t("signInReady");
    title.textContent = t("signInTitle");
    description.textContent = t("signInDescription");
    hint.textContent = state.authMessage || t("signInHint");
    return;
  }
  if (initialized === false) {
    badge.textContent = t("setupReady");
    title.textContent = t("setupTitle");
    description.textContent = t("setupDescription");
    hint.textContent = state.authMessage || t("setupHint");
    return;
  }
  badge.textContent = t("authChecking");
  title.textContent = t("signInTitle");
  description.textContent = t("authStatusUnavailable");
  hint.textContent = state.authMessage || "";
}

function renderClientKeys() {
  const root = $("clientKeyList");
  if (!root) return;
  if (!state.clientKeys.length) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noClientKeys"))}</div>`;
    return;
  }
  root.innerHTML = state.clientKeys
    .map(
      (key) => `
        <div class="miniRow" data-client-key-id="${escapeHtml(key.id)}">
          <strong>${escapeHtml(key.name)}</strong>
          <span>${escapeHtml(key.tokenPreview)}</span>
          <span>${key.enabled ? escapeHtml(mapText("status", "available")) : escapeHtml(mapText("status", "disabled"))}</span>
          <span>${escapeHtml(key.notes || "")}</span>
          <button class="button" type="button" data-client-action="${key.enabled ? "disable" : "enable"}">${escapeHtml(key.enabled ? mapText("action", "disable") : mapText("action", "enable"))}</button>
          <button class="button" type="button" data-client-action="rotate">${escapeHtml(mapText("action", "rotate"))}</button>
          <button class="button danger" type="button" data-client-action="delete">${escapeHtml(mapText("action", "delete"))}</button>
        </div>
      `
    )
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
      d: t("tokenMetrics").total + " " + formatNumber(model.totalTokens),
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

function renderUsageOverview() {
  const root = $("usageOverview");
  if (!root) return;
  const overview = state.stats?.usage?.overview;
  if (!overview) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("loadingKeys"))}</div>`;
    return;
  }

  const totals = overview.totals;
  const keyCards = overview.keyCards || [];
  const blockedKeys = (totals.sessionBlockedKeys || 0) + (totals.weeklyBlockedKeys || 0);

  root.innerHTML = `
    <div class="officialUsageLead">
      <div>
        <span class="eyebrow">${escapeHtml(t("officialUsageTitle"))}</span>
        <strong>Ollama Cloud ${escapeHtml(t("officialUsageTitle"))}</strong>
        <small>${escapeHtml(totals.official.lastError || overview.note || t("usageOverviewDescription"))}</small>
      </div>
      <div class="officialUsageChips" aria-label="${escapeHtml(t("officialUsageTitle"))}">
        <span>${escapeHtml(t("planLabel"))} ${escapeHtml(totals.official.plan || "-")}</span>
        <span>${escapeHtml(t("usageCookieState"))} ${formatNumber(totals.official.available || 0)}/${formatNumber(totals.keyCount || 0)}</span>
        <span>${escapeHtml(t("blockedKeysLabel"))} ${formatNumber(blockedKeys)}</span>
        <button id="addKeyButton" class="button compact" type="button" title="${escapeHtml(t("addKeyTitle"))}" aria-label="${escapeHtml(t("addKeyAria"))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          <span>${escapeHtml(t("addKey"))}</span>
        </button>
        <button id="refreshUsageButton" class="button compact" type="button">${escapeHtml(t("refreshOfficialUsage"))}</button>
      </div>
    </div>
    ${renderCombinedQuotaCard(totals, keyCards)}
    <div class="officialQuotaGrid">
      ${
        keyCards.length
          ? keyCards.map((card) => renderOfficialKeyUsage(card)).join("")
          : `<div class="empty">${escapeHtml(t("noKeys"))}</div>`
      }
    </div>
  `;
}

function renderCombinedQuotaCard(totals, keyCards) {
  const session = aggregateOfficialWindow(keyCards, "session");
  const weekly = aggregateOfficialWindow(keyCards, "weekly");
  const includedCount = (keyCards || []).filter(isOfficialKeyIncludedInPool).length;
  return `
    <article class="combinedQuotaCard">
      <div class="combinedQuotaHeader">
        <div>
          <span class="eyebrow">${escapeHtml(t("combinedQuotaTitle"))}</span>
          <strong>${escapeHtml(t("combinedQuotaDescription"))}</strong>
        </div>
        <span class="quotaBadge">${escapeHtml(t("quotaPoolAccounts")(includedCount, totals.keyCount || 0))}</span>
      </div>
      <div class="combinedQuotaWindows">
        ${aggregateUsageMeter(t("sessionUsageLabel"), session, totals.official.session?.resetAt)}
        ${aggregateUsageMeter(t("weeklyUsageLabel"), weekly, totals.official.weekly?.resetAt)}
      </div>
    </article>
  `;
}

function aggregateOfficialWindow(cards, key) {
  const includedCards = (cards || []).filter(isOfficialKeyIncludedInPool);
  const capacity = includedCards.length * 100;
  const remaining = includedCards.reduce((sum, card) => sum + aggregateWindowRemaining(card, key), 0);
  const used = capacity > 0 ? capacity - remaining : 0;
  const remainingPercent = capacity > 0 ? Math.max(0, Math.min(100, (remaining / capacity) * 100)) : null;
  return { capacity, used, remainingPercent };
}

function aggregateWindowRemaining(card, key) {
  if (!card?.enabled || card.status === "disabled") return 0;
  if (["invalid", "weekly_blocked"].includes(card.status)) return 0;
  if (key === "session" && card.status === "session_blocked") return 0;
  const window = card[key];
  return Math.max(0, Math.min(100, Number(window?.remainingPercent || 0)));
}

function aggregateUsageMeter(label, window, resetAt) {
  if (!window.capacity) {
    return `
      <div class="quotaWindow missing">
        <div class="quotaWindowLabel"><span>${escapeHtml(label)}</span><strong>-</strong></div>
        <div class="quotaTrack"><span style="width: 0%"></span></div>
        <small>${escapeHtml(t("officialUnavailable"))}</small>
      </div>
    `;
  }
  const remaining = Math.max(0, Math.min(100, Number(window.remainingPercent || 0)));
  const used = Math.max(0, Number(window.used || 0));
  const state = remaining <= 1 ? "critical" : remaining <= 50 ? "warning" : "ok";
  return `
    <div class="quotaWindow ${state}">
      <div class="quotaWindowLabel">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatPercent(remaining))} ${escapeHtml(t("remainingLabel"))}</strong>
      </div>
      <div class="quotaTrack">
        <span style="width: ${remaining}%"></span>
      </div>
      <small>${escapeHtml(formatQuotaNumber(window.used))} / ${escapeHtml(formatQuotaNumber(window.capacity))} · ${escapeHtml(t("resetAtLabel"))} ${escapeHtml(formatResetTime(resetAt))}</small>
    </div>
  `;
}

function renderOfficialKeyUsage(card) {
  const status = officialQuotaStatus(card);
  const subtitle = card.apiKeyPreview;
  const usageState = officialUsageStateLabel(card);
  const usable = isOfficialKeyUsable(card);
  return `
    <article class="officialQuotaCard ${status} ${card.enabled ? "" : "disabled"}" data-key-id="${escapeHtml(card.id)}">
      <div class="officialQuotaHeader">
        <span class="quotaStatusDot" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(card.name)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </div>
        <span class="quotaBadge">${escapeHtml(card.plan || "-")}</span>
        <label class="toggleSwitch" title="${card.enabled ? mapText("actionTitle", "disable") : mapText("actionTitle", "enable")}">
          <input type="checkbox" ${card.enabled ? "checked" : ""} data-action="toggle-enable" aria-label="${card.enabled ? mapText("action", "disable") : mapText("action", "enable")}" />
          <span class="toggleSlider"></span>
        </label>
      </div>
      <div class="quotaWindows">
        ${officialUsageMeter(t("sessionUsageLabel"), card.session, card.sessionRemainingThresholdPercent, { blocked: !usable })}
        ${officialUsageMeter(t("weeklyUsageLabel"), card.weekly, card.weeklyRemainingThresholdPercent, { blocked: !usable })}
      </div>
      ${card.lastError ? `<small class="usageError">${escapeHtml(card.lastError)}</small>` : ""}
      <div class="officialQuotaFooter">
        <span>${escapeHtml(t("usageFreshnessLabel"))} ${card.fetchedAt ? relativeDate(card.fetchedAt) : "-"}</span>
        <span class="usageState ${usageState.className}">${escapeHtml(usageState.text)}</span>
        ${officialRuntimeStatusLabel(card)}
      </div>
      <div class="quotaActions">
        <div class="quotaActionsPrimary">
          <button class="button" type="button" data-action="edit-thresholds">${escapeHtml(t("editThresholds"))}</button>
          <button class="button" type="button" data-action="key-settings">${escapeHtml(t("keySettingsTitle"))}</button>
          <button class="button" type="button" data-action="usage-refresh">${escapeHtml(t("refreshNow"))}</button>
        </div>
        <div class="quotaActionsSecondary">
          <button class="button" type="button" data-action="test">${escapeHtml(mapText("action", "test"))}</button>
          <button class="button" type="button" data-action="reset-cooldown" ${card.status === "cooling_down" || card.status === "session_blocked" || card.status === "weekly_blocked" || card.status === "invalid" ? "" : "disabled"}>${escapeHtml(mapText("action", "reset-cooldown"))}</button>
          <button class="button danger" type="button" data-action="delete">${escapeHtml(mapText("action", "delete"))}</button>
        </div>
      </div>
    </article>
  `;
}

function officialUsageStateLabel(card) {
  if (card.lastError) {
    return { text: t("usageReadFailedLabel"), className: "bad" };
  }
  if (card.fetchedAt) {
    return { text: t("usageSyncedLabel"), className: "good" };
  }
  if (card.hasCookie) {
    return { text: t("cookieReadyLabel"), className: "" };
  }
  return { text: t("cookieMissingLabel"), className: "bad" };
}

function isOfficialKeyUsable(card) {
  if (!card?.enabled) return false;
  if (["disabled", "invalid", "session_blocked", "weekly_blocked"].includes(card.status)) return false;
  return officialQuotaStatus(card) !== "critical";
}

function isOfficialKeyIncludedInPool(card) {
  return Boolean(card?.enabled && card.status !== "disabled" && card.session && card.weekly);
}

function officialRuntimeStatusLabel(card) {
  const status = card.enabled ? card.status : "disabled";
  if (status === "available" || status === "unknown") return "";
  if (status === "cooling_down" && officialQuotaStatus(card) !== "critical") {
    const details = [
      card.blockReason ? `${t("cooldownReasonLabel")} ${mapText("blockReason", card.blockReason)}` : null,
      card.cooldownUntil ? `${t("cooldownUntilLabel")} ${formatResetTime(card.cooldownUntil)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return `<span class="status quiet" title="${escapeHtml(details)}">${escapeHtml(t("requestCooldownLabel"))}${details ? ` · ${escapeHtml(details)}` : ""}</span>`;
  }
  return `<span class="status ${status}">${escapeHtml(mapText("status", status))}</span>`;
}

function officialUsageMeter(label, window, threshold = 1, options = {}) {
  if (!window) {
    return `
      <div class="quotaWindow missing">
        <div class="quotaWindowLabel"><span>${escapeHtml(label)}</span><strong>-</strong></div>
        <div class="quotaTrack"><span style="width: 0%"></span></div>
        <small>${escapeHtml(t("officialUnavailable"))}</small>
      </div>
    `;
  }
  const remaining = Math.min(100, Math.max(0, Number(window.remainingPercent || 0)));
  const used = Math.min(100, Math.max(0, Number(window.usedPercent || 0)));
  const state = options.blocked ? "blocked" : remaining <= Number(threshold || 1) ? "critical" : remaining <= 50 ? "warning" : "ok";
  return `
    <div class="quotaWindow ${state}">
      <div class="quotaWindowLabel">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatPercent(window.remainingPercent))} ${escapeHtml(t("remainingLabel"))}</strong>
      </div>
      <div class="quotaTrack">
        <span style="width: ${remaining}%"></span>
      </div>
      <small>${escapeHtml(formatQuotaNumber(window.usedPercent))} / 100 · ${escapeHtml(t("resetAtLabel"))} ${escapeHtml(formatResetTime(window.resetAt))}</small>
      ${options.blocked ? `<small class="quotaUnavailable">${escapeHtml(t("quotaUnavailableLabel"))}</small>` : ""}
    </div>
  `;
}

function renderUsageProxyActivity() {
  const root = $("usageProxyActivity");
  if (!root) return;
  const overview = state.stats?.usage?.overview;
  if (!overview) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noModels"))}</div>`;
    return;
  }
  const totals = overview.totals;
  const totalModelRequests = Math.max(
    1,
    (overview.topModelsToday || []).reduce((sum, model) => sum + Number(model.totalRequests || 0), 0)
  );
  root.innerHTML = `
    <div class="usageBlock proxyUsageBlock" style="border: none; background: none; padding: 0;">
      <div class="accountUsageMeta">
        <span>${escapeHtml(t("totalAccountsUsage"))} ${formatNumber(totals.lifetime.totalRequests)}</span>
        <span>${escapeHtml(t("sessionUsageLabel"))} ${formatNumber(totals.session.estimatedRequests)}</span>
        <span>${escapeHtml(t("weeklyUsageLabel"))} ${formatNumber(totals.weekly.estimatedRequests)}</span>
      </div>
      <div class="modelShareBar">
        ${
          (overview.topModelsToday || []).length
            ? overview.topModelsToday
                .slice(0, 8)
                .map((model, index) => {
                  const width = Math.max(4, (Number(model.totalRequests || 0) / totalModelRequests) * 100);
                  return `<span class="modelShareSegment tone${index % 5}" style="width: ${width}%" title="${escapeHtml(model.model)} · ${escapeHtml(formatNumber(model.totalRequests))}"></span>`;
                })
                .join("")
            : `<span class="modelShareSegment emptySegment" style="width: 100%"></span>`
        }
      </div>
      <div class="modelUsageList compactModelUsage">
        ${
          (overview.topModelsToday || []).length
            ? overview.topModelsToday
                .slice(0, 8)
                .map(
                  (model) => `
                    <div class="modelUsageItem">
                      <strong>${escapeHtml(model.model)}</strong>
                      <span>${escapeHtml(t("requestsLabel"))} ${formatNumber(model.totalRequests)}</span>
                      <span>${escapeHtml(t("tokenMetrics").total)} ${formatNumber(model.totalTokens)}</span>
                    </div>
                  `
                )
                .join("")
            : `<div class="empty">${escapeHtml(t("noModels"))}</div>`
        }
      </div>
    </div>
  `;
}

function officialQuotaStatus(official) {
  if (!official?.session && !official?.weekly) return "missing";
  const sessionThreshold = Number(official.sessionRemainingThresholdPercent ?? 1);
  const weeklyThreshold = Number(official.weeklyRemainingThresholdPercent ?? 1);
  if (official.session && Number(official.session.remainingPercent) <= sessionThreshold) return "critical";
  if (official.weekly && Number(official.weekly.remainingPercent) <= weeklyThreshold) return "critical";
  const used = [official.session?.usedPercent, official.weekly?.usedPercent]
    .filter((value) => value !== null && value !== undefined)
    .map(Number);
  const remaining = [official.session?.remainingPercent, official.weekly?.remainingPercent]
    .filter((value) => value !== null && value !== undefined)
    .map(Number);
  const minimum = remaining.length ? Math.min(...remaining) : null;
  if (minimum === null || !Number.isFinite(minimum)) return "missing";
  if (minimum <= 1) return "critical";
  if (minimum <= 50) return "warning";
  return "ok";
}

function officialQuotaLabel(status) {
  if (status === "critical") return t("quotaCriticalLabel");
  if (status === "warning") return t("quotaWarningLabel");
  if (status === "ok") return t("quotaOkLabel");
  return t("quotaMissingLabel");
}

function usageMeter(label, requests, durationMs, width) {
  return `
    <div class="usageMeter">
      <div class="usageMeterLabel">
        <span>${escapeHtml(label)}</span>
        <strong>${formatNumber(requests)} ${escapeHtml(t("requestsLabel"))}</strong>
      </div>
      <div class="usageMeterTrack">
        <span style="width: ${Math.min(100, width)}%"></span>
      </div>
      <small>${escapeHtml(t("durationLabel"))} ${escapeHtml(formatDuration(durationMs))}</small>
    </div>
  `;
}

function renderUsage() {
  const root = $("usageList");
  const today = state.stats?.models?.today || [];
  if (today.length === 0) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noModels"))}</div>`;
    return;
  }
  root.innerHTML = today
    .map((model) => `
      <div class="usageRow">
        <strong>${escapeHtml(model.model)}</strong>
        <span>${escapeHtml(t("tokenMetrics").requests)} ${formatNumber(model.totalRequests)}</span>
        <span>${escapeHtml(t("tokenMetrics").success)} ${formatNumber(model.totalSuccesses)}</span>
        <span>${escapeHtml(t("tokenMetrics").failure)} ${formatNumber(model.totalFailures)}</span>
        <span>${escapeHtml(t("tokenMetrics").prompt)} ${formatNumber(model.promptTokens)}</span>
        <span>${escapeHtml(t("tokenMetrics").completion)} ${formatNumber(model.completionTokens)}</span>
        <span>${escapeHtml(t("tokenMetrics").total)} ${formatNumber(model.totalTokens)}</span>
        <span>${escapeHtml(t("tokenMetrics").cached)} ${formatNumber(model.cachedTokens)}</span>
      </div>
    `)
    .join("");
}

function renderUsageSettings() {
  const data = state.usageSettings || {
    settings: state.stats?.usage?.settings,
    nextSessionResetAt: state.stats?.usage?.nextSessionResetAt,
    nextWeeklyResetAt: state.stats?.usage?.nextWeeklyResetAt,
  };
  const settings = data.settings;
  const summary = $("usageSettingsSummary");
  if (!settings) {
    summary.innerHTML = `<div class="empty">${escapeHtml(t("loadingKeys"))}</div>`;
    return;
  }
  summary.innerHTML = `
    <div class="miniRow"><strong>${escapeHtml(t("nextSessionReset"))}</strong><span>${escapeHtml(formatDate(data.nextSessionResetAt))}</span></div>
    <div class="miniRow"><strong>${escapeHtml(t("nextWeeklyReset"))}</strong><span>${escapeHtml(formatDate(data.nextWeeklyResetAt))}</span></div>
  `;

  const form = $("usageSettingsForm");
  form.elements.usageTimezone.value = settings.usageTimezone || "Asia/Taipei";
  form.elements.sessionResetAnchor.value = toDateTimeLocal(settings.sessionResetAnchor);
  form.elements.sessionResetIntervalHours.value = settings.sessionResetIntervalHours || 5;
  form.elements.weeklyResetDayOfWeek.value = String(settings.weeklyResetDayOfWeek || 1);
  form.elements.weeklyResetTime.value = settings.weeklyResetTime || "08:30";
  form.elements.weeklyResetGraceMinutes.value = settings.weeklyResetGraceMinutes ?? 5;
  form.elements.weeklyReactivationJitterSeconds.value = settings.weeklyReactivationJitterSeconds ?? 180;
}

function renderCache() {
  const root = $("cacheList");
  const cache = state.stats?.models?.cache || state.modelOverview?.cache;
  if (!cache) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("cacheMissing"))}</div>`;
    return;
  }
  const status = cache.fetchedAt ? (cache.valid ? t("cacheValid") : t("cacheExpired")) : t("cacheMissing");
  root.innerHTML = `
    <div class="miniRow"><strong>${escapeHtml(status)}</strong><span>${escapeHtml(t("lastTest"))}</span><span>${escapeHtml(cache.fetchedAt ? relativeDate(cache.fetchedAt) : "-")}</span><span>TTL ${formatNumber(cache.ttlSeconds)}s</span><span>${formatNumber(cache.ageSeconds || 0)}s</span></div>
    <div class="miniRow"><strong>Cache</strong><span>hits ${formatNumber(cache.hits)}</span><span>misses ${formatNumber(cache.misses)}</span><span>hit rate ${formatPercent(cache.hitRate)}</span><span></span></div>
  `;
}

function renderModelTests() {
  const root = $("modelTestList");
  const overview = state.modelOverview;
  if (!overview) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("loadingKeys"))}</div>`;
    return;
  }
  $("modelTestSummary").textContent = t("availableModelCount")(
    formatNumber(overview.count),
    mapText("cacheSource", overview.source)
  );
  if (!overview.models?.length) {
    root.innerHTML = `<div class="empty">${escapeHtml(t("noModels"))}</div>`;
    return;
  }
  root.innerHTML = overview.models
    .map((model) => {
      const test = overview.tests?.[model.id];
      const testing = state.testingModels.has(model.id);
      const enabled = model.enabled !== false;
      const result = test
        ? `${test.ok ? "OK" : "FAIL"} · ${test.responseTimeMs === null ? "-" : t("responseTime")(test.responseTimeMs)} · ${relativeDate(test.testedAt)}`
        : t("neverTested");
      return `
        <div class="modelTestRow ${enabled ? "" : "disabled"}" data-model-id="${escapeHtml(model.id)}">
          <div>
            <strong>${escapeHtml(model.id)}</strong>
            <small>${escapeHtml(mapText("cacheSource", model.source))}${model.upstreamModel && model.upstreamModel !== model.id ? ` · ${escapeHtml(model.upstreamModel)}` : ""}</small>
          </div>
          <span class="${test?.ok ? "goodText" : test ? "badText" : ""}">${escapeHtml(result)}</span>
          <label class="toggleSwitch modelToggle" title="${escapeHtml(enabled ? t("modelEnabled") : t("modelDisabled"))}">
            <input type="checkbox" ${enabled ? "checked" : ""} data-model-toggle="${escapeHtml(model.id)}" aria-label="${escapeHtml(t("modelEnabled"))}" />
            <span class="toggleSlider"></span>
          </label>
          <button class="button" data-model-test="${escapeHtml(model.id)}" ${testing || !enabled ? "disabled" : ""}>${escapeHtml(testing ? t("testingModel") : t("testModel"))}</button>
        </div>
      `;
    })
    .join("");
}

function renderPages() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === state.page);
  });
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === `${state.page}Page`);
  });
}

function renderSystemSettings() {
  const form = $("systemSettingsForm");
  if (!form || !state.systemSettings) return;
  const mode = state.systemSettings.keySelectionMode || "ordered";
  form.elements.keySelectionMode.value = mode;
  $("keySelectionModeHint").textContent = t(
    mode === "balanced" ? "keySelectionBalancedHint" : "keySelectionOrderedHint"
  );
}

function renderAll() {
  applyLocale();
  renderPages();
  renderAuthState();
  renderStats();
  renderEvents();
  renderClients();
  renderModels();
  renderUsageOverview();
  renderUsageProxyActivity();
  renderUsageSettings();
  renderUsage();
  renderCache();
  renderClientKeys();
  renderModelTests();
  renderSystemSettings();
}

async function refresh(options = {}) {
  const showErrors = options.showErrors ?? true;
  const preserveOnError = options.preserveOnError ?? false;
  await loadAuthStatus();
  if (state.authStatus?.initialized === false) {
    state.token = "";
    state.loaded = false;
    state.loading = false;
    localStorage.removeItem(credentialStorageKey);
    localStorage.removeItem(legacyCredentialStorageKey);
    renderAll();
    return false;
  }
  if (!state.token) {
    state.loaded = false;
    state.loading = false;
    state.loadNotice = null;
    renderAll();
    return false;
  }
  try {
    state.loading = true;
    state.loadNotice = null;
    if (!preserveOnError) renderAll();
    const level = $("eventLevel").value;
    const type = $("eventType").value;
    const category = $("eventCategory").value;
    const eventQuery = new URLSearchParams({ limit: "80" });
    if (level) eventQuery.set("level", level);
    if (type) eventQuery.set("type", type);
    if (category) eventQuery.set("category", category);
    if ($("eventHasUsage").checked) eventQuery.set("hasUsage", "1");
    const [stats, keys, events, models, usageSettings, clientKeys, systemSettings] = await Promise.all([
      api("/admin/stats"),
      api("/admin/keys"),
      api(`/admin/events?${eventQuery.toString()}`),
      api("/admin/models"),
      api("/admin/usage-settings"),
      api("/admin/client-keys"),
      api("/admin/system-settings"),
    ]);
    state.stats = stats;
    state.keys = keys.keys || [];
    state.events = events.events || [];
    state.modelOverview = models;
    state.usageSettings = usageSettings;
    state.clientKeys = clientKeys.clientKeys || [];
    state.systemSettings = systemSettings;
    state.loaded = true;
    state.loading = false;
    state.loadNotice = null;
    state.authMessage = null;
    renderAll();
    return true;
  } catch (error) {
    state.loading = false;
    if (error.status === 401) {
      state.token = "";
      state.loaded = false;
      state.authMessage = t("savedCredentialInvalid");
      localStorage.removeItem(credentialStorageKey);
      localStorage.removeItem(legacyCredentialStorageKey);
      renderAll();
      return false;
    }
    if (!preserveOnError) {
      state.loaded = false;
      state.loadNotice = t("loadNotice");
      renderAll();
    }
    if (showErrors) showNotice(error.message, "error");
    return false;
  }
}

function findKey(keyId) {
  return state.keys.find((key) => key.id === keyId) || null;
}

function findUsageCard(keyId) {
  return (state.stats?.usage?.overview?.keyCards || []).find((card) => card.id === keyId) || null;
}

function openKeySettingsDialog(keyId) {
  const key = findKey(keyId);
  if (!key) {
    showNotice(t("noKeys"), "error");
    return;
  }
  state.editingKeySettingsId = keyId;
  const form = $("keySettingsForm");
  form.elements.name.value = key.name || "";
  form.elements.ollamaUsageCookie.value = "";
  form.elements.clearOllamaUsageCookie.checked = false;
  form.elements.notes.value = key.notes || "";
  $("keySettingsDialog").showModal();
}

function openThresholdDialog(keyId) {
  const key = findKey(keyId);
  const card = findUsageCard(keyId);
  if (!key && !card) {
    showNotice(t("noKeys"), "error");
    return;
  }
  state.editingThresholdKeyId = keyId;
  const form = $("thresholdForm");
  form.elements.sessionRemainingThresholdPercent.value = String(
    key?.sessionRemainingThresholdPercent ?? card?.sessionRemainingThresholdPercent ?? 1
  );
  form.elements.weeklyRemainingThresholdPercent.value = String(
    key?.weeklyRemainingThresholdPercent ?? card?.weeklyRemainingThresholdPercent ?? 1
  );
  $("thresholdDialog").showModal();
}

async function actionForKey(keyId, action) {
  if (action === "delete" && !confirm(t("confirmDelete"))) return;
  try {
    if (action === "key-settings") {
      openKeySettingsDialog(keyId);
      return;
    }
    if (action === "edit-thresholds") {
      openThresholdDialog(keyId);
      return;
    }
    if (action === "rotate") {
      const apiKey = prompt(t("promptNewKey"));
      if (!apiKey) return;
      await api(`/admin/keys/${keyId}/rotate`, {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      });
    } else if (action === "set-usage-cookie") {
      const ollamaUsageCookie = prompt(t("usageCookieLabel"));
      if (!ollamaUsageCookie) return;
      await api(`/admin/keys/${keyId}`, {
        method: "PATCH",
        body: JSON.stringify({ ollamaUsageCookie }),
      });
    } else if (action === "clear-usage-cookie") {
      await api(`/admin/keys/${keyId}`, {
        method: "PATCH",
        body: JSON.stringify({ clearOllamaUsageCookie: true }),
      });
    } else if (action === "delete") {
      await api(`/admin/keys/${keyId}`, { method: "DELETE" });
    } else if (action === "usage-refresh") {
      await api(`/admin/keys/${keyId}/usage-refresh`, { method: "POST" });
    } else {
      await api(`/admin/keys/${keyId}/${action}`, { method: "POST" });
    }
    showNotice(t("actionDone")(mapText("action", action) || mapText("action", "handled")));
    await refresh({ showErrors: true });
  } catch (error) {
    showNotice(error.message, "error");
    await refresh({ showErrors: false, preserveOnError: true });
  }
}

async function refreshOfficialUsage() {
  if (!state.token) {
    showNotice(t("passwordRequired"), "error");
    return;
  }
  try {
    const refreshButton = $("refreshUsageButton");
    if (refreshButton) refreshButton.disabled = true;
    const overview = await api("/admin/usage-overview/refresh", { method: "POST" });
    state.stats = state.stats || {};
    state.stats.usage = state.stats.usage || {};
    state.stats.usage.overview = overview;
    state.keys = (await api("/admin/keys")).keys || state.keys;
    renderAll();
    showNotice(t("refreshOfficialUsage"));
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    const refreshButton = $("refreshUsageButton");
    if (refreshButton) refreshButton.disabled = false;
  }
}

async function refreshModels() {
  if (!state.token) {
    showNotice(t("passwordRequired"), "error");
    return;
  }
  try {
    $("refreshModelsButton").disabled = true;
    state.modelOverview = await api("/admin/models/refresh", { method: "POST" });
    renderAll();
    showNotice(t("refreshModels"));
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    $("refreshModelsButton").disabled = false;
  }
}

async function saveKeySettings(event) {
  event.preventDefault();
  if (!state.editingKeySettingsId || state.savingKeySettings) return;
  state.savingKeySettings = true;
  const button = $("saveKeySettingsButton");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = t("saving");
  const form = new FormData(event.currentTarget);
  const payload = {
    name: String(form.get("name") || ""),
    notes: String(form.get("notes") || ""),
  };
  const cookie = String(form.get("ollamaUsageCookie") || "").trim();
  if (event.currentTarget.elements.clearOllamaUsageCookie.checked) {
    payload.clearOllamaUsageCookie = true;
  } else if (cookie) {
    payload.ollamaUsageCookie = cookie;
  }
  try {
    await api(`/admin/keys/${state.editingKeySettingsId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    closeKeySettingsDialog();
    showNotice(t("keySettingsSaved"));
    await refresh({ showErrors: true });
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    state.savingKeySettings = false;
    button.disabled = false;
    button.textContent = originalLabel || t("saveKeySettings");
  }
}

async function saveThresholds(event) {
  event.preventDefault();
  if (!state.editingThresholdKeyId || state.savingThresholds) return;
  state.savingThresholds = true;
  const button = $("saveThresholdButton");
  button.disabled = true;
  const form = new FormData(event.currentTarget);
  const valueOrNull = (name) => {
    const value = String(form.get(name) || "").trim();
    return value === "" ? null : Number(value);
  };
  try {
    await api(`/admin/keys/${state.editingThresholdKeyId}`, {
      method: "PATCH",
      body: JSON.stringify({
        sessionRemainingThresholdPercent: valueOrNull("sessionRemainingThresholdPercent"),
        weeklyRemainingThresholdPercent: valueOrNull("weeklyRemainingThresholdPercent"),
      }),
    });
    closeThresholdDialog();
    showNotice(t("thresholdsSaved"));
    await refresh({ showErrors: true });
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    state.savingThresholds = false;
    button.disabled = false;
  }
}

async function testModel(modelId) {
  if (!state.token) {
    showNotice(t("passwordRequired"), "error");
    return;
  }
  try {
    state.testingModels.add(modelId);
    renderModelTests();
    const result = await api(`/admin/models/${encodeURIComponent(modelId)}/test`, { method: "POST" });
    state.modelOverview = await api("/admin/models");
    showNotice(`${modelId}: ${result.ok ? "OK" : "FAIL"} ${t("responseTime")(result.responseTimeMs ?? 0)}`);
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    state.testingModels.delete(modelId);
    renderAll();
  }
}

async function toggleModel(modelId, enabled) {
  if (!state.token) {
    showNotice(t("passwordRequired"), "error");
    return;
  }
  try {
    const result = await api(`/admin/models/${encodeURIComponent(modelId)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    state.modelOverview = result.overview || (await api("/admin/models"));
    renderAll();
    showNotice(`${modelId}: ${enabled ? t("modelEnabled") : t("modelDisabled")}`);
  } catch (error) {
    showNotice(error.message, "error");
    state.modelOverview = await api("/admin/models");
    renderAll();
  }
}

async function saveUsageSettings(event) {
  event.preventDefault();
  if (!state.token) {
    showNotice(t("passwordRequired"), "error");
    return;
  }
  const form = new FormData(event.currentTarget);
  const payload = {
    usageTimezone: String(form.get("usageTimezone") || ""),
    sessionResetMode: "fixed_anchor",
    sessionResetAnchor: fromDateTimeLocal(String(form.get("sessionResetAnchor") || "")),
    sessionResetIntervalHours: Number(form.get("sessionResetIntervalHours") || 5),
    weeklyResetMode: "fixed_weekly",
    weeklyResetDayOfWeek: Number(form.get("weeklyResetDayOfWeek") || 1),
    weeklyResetTime: String(form.get("weeklyResetTime") || "08:30"),
    weeklyResetGraceMinutes: Number(form.get("weeklyResetGraceMinutes") || 0),
    weeklyReactivationJitterSeconds: Number(form.get("weeklyReactivationJitterSeconds") || 0),
  };
  try {
    state.usageSettings = await api("/admin/usage-settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    state.stats = await api("/admin/stats");
    renderAll();
    showNotice(t("usageSettingsSaved"));
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function saveSystemSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    state.systemSettings = await api("/admin/system-settings", {
      method: "PATCH",
      body: JSON.stringify({ keySelectionMode: String(form.get("keySelectionMode") || "ordered") }),
    });
    renderAll();
    showNotice(t("systemSettingsSaved"));
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function loginAdmin(event) {
  event.preventDefault();
  state.token = String(new FormData(event.currentTarget).get("password") || "").trim();
  state.authMessage = null;
  localStorage.setItem(credentialStorageKey, state.token);
  localStorage.removeItem(legacyCredentialStorageKey);
  event.currentTarget.reset();
  await refresh({ showErrors: true });
}

function logoutAdmin() {
  state.token = "";
  state.loaded = false;
  state.authMessage = t("signedOutMessage");
  localStorage.removeItem(credentialStorageKey);
  localStorage.removeItem(legacyCredentialStorageKey);
  renderAll();
}

async function setupAdminPassword(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const password = String(form.get("password") || "").trim();
  const confirmPassword = String(form.get("confirmPassword") || "").trim();
  if (password !== confirmPassword) {
    state.authMessage = t("passwordMismatch");
    renderAuthState();
    return;
  }
  try {
    const response = await fetch("/admin/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || t("requestFailed")(response.status));
    state.token = password;
    state.authMessage = null;
    localStorage.setItem(credentialStorageKey, state.token);
    localStorage.removeItem(legacyCredentialStorageKey);
    formElement.reset();
    showNotice(t("adminPasswordSaved"));
    await refresh({ showErrors: true });
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function changeAdminPassword(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const newPassword = String(form.get("newPassword") || "").trim();
  if (newPassword !== String(form.get("confirmNewPassword") || "").trim()) {
    showNotice(t("passwordMismatch"), "error");
    return;
  }
  try {
    await api("/admin/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: String(form.get("currentPassword") || ""),
        newPassword,
      }),
    });
    state.token = newPassword;
    localStorage.setItem(credentialStorageKey, state.token);
    localStorage.removeItem(legacyCredentialStorageKey);
    formElement.reset();
    showNotice(t("adminPasswordSaved"));
    await refresh({ showErrors: true });
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function exportYaml() {
  if (!state.token) {
    showNotice(t("passwordRequired"), "error");
    return;
  }
  try {
    const response = await fetch("/admin/export.yaml", { headers: headers(false) });
    const text = await response.text();
    if (!response.ok) {
      let message = t("requestFailed")(response.status);
      try {
        message = JSON.parse(text)?.error?.message || message;
      } catch {}
      throw new Error(message);
    }
    const blob = new Blob([text], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ollama-cloud-proxy-export.yaml";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function importYaml(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!state.token) {
    showNotice(t("passwordRequired"), "error");
    return;
  }
  try {
    const text = await file.text();
    await api("/admin/import.yaml", {
      method: "POST",
      headers: { "content-type": "application/yaml" },
      body: text,
    });
    showNotice(t("importDone"));
    await refresh({ showErrors: true });
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function createClientKey(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/admin/client-keys", {
      method: "POST",
      body: JSON.stringify({
        name: String(form.get("name") || ""),
        token: String(form.get("token") || ""),
        notes: String(form.get("notes") || ""),
      }),
    });
    event.currentTarget.reset();
    showNotice(t("clientKeyCreated"));
    await refresh({ showErrors: true });
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function actionForClientKey(id, action) {
  if (action === "delete" && !confirm(t("confirmClientKeyDelete"))) return;
  try {
    if (action === "rotate") {
      const token = prompt(t("rotateClientKeyPrompt"));
      if (!token) return;
      await api(`/admin/client-keys/${id}/rotate`, { method: "POST", body: JSON.stringify({ token }) });
    } else if (action === "delete") {
      await api(`/admin/client-keys/${id}`, { method: "DELETE" });
    } else {
      await api(`/admin/client-keys/${id}/${action}`, { method: "POST" });
    }
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
  renderEventCategoryOptions();
  renderWeeklyDayOptions();
}

function renderEventTypeOptions() {
  const selected = $("eventType").value;
  $("eventType").innerHTML = [
    `<option value="">${escapeHtml(t("allTypes"))}</option>`,
    ...eventTypes.map((type) => `<option value="${type}">${escapeHtml(mapText("eventType", type) || t("otherEvent"))}</option>`),
  ].join("");
  $("eventType").value = selected;
}

function renderEventCategoryOptions() {
  const selected = $("eventCategory")?.value || "";
  if (!$("eventCategory")) return;
  $("eventCategory").innerHTML = [
    `<option value="">${escapeHtml(t("allCategories"))}</option>`,
    ...eventCategories.map((category) => `<option value="${category}">${escapeHtml(mapText("eventCategory", category))}</option>`),
  ].join("");
  $("eventCategory").value = selected;
}

function renderWeeklyDayOptions() {
  const select = $("usageSettingsForm")?.elements.weeklyResetDayOfWeek;
  if (!select) return;
  const selected = select.value || "1";
  select.innerHTML = [1, 2, 3, 4, 5, 6, 7]
    .map((day) => `<option value="${day}">${escapeHtml(t("dayNames")[day])}</option>`)
    .join("");
  select.value = selected;
}

function bindEvents() {
  applyLocale();
  $("localeSelect").addEventListener("change", () => {
    state.locale = $("localeSelect").value;
    localStorage.setItem("ollamaProxyAdminLocale", state.locale);
    renderAll();
  });
  $("loginForm").addEventListener("submit", loginAdmin);
  $("logoutButton").addEventListener("click", logoutAdmin);
  $("systemSettingsForm").addEventListener("submit", saveSystemSettings);
  $("systemSettingsForm").elements.keySelectionMode.addEventListener("change", (event) => {
    $("keySelectionModeHint").textContent = t(
      event.target.value === "balanced" ? "keySelectionBalancedHint" : "keySelectionOrderedHint"
    );
  });
  $("refreshButton").addEventListener("click", () => refresh({ showErrors: true }));
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.page = button.dataset.page;
      renderAll();
    });
  });
  $("eventLevel").addEventListener("change", () => refresh({ showErrors: true }));
  $("eventType").addEventListener("change", () => refresh({ showErrors: true }));
  $("eventCategory").addEventListener("change", () => refresh({ showErrors: true }));
  $("eventHasUsage").addEventListener("change", () => refresh({ showErrors: true }));
  $("setupPasswordForm").addEventListener("submit", setupAdminPassword);
  $("changePasswordForm").addEventListener("submit", changeAdminPassword);
  $("exportYamlButton").addEventListener("click", exportYaml);
  $("importYamlInput").addEventListener("change", importYaml);
  $("clientKeyForm").addEventListener("submit", createClientKey);
  $("clientKeyList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-client-action]");
    if (!button) return;
    const row = button.closest("[data-client-key-id]");
    if (!row) return;
    actionForClientKey(row.dataset.clientKeyId, button.dataset.clientAction);
  });
  $("cancelKeyButton").addEventListener("click", closeKeyDialog);
  $("closeKeyDialogButton").addEventListener("click", closeKeyDialog);
  $("cancelKeySettingsButton").addEventListener("click", closeKeySettingsDialog);
  $("closeKeySettingsButton").addEventListener("click", closeKeySettingsDialog);
  $("keySettingsForm").addEventListener("submit", saveKeySettings);
  $("cancelThresholdButton").addEventListener("click", closeThresholdDialog);
  $("closeThresholdButton").addEventListener("click", closeThresholdDialog);
  $("thresholdForm").addEventListener("submit", saveThresholds);
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
      ollamaUsageCookie: String(form.get("ollamaUsageCookie") || ""),
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
        renderAll();
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
  $("usageOverview").addEventListener("click", (event) => {
    const addButton = event.target.closest("#addKeyButton");
    if (addButton) {
      $("keyDialog").showModal();
      return;
    }
    const refreshButton = event.target.closest("#refreshUsageButton");
    if (refreshButton) {
      refreshOfficialUsage();
      return;
    }
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest("[data-key-id]");
    if (!card) return;
    actionForKey(card.dataset.keyId, button.dataset.action);
  });
  $("usageOverview").addEventListener("change", (event) => {
    const toggle = event.target.closest("input[data-action='toggle-enable']");
    if (!toggle) return;
    const card = toggle.closest("[data-key-id]");
    if (!card) return;
    const action = toggle.checked ? "enable" : "disable";
    actionForKey(card.dataset.keyId, action);
  });
  $("refreshModelsButton").addEventListener("click", refreshModels);
  $("usageSettingsForm").addEventListener("submit", saveUsageSettings);
  $("modelTestList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-model-test]");
    if (!button) return;
    testModel(button.dataset.modelTest);
  });
  $("modelTestList").addEventListener("change", (event) => {
    const toggle = event.target.closest("input[data-model-toggle]");
    if (!toggle) return;
    toggleModel(toggle.dataset.modelToggle, toggle.checked);
  });
}

bindEvents();
renderAll();
loadAuthStatus().then(() => {
  renderAll();
  if (state.token && state.authStatus?.initialized) refresh({ showErrors: false });
});
