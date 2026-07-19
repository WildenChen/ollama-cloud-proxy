import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type {
  BlockReason,
  ClientApiKeyRecord,
  EventLevel,
  KeyRecord,
  KeyStatus,
  ProxyEventType,
  ResetSource,
  UsageSource,
} from "../types/domain";
import { isoNow } from "../utils/time";
import type { AppConfig } from "../config/env";

type Row = Record<string, unknown>;

export type EventInput = {
  level: EventLevel;
  type: ProxyEventType;
  message: string;
  clientName?: string | null;
  requestId?: string | null;
  keyId?: string | null;
  keyName?: string | null;
  model?: string | null;
  originalModel?: string | null;
  upstreamModel?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  details?: Record<string, unknown> | null;
};

export type KeyCreateInput = {
  name: string;
  notes?: string | null;
  apiKeyPreview: string;
  encryptedApiKey: string;
  encryptedOllamaUsageCookie?: string | null;
};

export type KeyMutationPatch = Partial<{
  name: string;
  notes: string | null;
  apiKeyPreview: string;
  encryptedApiKey: string;
  encryptedOllamaUsageCookie: string | null;
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
  ollamaUsageJson: string | null;
  ollamaUsageLastRefreshAt: string | null;
  ollamaUsageLastError: string | null;
  sessionRemainingThresholdPercent: number | null;
  weeklyRemainingThresholdPercent: number | null;
  sessionQuotaLimit: number | null;
  weeklyQuotaLimit: number | null;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  consecutiveFailures: number;
  deletedAt: string | null;
}>;

export type TokenUsageInput = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
};

export type UsageAccountState = {
  keyId: string;
  officialJson: string | null;
  officialFetchedAt: string | null;
  officialCheckedAt: string | null;
  officialChangedAt: string | null;
  baselineLedgerId: number;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
};

export type UsageLedgerTotals = {
  units: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  lastRecordedAt: string | null;
};

export type UsageSettings = {
  usageTimezone: string;
  sessionResetMode: string;
  sessionResetAnchor: string;
  sessionResetIntervalHours: number;
  weeklyResetMode: string;
  weeklyResetDayOfWeek: number;
  weeklyResetTime: string;
  weeklyResetGraceMinutes: number;
  weeklyReactivationJitterSeconds: number;
};

export type UsageSettingsPatch = Partial<UsageSettings>;

function asString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

function asNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function asBool(value: unknown): boolean {
  return Number(value ?? 0) === 1;
}

function keyFromRow(row: Row): KeyRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    notes: asString(row.notes),
    apiKeyPreview: String(row.apiKeyPreview),
    encryptedApiKey: String(row.encryptedApiKey),
    encryptedOllamaUsageCookie: asString(row.encryptedOllamaUsageCookie),
    enabled: asBool(row.enabled),
    status: String(row.status) as KeyStatus,
    blockReason: String(row.blockReason) as BlockReason,
    activeRequests: asNumber(row.activeRequests),
    lastUsedAt: asString(row.lastUsedAt),
    lastSuccessAt: asString(row.lastSuccessAt),
    lastFailureAt: asString(row.lastFailureAt),
    cooldownUntil: asString(row.cooldownUntil),
    nextEligibleAt: asString(row.nextEligibleAt),
    usageSource: String(row.usageSource) as UsageSource,
    resetSource: String(row.resetSource) as ResetSource,
    estimatedSessionRequests: asNumber(row.estimatedSessionRequests),
    estimatedWeeklyRequests: asNumber(row.estimatedWeeklyRequests),
    estimatedSessionDurationMs: asNumber(row.estimatedSessionDurationMs),
    estimatedWeeklyDurationMs: asNumber(row.estimatedWeeklyDurationMs),
    sessionWindowStartedAt: asString(row.sessionWindowStartedAt),
    weeklyWindowStartedAt: asString(row.weeklyWindowStartedAt),
    ollamaUsageJson: asString(row.ollamaUsageJson),
    ollamaUsageLastRefreshAt: asString(row.ollamaUsageLastRefreshAt),
    ollamaUsageLastError: asString(row.ollamaUsageLastError),
    sessionRemainingThresholdPercent: asNumberOrNull(row.sessionRemainingThresholdPercent),
    weeklyRemainingThresholdPercent: asNumberOrNull(row.weeklyRemainingThresholdPercent),
    sessionQuotaLimit: asNumberOrNull(row.sessionQuotaLimit),
    weeklyQuotaLimit: asNumberOrNull(row.weeklyQuotaLimit),
    totalRequests: asNumber(row.totalRequests),
    totalSuccesses: asNumber(row.totalSuccesses),
    totalFailures: asNumber(row.totalFailures),
    consecutiveFailures: asNumber(row.consecutiveFailures),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    deletedAt: asString(row.deletedAt),
  };
}

function clientApiKeyFromRow(row: Row): ClientApiKeyRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    tokenPreview: String(row.tokenPreview),
    encryptedToken: String(row.encryptedToken),
    enabled: asBool(row.enabled),
    notes: asString(row.notes),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    deletedAt: asString(row.deletedAt),
  };
}

export class DatabaseStore {
  readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
    this.resetStaleActiveRequests();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        notes TEXT,
        apiKeyPreview TEXT NOT NULL,
        encryptedApiKey TEXT NOT NULL,
        encryptedOllamaUsageCookie TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'unknown',
        blockReason TEXT NOT NULL DEFAULT 'none',
        activeRequests INTEGER NOT NULL DEFAULT 0,
        lastUsedAt TEXT,
        lastSuccessAt TEXT,
        lastFailureAt TEXT,
        cooldownUntil TEXT,
        nextEligibleAt TEXT,
        usageSource TEXT NOT NULL DEFAULT 'not_available',
        resetSource TEXT NOT NULL DEFAULT 'fallback',
        estimatedSessionRequests INTEGER NOT NULL DEFAULT 0,
        estimatedWeeklyRequests INTEGER NOT NULL DEFAULT 0,
        estimatedSessionDurationMs INTEGER NOT NULL DEFAULT 0,
        estimatedWeeklyDurationMs INTEGER NOT NULL DEFAULT 0,
        sessionWindowStartedAt TEXT,
        weeklyWindowStartedAt TEXT,
        ollamaUsageJson TEXT,
        ollamaUsageLastRefreshAt TEXT,
        ollamaUsageLastError TEXT,
        sessionRemainingThresholdPercent REAL,
        weeklyRemainingThresholdPercent REAL,
        sessionQuotaLimit REAL,
        weeklyQuotaLimit REAL,
        totalRequests INTEGER NOT NULL DEFAULT 0,
        totalSuccesses INTEGER NOT NULL DEFAULT 0,
        totalFailures INTEGER NOT NULL DEFAULT 0,
        consecutiveFailures INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_keys_status ON keys(status);
      CREATE INDEX IF NOT EXISTS idx_keys_deleted ON keys(deletedAt);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        level TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        clientName TEXT,
        requestId TEXT,
        keyId TEXT,
        keyName TEXT,
        model TEXT,
        originalModel TEXT,
        upstreamModel TEXT,
        statusCode INTEGER,
        durationMs INTEGER,
        detailsJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_created ON events(createdAt);
      CREATE INDEX IF NOT EXISTS idx_events_key ON events(keyId);
      CREATE INDEX IF NOT EXISTS idx_events_client ON events(clientName);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);

      CREATE TABLE IF NOT EXISTS usage_account_state (
        keyId TEXT PRIMARY KEY,
        officialJson TEXT,
        officialFetchedAt TEXT,
        officialCheckedAt TEXT,
        officialChangedAt TEXT,
        baselineLedgerId INTEGER NOT NULL DEFAULT 0,
        lastErrorCode TEXT,
        lastErrorAt TEXT,
        FOREIGN KEY (keyId) REFERENCES keys(id)
      );

      CREATE TABLE IF NOT EXISTS usage_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyId TEXT NOT NULL,
        recordedAt TEXT NOT NULL,
        units REAL NOT NULL,
        promptTokens INTEGER NOT NULL DEFAULT 0,
        completionTokens INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        cachedTokens INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (keyId) REFERENCES keys(id)
      );

      CREATE INDEX IF NOT EXISTS idx_usage_ledger_key_id ON usage_ledger(keyId, id);
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_recorded ON usage_ledger(recordedAt);

      CREATE TABLE IF NOT EXISTS client_stats (
        clientName TEXT NOT NULL,
        day TEXT NOT NULL,
        totalRequests INTEGER NOT NULL DEFAULT 0,
        totalSuccesses INTEGER NOT NULL DEFAULT 0,
        totalFailures INTEGER NOT NULL DEFAULT 0,
        lastRequestAt TEXT,
        errorTypesJson TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (clientName, day)
      );

      CREATE TABLE IF NOT EXISTS model_stats (
        model TEXT NOT NULL,
        day TEXT NOT NULL,
        totalRequests INTEGER NOT NULL DEFAULT 0,
        totalSuccesses INTEGER NOT NULL DEFAULT 0,
        totalFailures INTEGER NOT NULL DEFAULT 0,
        promptTokens INTEGER NOT NULL DEFAULT 0,
        completionTokens INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        cachedTokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (model, day)
      );

      CREATE TABLE IF NOT EXISTS model_tests (
        model TEXT PRIMARY KEY,
        upstreamModel TEXT,
        ok INTEGER NOT NULL DEFAULT 0,
        statusCode INTEGER,
        responseTimeMs INTEGER,
        message TEXT,
        testedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS models_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fetchedAt TEXT NOT NULL,
        responseJson TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_settings (
        model TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS client_api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tokenPreview TEXT NOT NULL,
        encryptedToken TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_client_api_keys_name_live
        ON client_api_keys(name)
        WHERE deletedAt IS NULL;
      CREATE INDEX IF NOT EXISTS idx_client_api_keys_deleted ON client_api_keys(deletedAt);
      CREATE INDEX IF NOT EXISTS idx_events_request ON events(requestId);
      CREATE INDEX IF NOT EXISTS idx_events_model ON events(model);
    `);
    this.ensureColumn("model_stats", "promptTokens", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("model_stats", "completionTokens", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("model_stats", "totalTokens", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("model_stats", "cachedTokens", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("keys", "encryptedOllamaUsageCookie", "TEXT");
    this.ensureColumn("keys", "ollamaUsageJson", "TEXT");
    this.ensureColumn("keys", "ollamaUsageLastRefreshAt", "TEXT");
    this.ensureColumn("keys", "ollamaUsageLastError", "TEXT");
    this.ensureColumn("keys", "sessionRemainingThresholdPercent", "REAL");
    this.ensureColumn("keys", "weeklyRemainingThresholdPercent", "REAL");
    this.ensureColumn("keys", "sessionQuotaLimit", "REAL");
    this.ensureColumn("keys", "weeklyQuotaLimit", "REAL");
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Row[];
    if (columns.some((row) => String(row.name) === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private resetStaleActiveRequests() {
    this.db.query("UPDATE keys SET activeRequests = 0").run();
  }

  getSetting(key: string): string | null {
    const row = this.db.query("SELECT value FROM settings WHERE key = $key").get({ $key: key }) as Row | null;
    return row ? String(row.value) : null;
  }

  setSetting(key: string, value: string): void {
    const now = isoNow();
    this.db
      .query(
        `INSERT INTO settings (key, value, updatedAt)
         VALUES ($key, $value, $updatedAt)
         ON CONFLICT(key) DO UPDATE SET value = $value, updatedAt = $updatedAt`
      )
      .run({ $key: key, $value: value, $updatedAt: now });
  }

  getUsageSettings(config: AppConfig): UsageSettings {
    const rows = this.db.query("SELECT key, value FROM settings WHERE key LIKE 'usage.%'").all() as Row[];
    const saved = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
    return {
      usageTimezone: saved["usage.timezone"] || config.usageTimezone,
      sessionResetMode: saved["usage.sessionResetMode"] || config.sessionResetMode,
      sessionResetAnchor: saved["usage.sessionResetAnchor"] || config.sessionResetAnchor,
      sessionResetIntervalHours: Number(saved["usage.sessionResetIntervalHours"] || config.sessionResetIntervalHours),
      weeklyResetMode: saved["usage.weeklyResetMode"] || config.weeklyResetMode,
      weeklyResetDayOfWeek: Number(saved["usage.weeklyResetDayOfWeek"] || config.weeklyResetDayOfWeek),
      weeklyResetTime: saved["usage.weeklyResetTime"] || config.weeklyResetTime,
      weeklyResetGraceMinutes: Number(saved["usage.weeklyResetGraceMinutes"] || config.weeklyResetGraceMinutes),
      weeklyReactivationJitterSeconds: Number(
        saved["usage.weeklyReactivationJitterSeconds"] || config.weeklyReactivationJitterSeconds
      ),
    };
  }

  patchUsageSettings(config: AppConfig, patch: UsageSettingsPatch): UsageSettings {
    const current = this.getUsageSettings(config);
    const next: UsageSettings = { ...current, ...patch };
    this.validateUsageSettings(next);
    const entries: Array<[string, string]> = [
      ["usage.timezone", next.usageTimezone],
      ["usage.sessionResetMode", next.sessionResetMode],
      ["usage.sessionResetAnchor", next.sessionResetAnchor],
      ["usage.sessionResetIntervalHours", String(next.sessionResetIntervalHours)],
      ["usage.weeklyResetMode", next.weeklyResetMode],
      ["usage.weeklyResetDayOfWeek", String(next.weeklyResetDayOfWeek)],
      ["usage.weeklyResetTime", next.weeklyResetTime],
      ["usage.weeklyResetGraceMinutes", String(next.weeklyResetGraceMinutes)],
      ["usage.weeklyReactivationJitterSeconds", String(next.weeklyReactivationJitterSeconds)],
    ];
    const now = isoNow();
    const statement = this.db.query(
      `INSERT INTO settings (key, value, updatedAt)
       VALUES ($key, $value, $updatedAt)
       ON CONFLICT(key) DO UPDATE SET value = $value, updatedAt = $updatedAt`
    );
    for (const [key, value] of entries) statement.run({ $key: key, $value: value, $updatedAt: now });
    return next;
  }

  private validateUsageSettings(settings: UsageSettings): void {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: settings.usageTimezone }).format(new Date());
    } catch {
      throw new Error("Invalid usage timezone");
    }
    if (settings.sessionResetMode !== "fixed_anchor") throw new Error("Unsupported session reset mode");
    if (!Number.isFinite(Date.parse(settings.sessionResetAnchor))) throw new Error("Invalid session reset anchor");
    if (!Number.isFinite(settings.sessionResetIntervalHours) || settings.sessionResetIntervalHours <= 0) {
      throw new Error("Invalid session reset interval");
    }
    if (settings.weeklyResetMode !== "fixed_weekly") throw new Error("Unsupported weekly reset mode");
    if (!Number.isInteger(settings.weeklyResetDayOfWeek) || settings.weeklyResetDayOfWeek < 1 || settings.weeklyResetDayOfWeek > 7) {
      throw new Error("Invalid weekly reset day");
    }
    const [weeklyHour, weeklyMinute] = settings.weeklyResetTime.split(":").map(Number);
    if (
      !/^\d{2}:\d{2}$/.test(settings.weeklyResetTime) ||
      !Number.isInteger(weeklyHour) ||
      weeklyHour < 0 ||
      weeklyHour > 23 ||
      !Number.isInteger(weeklyMinute) ||
      weeklyMinute < 0 ||
      weeklyMinute > 59
    ) {
      throw new Error("Invalid weekly reset time");
    }
    if (!Number.isFinite(settings.weeklyResetGraceMinutes) || settings.weeklyResetGraceMinutes < 0) {
      throw new Error("Invalid weekly reset grace minutes");
    }
    if (!Number.isFinite(settings.weeklyReactivationJitterSeconds) || settings.weeklyReactivationJitterSeconds < 0) {
      throw new Error("Invalid weekly reset jitter seconds");
    }
  }

  createKey(input: KeyCreateInput): KeyRecord {
    const now = isoNow();
    const id = crypto.randomUUID();
    this.db
      .query(
        `INSERT INTO keys (
          id, name, notes, apiKeyPreview, encryptedApiKey, encryptedOllamaUsageCookie,
          enabled, status, blockReason, activeRequests, usageSource, resetSource,
          createdAt, updatedAt
        ) VALUES (
          $id, $name, $notes, $apiKeyPreview, $encryptedApiKey, $encryptedOllamaUsageCookie,
          1, 'unknown', 'none', 0, 'not_available', 'fallback',
          $createdAt, $updatedAt
        )`
      )
      .run({
        $id: id,
        $name: input.name,
        $notes: input.notes ?? null,
        $apiKeyPreview: input.apiKeyPreview,
        $encryptedApiKey: input.encryptedApiKey,
        $encryptedOllamaUsageCookie: input.encryptedOllamaUsageCookie ?? null,
        $createdAt: now,
        $updatedAt: now,
      });
    return this.getKeyOrThrow(id, true);
  }

  getKey(id: string, includeDeleted = false): KeyRecord | null {
    const row = this.db
      .query(
        `SELECT * FROM keys WHERE id = $id ${includeDeleted ? "" : "AND deletedAt IS NULL"}`
      )
      .get({ $id: id }) as Row | null;
    return row ? keyFromRow(row) : null;
  }

  getKeyOrThrow(id: string, includeDeleted = false): KeyRecord {
    const key = this.getKey(id, includeDeleted);
    if (!key) throw new Error("Key not found");
    return key;
  }

  listKeys(includeDeleted = false): KeyRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM keys ${includeDeleted ? "" : "WHERE deletedAt IS NULL"} ORDER BY createdAt ASC`
      )
      .all() as Row[];
    return rows.map(keyFromRow);
  }

  patchKey(id: string, patch: KeyMutationPatch): KeyRecord {
    const entries = Object.entries(patch);
    if (entries.length === 0) return this.getKeyOrThrow(id, true);
    const sets: string[] = [];
    const params: Record<string, unknown> = { $id: id, $updatedAt: isoNow() };
    for (const [key, value] of entries) {
      sets.push(`${key} = $${key}`);
      params[`$${key}`] = typeof value === "boolean" ? (value ? 1 : 0) : value;
    }
    sets.push("updatedAt = $updatedAt");
    this.db.query(`UPDATE keys SET ${sets.join(", ")} WHERE id = $id`).run(params as any);
    return this.getKeyOrThrow(id, true);
  }

  getUsageAccountState(keyId: string): UsageAccountState | null {
    const row = this.db
      .query("SELECT * FROM usage_account_state WHERE keyId = $keyId")
      .get({ $keyId: keyId }) as Row | null;
    if (!row) return null;
    return {
      keyId: String(row.keyId),
      officialJson: asString(row.officialJson),
      officialFetchedAt: asString(row.officialFetchedAt),
      officialCheckedAt: asString(row.officialCheckedAt),
      officialChangedAt: asString(row.officialChangedAt),
      baselineLedgerId: asNumber(row.baselineLedgerId),
      lastErrorCode: asString(row.lastErrorCode),
      lastErrorAt: asString(row.lastErrorAt),
    };
  }

  upsertUsageAccountState(state: UsageAccountState): UsageAccountState {
    this.db
      .query(
        `INSERT INTO usage_account_state (
          keyId, officialJson, officialFetchedAt, officialCheckedAt, officialChangedAt,
          baselineLedgerId, lastErrorCode, lastErrorAt
        ) VALUES (
          $keyId, $officialJson, $officialFetchedAt, $officialCheckedAt, $officialChangedAt,
          $baselineLedgerId, $lastErrorCode, $lastErrorAt
        )
        ON CONFLICT(keyId) DO UPDATE SET
          officialJson = $officialJson,
          officialFetchedAt = $officialFetchedAt,
          officialCheckedAt = $officialCheckedAt,
          officialChangedAt = $officialChangedAt,
          baselineLedgerId = $baselineLedgerId,
          lastErrorCode = $lastErrorCode,
          lastErrorAt = $lastErrorAt`
      )
      .run({
        $keyId: state.keyId,
        $officialJson: state.officialJson,
        $officialFetchedAt: state.officialFetchedAt,
        $officialCheckedAt: state.officialCheckedAt,
        $officialChangedAt: state.officialChangedAt,
        $baselineLedgerId: state.baselineLedgerId,
        $lastErrorCode: state.lastErrorCode,
        $lastErrorAt: state.lastErrorAt,
      });
    return this.getUsageAccountState(state.keyId)!;
  }

  latestUsageLedgerId(keyId: string): number {
    const row = this.db
      .query("SELECT COALESCE(MAX(id), 0) AS id FROM usage_ledger WHERE keyId = $keyId")
      .get({ $keyId: keyId }) as Row;
    return asNumber(row.id);
  }

  recordUsageLedger(keyId: string, units: number, usage?: TokenUsageInput): void {
    this.db
      .query(
        `INSERT INTO usage_ledger (
          keyId, recordedAt, units, promptTokens, completionTokens, totalTokens, cachedTokens
        ) VALUES (
          $keyId, $recordedAt, $units, $promptTokens, $completionTokens, $totalTokens, $cachedTokens
        )`
      )
      .run({
        $keyId: keyId,
        $recordedAt: isoNow(),
        $units: units,
        $promptTokens: usage?.promptTokens ?? 0,
        $completionTokens: usage?.completionTokens ?? 0,
        $totalTokens: usage?.totalTokens ?? 0,
        $cachedTokens: usage?.cachedTokens ?? 0,
      });
  }

  getUsageLedgerTotals(keyId: string, options: { afterId?: number; since?: string } = {}): UsageLedgerTotals {
    const clauses = ["keyId = $keyId"];
    const params: Record<string, unknown> = { $keyId: keyId };
    if (typeof options.afterId === "number") {
      clauses.push("id > $afterId");
      params.$afterId = options.afterId;
    }
    if (options.since) {
      clauses.push("recordedAt >= $since");
      params.$since = options.since;
    }
    const row = this.db
      .query(
        `SELECT
          COALESCE(SUM(units), 0) AS units,
          COALESCE(SUM(promptTokens), 0) AS promptTokens,
          COALESCE(SUM(completionTokens), 0) AS completionTokens,
          COALESCE(SUM(totalTokens), 0) AS totalTokens,
          COALESCE(SUM(cachedTokens), 0) AS cachedTokens,
          MAX(recordedAt) AS lastRecordedAt
        FROM usage_ledger WHERE ${clauses.join(" AND ")}`
      )
      .get(params as any) as Row;
    return {
      units: asNumber(row.units),
      promptTokens: asNumber(row.promptTokens),
      completionTokens: asNumber(row.completionTokens),
      totalTokens: asNumber(row.totalTokens),
      cachedTokens: asNumber(row.cachedTokens),
      lastRecordedAt: asString(row.lastRecordedAt),
    };
  }

  cleanupUsageLedger(retentionDays = 8): void {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    this.db.query("DELETE FROM usage_ledger WHERE recordedAt < $cutoff").run({ $cutoff: cutoff });
  }

  incrementKeyActive(id: string): KeyRecord {
    this.db
      .query("UPDATE keys SET activeRequests = activeRequests + 1, lastUsedAt = $now WHERE id = $id")
      .run({ $id: id, $now: isoNow() });
    return this.getKeyOrThrow(id, true);
  }

  decrementKeyActive(id: string): KeyRecord {
    this.db
      .query(
        "UPDATE keys SET activeRequests = CASE WHEN activeRequests > 0 THEN activeRequests - 1 ELSE 0 END WHERE id = $id"
      )
      .run({ $id: id });
    return this.getKeyOrThrow(id, true);
  }

  addEvent(input: EventInput): void {
    this.db
      .query(
        `INSERT INTO events (
          id, createdAt, level, type, message, clientName, requestId, keyId,
          keyName, model, originalModel, upstreamModel, statusCode, durationMs, detailsJson
        ) VALUES (
          $id, $createdAt, $level, $type, $message, $clientName, $requestId, $keyId,
          $keyName, $model, $originalModel, $upstreamModel, $statusCode, $durationMs, $detailsJson
        )`
      )
      .run({
        $id: crypto.randomUUID(),
        $createdAt: isoNow(),
        $level: input.level,
        $type: input.type,
        $message: input.message,
        $clientName: input.clientName ?? null,
        $requestId: input.requestId ?? null,
        $keyId: input.keyId ?? null,
        $keyName: input.keyName ?? null,
        $model: input.model ?? input.upstreamModel ?? input.originalModel ?? null,
        $originalModel: input.originalModel ?? null,
        $upstreamModel: input.upstreamModel ?? null,
        $statusCode: input.statusCode ?? null,
        $durationMs: input.durationMs ?? null,
        $detailsJson: input.details ? JSON.stringify(input.details) : null,
      });
  }

  listEvents(filters: {
    limit: number;
    keyId?: string;
    clientName?: string;
    type?: string;
    level?: string;
    since?: string;
    category?: string;
    requestId?: string;
    model?: string;
    hasUsage?: boolean;
  }): Row[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = { $limit: Math.min(Math.max(filters.limit, 1), 1000) };
    if (filters.keyId) {
      clauses.push("keyId = $keyId");
      params.$keyId = filters.keyId;
    }
    if (filters.clientName) {
      clauses.push("clientName = $clientName");
      params.$clientName = filters.clientName;
    }
    if (filters.type) {
      clauses.push("type = $type");
      params.$type = filters.type;
    }
    if (filters.level) {
      clauses.push("level = $level");
      params.$level = filters.level;
    }
    if (filters.since) {
      clauses.push("createdAt >= $since");
      params.$since = filters.since;
    }
    if (filters.requestId) {
      clauses.push("requestId = $requestId");
      params.$requestId = filters.requestId;
    }
    if (filters.model) {
      clauses.push("model = $model");
      params.$model = filters.model;
    }
    if (filters.hasUsage) {
      clauses.push("json_extract(detailsJson, '$.totalTokens') IS NOT NULL");
    }
    if (filters.category) {
      const categoryClauses = this.eventCategoryClauses(filters.category);
      if (categoryClauses.length > 0) clauses.push(`(${categoryClauses.join(" OR ")})`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .query(`SELECT * FROM events ${where} ORDER BY createdAt DESC LIMIT $limit`)
      .all(params as any) as Row[];
  }

  private eventCategoryClauses(category: string): string[] {
    switch (category) {
      case "success":
        return ["type IN ('request_finished', 'key_success')"];
      case "failure":
        return ["level IN ('warn', 'error')", "type IN ('request_failed', 'key_failure', 'no_available_key')"];
      case "quota":
        return ["type IN ('key_session_blocked', 'key_weekly_blocked', 'official_usage_blocked')"];
      case "auth":
        return ["type IN ('key_invalid', 'client_key_created', 'client_key_updated', 'client_key_rotated', 'client_key_deleted')"];
      case "network":
        return ["json_extract(detailsJson, '$.errorType') IN ('network_error', 'upstream_timeout', 'client_aborted')"];
      case "provider":
        return ["type = 'upstream_error'", "json_extract(detailsJson, '$.errorType') LIKE 'upstream_%'"];
      case "client":
        return ["type IN ('client_aborted', 'queue_timeout', 'queue_rejected')"];
      default:
        return [];
    }
  }

  cleanupEvents(retentionDays: number, maxEvents: number): void {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    this.db.query("DELETE FROM events WHERE createdAt < $cutoff").run({ $cutoff: cutoff });
    this.db
      .query(
        `DELETE FROM events WHERE id IN (
          SELECT id FROM events ORDER BY createdAt DESC LIMIT -1 OFFSET $maxEvents
        )`
      )
      .run({ $maxEvents: maxEvents });
  }

  recordClientRequest(clientName: string, success: boolean, errorType?: string): void {
    const now = isoNow();
    const day = now.slice(0, 10);
    const existing = this.db
      .query("SELECT errorTypesJson FROM client_stats WHERE clientName = $clientName AND day = $day")
      .get({ $clientName: clientName, $day: day }) as Row | null;
    const errors = existing?.errorTypesJson
      ? (JSON.parse(String(existing.errorTypesJson)) as Record<string, number>)
      : {};
    if (!success && errorType) errors[errorType] = (errors[errorType] || 0) + 1;
    this.db
      .query(
        `INSERT INTO client_stats (
          clientName, day, totalRequests, totalSuccesses, totalFailures, lastRequestAt, errorTypesJson
        ) VALUES (
          $clientName, $day, 1, $successes, $failures, $lastRequestAt, $errorTypesJson
        )
        ON CONFLICT(clientName, day) DO UPDATE SET
          totalRequests = totalRequests + 1,
          totalSuccesses = totalSuccesses + $successes,
          totalFailures = totalFailures + $failures,
          lastRequestAt = $lastRequestAt,
          errorTypesJson = $errorTypesJson`
      )
      .run({
        $clientName: clientName,
        $day: day,
        $successes: success ? 1 : 0,
        $failures: success ? 0 : 1,
        $lastRequestAt: now,
        $errorTypesJson: JSON.stringify(errors),
      });
  }

  recordModelRequest(model: string, success: boolean, usage?: TokenUsageInput): void {
    const day = isoNow().slice(0, 10);
    this.db
      .query(
        `INSERT INTO model_stats (
          model, day, totalRequests, totalSuccesses, totalFailures,
          promptTokens, completionTokens, totalTokens, cachedTokens
        )
        VALUES (
          $model, $day, 1, $successes, $failures,
          $promptTokens, $completionTokens, $totalTokens, $cachedTokens
        )
        ON CONFLICT(model, day) DO UPDATE SET
          totalRequests = totalRequests + 1,
          totalSuccesses = totalSuccesses + $successes,
          totalFailures = totalFailures + $failures,
          promptTokens = promptTokens + $promptTokens,
          completionTokens = completionTokens + $completionTokens,
          totalTokens = totalTokens + $totalTokens,
          cachedTokens = cachedTokens + $cachedTokens`
      )
      .run({
        $model: model,
        $day: day,
        $successes: success ? 1 : 0,
        $failures: success ? 0 : 1,
        $promptTokens: usage?.promptTokens ?? 0,
        $completionTokens: usage?.completionTokens ?? 0,
        $totalTokens: usage?.totalTokens ?? 0,
        $cachedTokens: usage?.cachedTokens ?? 0,
      });
  }

  getTodayClientStats(): Row[] {
    const day = isoNow().slice(0, 10);
    return this.db
      .query("SELECT * FROM client_stats WHERE day = $day ORDER BY clientName ASC")
      .all({ $day: day }) as Row[];
  }

  getTodayModelStats(): Row[] {
    const day = isoNow().slice(0, 10);
    return this.db
      .query("SELECT * FROM model_stats WHERE day = $day ORDER BY totalRequests DESC")
      .all({ $day: day }) as Row[];
  }

  getModelsCache(): { fetchedAt: string; responseJson: string } | null {
    return this.db
      .query("SELECT fetchedAt, responseJson FROM models_cache WHERE id = 1")
      .get() as { fetchedAt: string; responseJson: string } | null;
  }

  setModelsCache(responseJson: string): void {
    this.db
      .query(
        `INSERT INTO models_cache (id, fetchedAt, responseJson)
        VALUES (1, $fetchedAt, $responseJson)
        ON CONFLICT(id) DO UPDATE SET fetchedAt = $fetchedAt, responseJson = $responseJson`
      )
      .run({ $fetchedAt: isoNow(), $responseJson: responseJson });
  }

  upsertModelTest(input: {
    model: string;
    upstreamModel?: string | null;
    ok: boolean;
    statusCode?: number | null;
    responseTimeMs?: number | null;
    message?: string | null;
  }): void {
    this.db
      .query(
        `INSERT INTO model_tests (
          model, upstreamModel, ok, statusCode, responseTimeMs, message, testedAt
        ) VALUES (
          $model, $upstreamModel, $ok, $statusCode, $responseTimeMs, $message, $testedAt
        )
        ON CONFLICT(model) DO UPDATE SET
          upstreamModel = $upstreamModel,
          ok = $ok,
          statusCode = $statusCode,
          responseTimeMs = $responseTimeMs,
          message = $message,
          testedAt = $testedAt`
      )
      .run({
        $model: input.model,
        $upstreamModel: input.upstreamModel ?? null,
        $ok: input.ok ? 1 : 0,
        $statusCode: input.statusCode ?? null,
        $responseTimeMs: input.responseTimeMs ?? null,
        $message: input.message ?? null,
        $testedAt: isoNow(),
      });
  }

  getModelTests(): Row[] {
    return this.db.query("SELECT * FROM model_tests ORDER BY model ASC").all() as Row[];
  }

  getModelSettings(): Row[] {
    return this.db.query("SELECT * FROM model_settings ORDER BY model ASC").all() as Row[];
  }

  setModelEnabled(model: string, enabled: boolean): Row {
    const normalized = model.trim();
    const now = isoNow();
    this.db
      .query(
        `INSERT INTO model_settings (model, enabled, updatedAt)
        VALUES ($model, $enabled, $updatedAt)
        ON CONFLICT(model) DO UPDATE SET enabled = $enabled, updatedAt = $updatedAt`
      )
      .run({ $model: normalized, $enabled: enabled ? 1 : 0, $updatedAt: now });
    return this.db.query("SELECT * FROM model_settings WHERE model = $model").get({ $model: normalized }) as Row;
  }

  createClientApiKey(input: {
    name: string;
    tokenPreview: string;
    encryptedToken: string;
    notes?: string | null;
  }): ClientApiKeyRecord {
    const now = isoNow();
    const id = crypto.randomUUID();
    this.db
      .query(
        `INSERT INTO client_api_keys (
          id, name, tokenPreview, encryptedToken, enabled, notes, createdAt, updatedAt
        ) VALUES (
          $id, $name, $tokenPreview, $encryptedToken, 1, $notes, $createdAt, $updatedAt
        )`
      )
      .run({
        $id: id,
        $name: input.name,
        $tokenPreview: input.tokenPreview,
        $encryptedToken: input.encryptedToken,
        $notes: input.notes ?? null,
        $createdAt: now,
        $updatedAt: now,
      });
    return this.getClientApiKeyOrThrow(id, true);
  }

  listClientApiKeys(includeDeleted = false): ClientApiKeyRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM client_api_keys ${includeDeleted ? "" : "WHERE deletedAt IS NULL"} ORDER BY createdAt ASC`
      )
      .all() as Row[];
    return rows.map(clientApiKeyFromRow);
  }

  getClientApiKey(id: string, includeDeleted = false): ClientApiKeyRecord | null {
    const row = this.db
      .query(`SELECT * FROM client_api_keys WHERE id = $id ${includeDeleted ? "" : "AND deletedAt IS NULL"}`)
      .get({ $id: id }) as Row | null;
    return row ? clientApiKeyFromRow(row) : null;
  }

  getClientApiKeyByName(name: string): ClientApiKeyRecord | null {
    const row = this.db
      .query("SELECT * FROM client_api_keys WHERE name = $name AND deletedAt IS NULL")
      .get({ $name: name }) as Row | null;
    return row ? clientApiKeyFromRow(row) : null;
  }

  getClientApiKeyOrThrow(id: string, includeDeleted = false): ClientApiKeyRecord {
    const key = this.getClientApiKey(id, includeDeleted);
    if (!key) throw new Error("Client API key not found");
    return key;
  }

  patchClientApiKey(
    id: string,
    patch: Partial<{
      name: string;
      tokenPreview: string;
      encryptedToken: string;
      enabled: boolean;
      notes: string | null;
      deletedAt: string | null;
    }>
  ): ClientApiKeyRecord {
    const entries = Object.entries(patch);
    if (entries.length === 0) return this.getClientApiKeyOrThrow(id, true);
    const sets: string[] = [];
    const params: Record<string, unknown> = { $id: id, $updatedAt: isoNow() };
    for (const [key, value] of entries) {
      sets.push(`${key} = $${key}`);
      params[`$${key}`] = typeof value === "boolean" ? (value ? 1 : 0) : value;
    }
    sets.push("updatedAt = $updatedAt");
    this.db.query(`UPDATE client_api_keys SET ${sets.join(", ")} WHERE id = $id`).run(params as any);
    return this.getClientApiKeyOrThrow(id, true);
  }
}
