export type KeyStatus =
  | "available"
  | "cooling_down"
  | "session_blocked"
  | "weekly_blocked"
  | "invalid"
  | "disabled"
  | "unknown";

export type BlockReason =
  | "none"
  | "session_usage_inferred"
  | "weekly_usage_inferred"
  | "rate_limited"
  | "invalid_api_key"
  | "auth_failed"
  | "network_error"
  | "provider_error"
  | "manual_disabled"
  | "unknown";

export type UsageSource =
  | "not_available"
  | "estimated_by_proxy"
  | "inferred_from_error"
  | "dashboard_scraped"
  | "official_api";

export type ResetSource =
  | "manual_anchor"
  | "fixed_weekly"
  | "dashboard_observed"
  | "inferred_from_error"
  | "official_api"
  | "fallback";

export type EventLevel = "debug" | "info" | "warn" | "error";

export type ProxyEventType =
  | "request_started"
  | "request_finished"
  | "request_failed"
  | "queue_wait_started"
  | "queue_timeout"
  | "queue_rejected"
  | "key_selected"
  | "key_success"
  | "key_failure"
  | "key_cooldown_started"
  | "key_cooldown_reset"
  | "key_session_blocked"
  | "key_weekly_blocked"
  | "key_invalid"
  | "key_enabled"
  | "key_disabled"
  | "key_created"
  | "key_updated"
  | "key_rotated"
  | "key_deleted"
  | "key_tested"
  | "no_available_key"
  | "upstream_error"
  | "upstream_timeout"
  | "client_aborted"
  | "retry_started"
  | "retry_finished";

export type KeyRecord = {
  id: string;
  name: string;
  accountLabel: string | null;
  notes: string | null;
  apiKeyPreview: string;
  encryptedApiKey: string;
  enabled: boolean;
  status: KeyStatus;
  blockReason: BlockReason;
  activeRequests: number;
  lastUsedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  cooldownUntil: string | null;
  nextEligibleAt: string | null;
  usageSource: UsageSource;
  resetSource: ResetSource;
  estimatedSessionRequests: number;
  estimatedWeeklyRequests: number;
  estimatedSessionDurationMs: number;
  estimatedWeeklyDurationMs: number;
  sessionWindowStartedAt: string | null;
  weeklyWindowStartedAt: string | null;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type PublicKeyRecord = Omit<KeyRecord, "encryptedApiKey">;

export type ClientIdentity = {
  clientName: string;
  authenticated: boolean;
};

export type ErrorClassification = {
  retryable: boolean;
  status: KeyStatus;
  blockReason: BlockReason;
  cooldownMs: number | null;
  eventType:
    | "key_invalid"
    | "key_session_blocked"
    | "key_weekly_blocked"
    | "key_cooldown_started"
    | "upstream_error"
    | "upstream_timeout";
  message: string;
};
