const normalize = (value) => String(value || "").trim().toLowerCase();

export function classifyUserFacingError(input = {}) {
  const code = normalize(input.code);
  const message = normalize(input.message);
  const status = Number(input.status || 0);
  const context = normalize(input.context || input.url);
  const combined = `${code} ${message} ${context}`;

  if (
    ["invalid_api_key", "auth_failed"].includes(code) ||
    combined.includes("api key is invalid") ||
    combined.includes("invalid api key") ||
    combined.includes("revoked")
  ) {
    return result("upstream_key_invalid", "danger", "proxy", "review_keys", false);
  }

  if (
    ["unauthorized", "admin_setup_required", "invalid_admin_login", "invalid_current_password", "invalid_admin_password"].includes(code) ||
    status === 401
  ) {
    const clientAuth = combined.includes("client token") || combined.includes("/v1/") || combined.includes("/api/chat");
    return clientAuth
      ? result("client_auth", "danger", "proxy", "update_client_key", false)
      : result("admin_auth", "warning", "admin", "sign_in", false);
  }

  if (code === "no_available_key" || combined.includes("no available ollama cloud key") || combined.includes("no_available_key")) {
    return result("no_available_key", "danger", "proxy", "review_keys", false);
  }

  if (
    ["session_blocked", "session_usage_inferred", "weekly_blocked", "weekly_usage_inferred", "rate_limited"].includes(code) ||
    combined.includes("5hr") ||
    combined.includes("5 hour") ||
    combined.includes("weekly quota") ||
    combined.includes("rate limit") ||
    status === 429
  ) {
    return result("quota_limited", "warning", "proxy", "review_keys", true);
  }

  if (
    ["queue_timeout", "queue_rejected", "request_queue_full", "queue_full"].includes(code) ||
    combined.includes("queue full") ||
    combined.includes("queue timeout") ||
    combined.includes("queue is full")
  ) {
    return result("queue_busy", "warning", "temporary", "retry", true);
  }

  if (
    code.startsWith("invalid_") ||
    code === "invalid_request" ||
    status === 400 ||
    combined.includes("must be") ||
    combined.includes("required") ||
    combined.includes("cannot be empty")
  ) {
    return result("invalid_setting", "danger", "configuration", "fix_field", false);
  }

  if (
    code.includes("usage") ||
    combined.includes("usage cookie") ||
    combined.includes("official usage") ||
    combined.includes("cookie expired") ||
    combined.includes("__secure-session")
  ) {
    return result("usage_cookie", "warning", "usage", "update_cookie", false, true);
  }

  if (
    ["key_test_failed", "model_refresh_failed", "network_error", "provider_error", "upstream_error"].includes(code) ||
    combined.includes("network") ||
    combined.includes("fetch failed") ||
    combined.includes("failed to fetch") ||
    combined.includes("timed out") ||
    combined.includes("timeout") ||
    combined.includes("econn") ||
    combined.includes("upstream")
  ) {
    return result("upstream_unavailable", "warning", "temporary", "retry", true);
  }

  if (status === 404 || code.endsWith("_not_found") || code === "not_found") {
    return result("not_found", "warning", "admin", "refresh", false);
  }

  return result("unknown", status >= 500 ? "danger" : "warning", status >= 500 ? "temporary" : "admin", "retry", status >= 500);
}

function result(kind, severity, impact, action, autoRetry, usageOnly = false) {
  return { kind, severity, impact, action, autoRetry, usageOnly };
}

export function redactDiagnostic(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactDiagnostic);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /key|token|cookie|secret|password|authorization/i.test(key) ? "[REDACTED]" : redactDiagnostic(item),
      ])
    );
  }
  if (typeof value !== "string") return value;

  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, "Bearer [REDACTED]")
    .replace(/\bocp_[A-Za-z0-9_-]+\b/g, "ocp_[REDACTED]")
    .replace(/(?:__Secure-session|ocp_admin_session)=[^;\s]+/gi, (match) => `${match.split("=")[0]}=[REDACTED]`)
    .replace(/([?&](?:token|key|api_key|cookie|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_ -]?key|token|cookie|secret|password)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\/Users\/[^/\s]+\//g, "/Users/[REDACTED]/")
    .replace(/\/home\/[^/\s]+\//g, "/home/[REDACTED]/");
}

export function buildSafeDiagnostic(input = {}) {
  return redactDiagnostic({
    timestamp: input.timestamp || new Date().toISOString(),
    version: input.version || null,
    page: input.page || null,
    method: input.method || null,
    endpoint: input.endpoint || null,
    status: input.status || null,
    code: input.code || null,
    kind: input.kind || null,
    message: input.message || null,
    details: input.details || null,
  });
}
