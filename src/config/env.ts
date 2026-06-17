import { existsSync, readFileSync } from "node:fs";

export type AppConfig = {
  port: number;
  adminToken: string;
  keyEncryptionSecret: string;
  clientApiKeys: Map<string, string>;
  upstreamBaseUrl: string;
  ollamaWebBaseUrl: string;
  ollamaWebSearchPath: string;
  ollamaWebFetchPath: string;
  ollamaWebTimeoutMs: number;
  maxConcurrentRequests: number;
  maxConcurrentRequestsPerKey: number;
  requestQueueMax: number;
  requestQueueTimeoutMs: number;
  upstreamTotalTimeoutMs: number;
  upstreamIdleTimeoutMs: number;
  maxRequestBodySizeBytes: number;
  keyRetryPolicy: "smart";
  maxKeyAttemptsPerRequest: "all" | number;
  maxNetworkRetryAttempts: number;
  modelsCacheTtlSeconds: number;
  modelAliases: Record<string, string>;
  ollamaCompatDiscoveryPublic: boolean;
  ollamaNativeApplyAliases: boolean;
  usageTimezone: string;
  sessionResetMode: string;
  sessionResetAnchor: string;
  sessionResetIntervalHours: number;
  weeklyResetMode: string;
  weeklyResetDayOfWeek: number;
  weeklyResetTime: string;
  weeklyResetGraceMinutes: number;
  weeklyReactivationJitterSeconds: number;
  eventRetentionDays: number;
  maxEvents: number;
  logLevel: string;
  dbPath: string;
};

function maybeLoadDotEnv() {
  if (!existsSync(".env")) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean`);
}

function keyAttemptsEnv(name: string, fallback: "all" | number): "all" | number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  if (raw.trim().toLowerCase() === "all") return "all";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be "all" or a positive integer`);
  return parsed;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseClientApiKeys(raw: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw?.trim()) return result;
  for (const entry of raw.split(",")) {
    const [name, ...tokenParts] = entry.split(":");
    const token = tokenParts.join(":");
    if (!name?.trim() || !token?.trim()) {
      throw new Error("CLIENT_API_KEYS must use clientName:token entries");
    }
    result.set(token.trim(), name.trim());
  }
  return result;
}

function parseModelAliases(): Record<string, string> {
  const raw =
    process.env.MODEL_ALIASES_JSON ||
    (existsSync("model-aliases.json") ? readFileSync("model-aliases.json", "utf8") : undefined);
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MODEL_ALIASES_JSON must be an object");
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)])
    );
  } catch (error) {
    throw new Error(`Invalid MODEL_ALIASES_JSON: ${(error as Error).message}`);
  }
}

export function loadConfig(): AppConfig {
  maybeLoadDotEnv();
  const keyRetryPolicy = process.env.KEY_RETRY_POLICY || "smart";
  if (keyRetryPolicy !== "smart") throw new Error("KEY_RETRY_POLICY currently supports only smart");

  return {
    port: numberEnv("PORT", 11435),
    adminToken: requiredEnv("ADMIN_TOKEN"),
    keyEncryptionSecret: requiredEnv("KEY_ENCRYPTION_SECRET"),
    clientApiKeys: parseClientApiKeys(process.env.CLIENT_API_KEYS),
    upstreamBaseUrl: process.env.OLLAMA_UPSTREAM_BASE_URL || "https://ollama.com",
    ollamaWebBaseUrl: process.env.OLLAMA_WEB_BASE_URL || "https://ollama.com",
    ollamaWebSearchPath: process.env.OLLAMA_WEB_SEARCH_PATH || "/api/web_search",
    ollamaWebFetchPath: process.env.OLLAMA_WEB_FETCH_PATH || "/api/web_fetch",
    ollamaWebTimeoutMs: numberEnv("OLLAMA_WEB_TIMEOUT_MS", 30_000),
    maxConcurrentRequests: numberEnv("MAX_CONCURRENT_REQUESTS", 5),
    maxConcurrentRequestsPerKey: numberEnv("MAX_CONCURRENT_REQUESTS_PER_KEY", 1),
    requestQueueMax: numberEnv("REQUEST_QUEUE_MAX", 30),
    requestQueueTimeoutMs: numberEnv("REQUEST_QUEUE_TIMEOUT_MS", 120000),
    upstreamTotalTimeoutMs: numberEnv("UPSTREAM_TOTAL_TIMEOUT_MS", 900000),
    upstreamIdleTimeoutMs: numberEnv("UPSTREAM_IDLE_TIMEOUT_MS", 180000),
    maxRequestBodySizeBytes: numberEnv("MAX_REQUEST_BODY_SIZE_MB", 20) * 1024 * 1024,
    keyRetryPolicy,
    maxKeyAttemptsPerRequest: keyAttemptsEnv("MAX_KEY_ATTEMPTS_PER_REQUEST", "all"),
    maxNetworkRetryAttempts: numberEnv("MAX_NETWORK_RETRY_ATTEMPTS", 3),
    modelsCacheTtlSeconds: numberEnv("MODELS_CACHE_TTL_SECONDS", 3600),
    modelAliases: parseModelAliases(),
    ollamaCompatDiscoveryPublic: booleanEnv("OLLAMA_COMPAT_DISCOVERY_PUBLIC", true),
    ollamaNativeApplyAliases: booleanEnv("OLLAMA_NATIVE_APPLY_ALIASES", true),
    usageTimezone: process.env.USAGE_TIMEZONE || "Asia/Taipei",
    sessionResetMode: process.env.SESSION_RESET_MODE || "fixed_anchor",
    sessionResetAnchor: process.env.SESSION_RESET_ANCHOR || "2026-06-06T20:00:00.000Z",
    sessionResetIntervalHours: numberEnv("SESSION_RESET_INTERVAL_HOURS", 5),
    weeklyResetMode: process.env.WEEKLY_RESET_MODE || "fixed_weekly",
    weeklyResetDayOfWeek: numberEnv("WEEKLY_RESET_DAY_OF_WEEK", 1),
    weeklyResetTime: process.env.WEEKLY_RESET_TIME || "08:30",
    weeklyResetGraceMinutes: numberEnv("WEEKLY_RESET_GRACE_MINUTES", 5),
    weeklyReactivationJitterSeconds: numberEnv("WEEKLY_REACTIVATION_JITTER_SECONDS", 180),
    eventRetentionDays: numberEnv("EVENT_RETENTION_DAYS", 14),
    maxEvents: numberEnv("MAX_EVENTS", 100000),
    logLevel: process.env.LOG_LEVEL || "info",
    dbPath: process.env.DB_PATH || "/data/ollama-cloud-proxy.sqlite",
  };
}
