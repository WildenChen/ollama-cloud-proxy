import type { AppConfig } from "../config/env";
import type { ErrorClassification } from "../types/domain";
import { addMsIso, getNextFixedWeeklyResetAt, randomInt } from "../utils/time";

const SESSION_COOLDOWN_MS = 5 * 60 * 60 * 1000;

function includesAny(text: string, needles: string[]) {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function backoffMs(consecutiveFailures: number, minMs: number, maxMs: number) {
  const factor = Math.max(0, consecutiveFailures);
  return Math.min(maxMs, minMs * Math.pow(2, factor));
}

export async function classifyUpstreamResponse(
  statusCode: number,
  bodyText: string,
  consecutiveFailures: number,
  config: AppConfig
): Promise<ErrorClassification> {
  const body = bodyText.slice(0, 2000);

  if (statusCode === 401 || statusCode === 403) {
    return {
      retryable: false,
      category: "key",
      status: "invalid",
      blockReason: statusCode === 401 ? "auth_failed" : "invalid_api_key",
      cooldownMs: null,
      eventType: "key_invalid",
      message: "Upstream rejected API key",
    };
  }

  if (statusCode === 429) {
    if (includesAny(body, ["weekly", "week", "7 day", "7-day"])) {
      const resetAt = getNextFixedWeeklyResetAt(
        new Date(),
        config.usageTimezone,
        config.weeklyResetDayOfWeek,
        config.weeklyResetTime
      );
      const graceMs = config.weeklyResetGraceMinutes * 60 * 1000;
      const jitterMs = randomInt(config.weeklyReactivationJitterSeconds * 1000);
      return {
        retryable: false,
        category: "key",
        status: "weekly_blocked",
        blockReason: "weekly_usage_inferred",
        cooldownMs: resetAt.getTime() + graceMs + jitterMs - Date.now(),
        eventType: "key_weekly_blocked",
        message: "Weekly usage block inferred from upstream response",
      };
    }

    if (includesAny(body, ["session", "5 hour", "5-hour", "usage limit reached"])) {
      return {
        retryable: false,
        category: "key",
        status: "session_blocked",
        blockReason: "session_usage_inferred",
        cooldownMs: SESSION_COOLDOWN_MS,
        eventType: "key_session_blocked",
        message: "Session usage block inferred from upstream response",
      };
    }

    return {
      retryable: true,
      category: "key",
      status: "cooling_down",
      blockReason: "rate_limited",
      cooldownMs: backoffMs(consecutiveFailures, 15 * 60 * 1000, 60 * 60 * 1000),
      eventType: "key_cooldown_started",
      message: "Generic rate limit from upstream",
    };
  }

  if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
    return {
      retryable: true,
      category: "provider",
      status: "cooling_down",
      blockReason: "provider_error",
      cooldownMs: backoffMs(consecutiveFailures, 60 * 1000, 5 * 60 * 1000),
      eventType: "key_cooldown_started",
      message: "Temporary upstream provider error",
    };
  }

  return {
    retryable: false,
    category: "request",
    status: "cooling_down",
    blockReason: "provider_error",
    cooldownMs: 60 * 1000,
    eventType: "upstream_error",
    message: "Upstream request failed",
  };
}

export function classifyNetworkError(timeout: boolean): ErrorClassification {
  return {
    retryable: true,
    category: "network",
    status: "cooling_down",
    blockReason: "network_error",
    cooldownMs: timeout ? 2 * 60 * 1000 : 60 * 1000,
    eventType: timeout ? "upstream_timeout" : "key_cooldown_started",
    message: timeout ? "Upstream timeout" : "Network error",
  };
}

export function cooldownUntilFromClassification(classification: ErrorClassification): string | null {
  if (!classification.cooldownMs) return null;
  return addMsIso(Math.max(0, classification.cooldownMs));
}
