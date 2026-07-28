export function deriveCredentialKeyState(card = {}) {
  const enabled = card.enabled !== false;
  const status = enabled ? String(card.status || "unknown") : "disabled";
  const recoveryAt = card.nextEligibleAt || card.cooldownUntil || null;

  if (status === "disabled") {
    return { category: "disabled", tone: "neutral", label: "disabled", recoveryAt: null };
  }
  if (status === "invalid") {
    return { category: "attention", tone: "danger", label: "invalid", recoveryAt: null };
  }
  if (status === "weekly_blocked") {
    return { category: "attention", tone: "warning", label: "weekly_blocked", recoveryAt };
  }
  if (status === "session_blocked") {
    return { category: "attention", tone: "warning", label: "session_blocked", recoveryAt };
  }
  if (status === "cooling_down") {
    const reason = String(card.blockReason || "unknown");
    const label = ["network_error", "provider_error", "rate_limited"].includes(reason)
      ? "temporary_retry"
      : "cooling_down";
    return { category: "attention", tone: "warning", label, recoveryAt };
  }
  if (status === "available") {
    return { category: "available", tone: "success", label: "available", recoveryAt: null };
  }
  return { category: "attention", tone: "neutral", label: "pending", recoveryAt: null };
}

export function deriveUsageCookieState(card = {}) {
  if (card.lastError) {
    return { category: "usage-error", tone: "warning", label: "usage_error" };
  }
  if (card.fetchedAt) {
    return { category: "usage-ready", tone: "success", label: "usage_ready" };
  }
  if (card.hasCookie) {
    return { category: "usage-pending", tone: "neutral", label: "usage_pending" };
  }
  return { category: "no-cookie", tone: "neutral", label: "no_cookie" };
}

export function matchesCredentialFilter(card, filter) {
  if (!filter || filter === "all") return true;
  const keyState = deriveCredentialKeyState(card);
  const cookieState = deriveUsageCookieState(card);
  if (filter === "available") return keyState.category === "available";
  if (filter === "attention") return keyState.category === "attention";
  if (filter === "disabled") return keyState.category === "disabled";
  if (filter === "no-cookie") return cookieState.category === "no-cookie";
  return true;
}

export function summarizeCredentials(input = {}) {
  const cards = Array.isArray(input.keyCards) ? input.keyCards : [];
  const clientKeys = Array.isArray(input.clientKeys) ? input.clientKeys : [];
  return {
    upstreamTotal: cards.length,
    upstreamAvailable: cards.filter((card) => deriveCredentialKeyState(card).category === "available").length,
    upstreamAttention: cards.filter((card) => deriveCredentialKeyState(card).category === "attention").length,
    usageCookies: cards.filter((card) => deriveUsageCookieState(card).category !== "no-cookie").length,
    clientKeysEnabled: clientKeys.filter((key) => key.enabled !== false).length,
  };
}
