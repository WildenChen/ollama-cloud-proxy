import type { AppConfig } from "../config/env";
import type { EventStore } from "../events/eventStore";
import type { KeyPoolManager } from "../keyPool/keyPoolManager";
import type { DatabaseStore, TokenUsageInput, UsageAccountState, UsageLedgerTotals } from "../storage/database";
import type { EffectiveUsageSource, KeyRecord } from "../types/domain";
import { fetchOllamaCloudUsage, type OllamaCloudUsageSnapshot, type OllamaUsageWindow } from "./ollamaCloudUsage";
import { getNextAnchoredIntervalResetAt, getNextFixedWeeklyResetAt } from "./weeklyReset";

type StoredOfficial = {
  snapshot: OllamaCloudUsageSnapshot;
  available: boolean;
  quotaState: string;
  effectiveSource: "official";
};

type NormalizedWindow = {
  used: number;
  limit: number;
  used_percent: number;
  remaining: number;
  remaining_percent: number;
  reset_at: string | null;
};

type EstimateWindow = NormalizedWindow & {
  local_units: number;
  local_tokens: number;
};

export type UsageAccountSnapshot = {
  account_id: string;
  enabled: boolean;
  available: boolean;
  official: {
    five_hour: NormalizedWindow | null;
    weekly: NormalizedWindow | null;
    fetched_at: string | null;
    checked_at: string | null;
    changed_at: string | null;
    source: "ollama_cloud_settings" | null;
  };
  estimate: {
    five_hour: EstimateWindow | null;
    weekly: EstimateWindow | null;
  };
  effective: {
    five_hour: NormalizedWindow | null;
    weekly: NormalizedWindow | null;
    five_hour_source: EffectiveUsageSource;
    weekly_source: EffectiveUsageSource;
    source: EffectiveUsageSource;
  };
  stale: boolean;
  last_error_code: string | null;
  last_error_at: string | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function safeDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class UsageService {
  private readonly flights = new Map<string, Promise<OllamaCloudUsageSnapshot | null>>();
  private readonly timers = new Map<string, { timer: ReturnType<typeof setTimeout>; dueAt: number }>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: DatabaseStore,
    private readonly keyPool: KeyPoolManager,
    private readonly events: EventStore
  ) {}

  recordSuccess(keyId: string, usage?: TokenUsageInput): void {
    if (!this.config.usageApiEnabled) return;
    this.store.recordUsageLedger(keyId, this.config.usageEstimateUnitsPerSuccess, usage);
    this.scheduleRefresh(keyId, this.config.usageRefreshDebounceSeconds * 1000);
  }

  maybeScheduleStale(keyId: string): void {
    if (!this.config.usageApiEnabled) return;
    const key = this.store.getKey(keyId, false);
    if (!key) return;
    const state = this.ensureState(key);
    const checkedAt = safeDate(state?.officialCheckedAt);
    if (!checkedAt || Date.now() - checkedAt > this.config.usageOfficialStaleSeconds * 1000) {
      this.scheduleRefresh(keyId, 0);
    }
  }

  notifyRateLimit(keyId: string): void {
    if (!this.config.usageApiEnabled) return;
    this.scheduleRefresh(keyId, 0);
  }

  notifyCookieChanged(keyId: string): void {
    if (!this.config.usageApiEnabled) return;
    this.scheduleRefresh(keyId, 0);
  }

  scheduleRefresh(keyId: string, delayMs: number): void {
    if (!this.config.usageApiEnabled || this.flights.has(keyId)) return;
    const totalDelay = Math.max(0, delayMs + this.jitterMs());
    const dueAt = Date.now() + totalDelay;
    const existing = this.timers.get(keyId);
    if (existing && existing.dueAt <= dueAt) return;
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.timers.delete(keyId);
      void this.refreshKey(keyId, true);
    }, totalDelay);
    timer.unref?.();
    this.timers.set(keyId, { timer, dueAt });
  }

  async refreshMany(keyIds: string[], concurrency = 3): Promise<void> {
    const queue = [...new Set(keyIds)];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const keyId = queue.shift();
        if (!keyId) return;
        await this.refreshKey(keyId, true);
        if (queue.length && this.config.usageRefreshJitterSeconds > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.jitterMs()));
        }
      }
    });
    await Promise.all(workers);
  }

  refreshKey(keyId: string, force = false): Promise<OllamaCloudUsageSnapshot | null> {
    const existing = this.flights.get(keyId);
    if (existing) return existing;
    const flight = this.doRefreshKey(keyId, force).finally(() => this.flights.delete(keyId));
    this.flights.set(keyId, flight);
    return flight;
  }

  private async doRefreshKey(keyId: string, force: boolean): Promise<OllamaCloudUsageSnapshot | null> {
    const key = this.store.getKey(keyId, false);
    if (!key) return null;
    const state = this.ensureState(key);
    const stored = this.parseStored(state?.officialJson);
    const checkedAt = safeDate(state?.officialCheckedAt);
    if (!force && stored && checkedAt && Date.now() - checkedAt <= this.config.ollamaUsageRefreshTtlSeconds * 1000) {
      return stored.snapshot;
    }

    let cookie: string | null = null;
    try {
      cookie = this.keyPool.decryptOllamaUsageCookie(key) || this.config.ollamaUsageCookie;
    } catch {
      return this.recordRefreshError(key, state, "invalid_cookie", "Ollama Cloud usage cookie could not be decrypted.");
    }
    if (!cookie) {
      return this.recordRefreshError(key, state, "missing_cookie", "Ollama Cloud usage cookie is not configured.");
    }

    const result = await fetchOllamaCloudUsage({
      cookie,
      usageUrl: this.config.ollamaCloudUsageUrl,
      timeoutMs: Math.min(this.config.upstreamTotalTimeoutMs, 10_000),
    });
    if (!result.ok) return this.recordRefreshError(key, state, result.status, result.message);

    const now = new Date().toISOString();
    const currentKey = this.store.getKey(key.id, false) ?? key;
    const nextSnapshot = { ...result.snapshot, fetchedAt: now };
    const nextStored: StoredOfficial = {
      snapshot: nextSnapshot,
      available: this.isQuotaAvailable(currentKey),
      quotaState: `${currentKey.status}:${currentKey.blockReason}`,
      effectiveSource: "official",
    };
    const changed = !stored || JSON.stringify(this.comparable(stored)) !== JSON.stringify(this.comparable(nextStored));
    const officialJson = changed ? JSON.stringify(nextStored) : state?.officialJson ?? JSON.stringify(nextStored);
    const fetchedAt = changed ? now : state?.officialFetchedAt ?? stored?.snapshot.fetchedAt ?? now;
    const changedAt = changed ? now : state?.officialChangedAt ?? fetchedAt;
    this.store.upsertUsageAccountState({
      keyId: key.id,
      officialJson,
      officialFetchedAt: fetchedAt,
      officialCheckedAt: now,
      officialChangedAt: changedAt,
      baselineLedgerId: this.store.latestUsageLedgerId(key.id),
      lastErrorCode: null,
      lastErrorAt: null,
    });
    const effectiveSnapshot = changed ? nextSnapshot : stored?.snapshot ?? nextSnapshot;
    if (changed) {
      this.store.patchKey(key.id, {
        ollamaUsageJson: JSON.stringify(effectiveSnapshot),
        ollamaUsageLastRefreshAt: fetchedAt,
        ollamaUsageLastError: null,
        usageSource: "dashboard_scraped",
        resetSource: "dashboard_observed",
      });
    } else if (key.ollamaUsageLastError) {
      this.store.patchKey(key.id, { ollamaUsageLastError: null });
    }
    if (changed) {
      this.events.emit({
        level: "info",
        type: "official_usage_refreshed",
        message: `Official Ollama Cloud usage refreshed for ${key.name}`,
        keyId: key.id,
        keyName: key.name,
        details: { session: effectiveSnapshot.session, weekly: effectiveSnapshot.weekly, plan: effectiveSnapshot.plan },
      });
    }
    this.applyOfficialUsageBlock(currentKey, effectiveSnapshot);
    return effectiveSnapshot;
  }

  private recordRefreshError(
    key: KeyRecord,
    state: UsageAccountState | null,
    code: string,
    message: string
  ): OllamaCloudUsageSnapshot | null {
    const now = new Date().toISOString();
    this.store.upsertUsageAccountState({
      keyId: key.id,
      officialJson: state?.officialJson ?? null,
      officialFetchedAt: state?.officialFetchedAt ?? null,
      officialCheckedAt: state?.officialCheckedAt ?? null,
      officialChangedAt: state?.officialChangedAt ?? null,
      baselineLedgerId: state?.baselineLedgerId ?? 0,
      lastErrorCode: code,
      lastErrorAt: now,
    });
    this.store.patchKey(key.id, { ollamaUsageLastError: message });
    this.events.emit({
      level: "warn",
      type: "official_usage_refresh_failed",
      message,
      keyId: key.id,
      keyName: key.name,
      details: { status: code },
    });
    return this.parseStored(state?.officialJson)?.snapshot ?? this.parseLegacy(key.ollamaUsageJson);
  }

  private comparable(value: StoredOfficial) {
    return {
      session: value.snapshot.session,
      weekly: value.snapshot.weekly,
      available: value.available,
      quotaState: value.quotaState,
      effectiveSource: value.effectiveSource,
    };
  }

  private ensureState(key: KeyRecord): UsageAccountState | null {
    const existing = this.store.getUsageAccountState(key.id);
    if (existing) return existing;
    const legacy = this.parseLegacy(key.ollamaUsageJson);
    if (!legacy) return null;
    const fetchedAt = key.ollamaUsageLastRefreshAt || legacy.fetchedAt;
    return this.store.upsertUsageAccountState({
      keyId: key.id,
      officialJson: JSON.stringify({
        snapshot: legacy,
        available: this.isQuotaAvailable(key),
        quotaState: `${key.status}:${key.blockReason}`,
        effectiveSource: "official",
      } satisfies StoredOfficial),
      officialFetchedAt: fetchedAt,
      officialCheckedAt: fetchedAt,
      officialChangedAt: fetchedAt,
      baselineLedgerId: this.store.latestUsageLedgerId(key.id),
      lastErrorCode: key.ollamaUsageLastError ? "legacy_error" : null,
      lastErrorAt: key.ollamaUsageLastError ? fetchedAt : null,
    });
  }

  private stateForRead(key: KeyRecord): UsageAccountState | null {
    const existing = this.store.getUsageAccountState(key.id);
    if (existing) return existing;
    const legacy = this.parseLegacy(key.ollamaUsageJson);
    if (!legacy) return null;
    const fetchedAt = key.ollamaUsageLastRefreshAt || legacy.fetchedAt;
    return {
      keyId: key.id,
      officialJson: JSON.stringify({
        snapshot: legacy,
        available: this.isQuotaAvailable(key),
        quotaState: `${key.status}:${key.blockReason}`,
        effectiveSource: "official",
      } satisfies StoredOfficial),
      officialFetchedAt: fetchedAt,
      officialCheckedAt: fetchedAt,
      officialChangedAt: fetchedAt,
      baselineLedgerId: this.store.latestUsageLedgerId(key.id),
      lastErrorCode: key.ollamaUsageLastError ? "legacy_error" : null,
      lastErrorAt: key.ollamaUsageLastError ? fetchedAt : null,
    };
  }

  private parseStored(value: string | null | undefined): StoredOfficial | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as StoredOfficial;
      return parsed?.snapshot?.status === "ok" ? parsed : null;
    } catch {
      return null;
    }
  }

  private parseLegacy(value: string | null | undefined): OllamaCloudUsageSnapshot | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as OllamaCloudUsageSnapshot;
      return parsed?.status === "ok" ? parsed : null;
    } catch {
      return null;
    }
  }

  accountsSnapshot(): { provider: string; updated_at: string; accounts: UsageAccountSnapshot[] } {
    const accounts = this.store.listKeys(false).filter((key) => key.enabled).map((key) => this.accountSnapshot(key));
    return { provider: "ollama-cloud-proxy", updated_at: new Date().toISOString(), accounts };
  }

  overviewSnapshot() {
    const { accounts, updated_at } = this.accountsSnapshot();
    const sources = {
      official: accounts.filter((account) => account.effective.source === "official").length,
      estimated: accounts.filter((account) => account.effective.source === "estimated").length,
      local_only: accounts.filter((account) => account.effective.source === "local_only").length,
      unknown: accounts.filter((account) => account.effective.source === "unknown").length,
    };
    return {
      provider: "ollama-cloud-proxy",
      updated_at,
      accounts_total: accounts.length,
      accounts_available: accounts.filter((account) => account.available).length,
      accounts_official: sources.official,
      accounts_estimated: sources.estimated + sources.local_only,
      sources,
      windows: [
        this.aggregateWindow(accounts, "five_hour", "5h"),
        this.aggregateWindow(accounts, "weekly", "Week"),
      ],
    };
  }

  private accountSnapshot(key: KeyRecord): UsageAccountSnapshot {
    const state = this.stateForRead(key);
    const stored = this.parseStored(state?.officialJson);
    const official = stored?.snapshot ?? this.parseLegacy(key.ollamaUsageJson);
    const checkedAt = state?.officialCheckedAt ?? key.ollamaUsageLastRefreshAt;
    const stale = !checkedAt || Date.now() - (safeDate(checkedAt) ?? 0) > this.config.usageOfficialStaleSeconds * 1000;
    const fiveHour = this.windowSnapshot(key, state, official?.session ?? null, key.sessionQuotaLimit ?? 100, "five_hour");
    const weekly = this.windowSnapshot(key, state, official?.weekly ?? null, key.weeklyQuotaLimit ?? 100, "weekly");
    const sources = [fiveHour.source, weekly.source];
    const effectiveSource = sources.includes("unknown")
      ? "unknown"
      : sources.includes("local_only") && !sources.includes("official") && !sources.includes("estimated")
        ? "local_only"
        : sources.every((source) => source === "official")
          ? "official"
          : "estimated";
    return {
      account_id: key.id,
      enabled: key.enabled,
      available: this.isAvailable(key),
      official: {
        five_hour: fiveHour.official,
        weekly: weekly.official,
        fetched_at: state?.officialFetchedAt ?? official?.fetchedAt ?? null,
        checked_at: checkedAt ?? null,
        changed_at: state?.officialChangedAt ?? official?.fetchedAt ?? null,
        source: official ? "ollama_cloud_settings" : null,
      },
      estimate: { five_hour: fiveHour.estimate, weekly: weekly.estimate },
      effective: {
        five_hour: fiveHour.effective,
        weekly: weekly.effective,
        five_hour_source: fiveHour.source,
        weekly_source: weekly.source,
        source: effectiveSource,
      },
      stale,
      last_error_code: state?.lastErrorCode ?? null,
      last_error_at: state?.lastErrorAt ?? null,
    };
  }

  private windowSnapshot(
    key: KeyRecord,
    state: UsageAccountState | null,
    officialWindow: OllamaUsageWindow | null,
    rawLimit: number,
    kind: "five_hour" | "weekly"
  ): { official: NormalizedWindow | null; estimate: EstimateWindow | null; effective: NormalizedWindow | null; source: EffectiveUsageSource } {
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100;
    const resetMs = safeDate(officialWindow?.resetAt);
    const officialUsable = Boolean(officialWindow && (!resetMs || resetMs > Date.now()));
    const official = officialWindow ? this.normalizeOfficial(officialWindow, limit) : null;
    const fallbackSince = Date.now() - (kind === "five_hour" ? 5 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000);
    const localOnlySince = Math.max(resetMs ?? 0, fallbackSince);
    const ledger = officialUsable
      ? this.store.getUsageLedgerTotals(key.id, { afterId: state?.baselineLedgerId ?? 0 })
      : this.store.getUsageLedgerTotals(key.id, { since: new Date(localOnlySince).toISOString() });
    const baseUsed = officialUsable ? official?.used ?? 0 : 0;
    const estimatedUsed = clamp(baseUsed + ledger.units, 0, limit);
    const estimate = ledger.units > 0 || (official && state?.lastErrorCode)
      ? this.estimateWindow(estimatedUsed, limit, officialWindow?.resetAt ?? null, ledger)
      : null;
    if (officialUsable && official && !estimate) return { official, estimate: null, effective: official, source: "official" };
    if (officialUsable && estimate) return { official, estimate, effective: estimate, source: "estimated" };
    if (estimate) return { official, estimate, effective: estimate, source: "local_only" };
    return { official, estimate: null, effective: null, source: "unknown" };
  }

  private normalizeOfficial(window: OllamaUsageWindow, limit: number): NormalizedWindow {
    const used = clamp((window.usedPercent / 100) * limit, 0, limit);
    return {
      used: round(used),
      limit: round(limit),
      used_percent: round((used / limit) * 100),
      remaining: round(limit - used),
      remaining_percent: round(100 - (used / limit) * 100),
      reset_at: window.resetAt,
    };
  }

  private estimateWindow(used: number, limit: number, resetAt: string | null, ledger: UsageLedgerTotals): EstimateWindow {
    return {
      used: round(used),
      limit: round(limit),
      used_percent: round((used / limit) * 100),
      remaining: round(limit - used),
      remaining_percent: round(100 - (used / limit) * 100),
      reset_at: resetAt,
      local_units: round(ledger.units),
      local_tokens: ledger.totalTokens,
    };
  }

  private aggregateWindow(accounts: UsageAccountSnapshot[], field: "five_hour" | "weekly", label: string) {
    const values = accounts.map((account) => {
      const value = account.effective[field];
      const source = account.effective[`${field}_source`];
      return { source, value };
    });
    const unknown = values.length === 0 || values.some((item) => !item.value || item.source === "unknown");
    const officialCount = values.filter((item) => item.source === "official").length;
    const source = unknown ? "unknown" : officialCount === values.length ? "official" : officialCount > 0 ? "mixed" : "estimated";
    const used = values.reduce((sum, item) => sum + (item.value?.used ?? 0), 0);
    const limit = values.reduce((sum, item) => sum + (item.value?.limit ?? 0), 0);
    const resets = values.map((item) => item.value?.reset_at).filter((value): value is string => Boolean(value));
    const buckets = new Map<string, number>();
    for (const reset of resets) buckets.set(reset, (buckets.get(reset) ?? 0) + 1);
    return {
      label,
      used: unknown ? null : round(used),
      limit: unknown ? null : round(limit),
      used_percent: unknown || !limit ? null : round((used / limit) * 100),
      remaining: unknown ? null : round(limit - used),
      remaining_percent: unknown || !limit ? null : round(100 - (used / limit) * 100),
      source,
      next_reset_at: resets.length ? resets.sort()[0] : null,
      latest_reset_at: resets.length ? resets.sort().at(-1) ?? null : null,
      reset_buckets: Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([reset_at, accounts_count]) => ({ reset_at, accounts_count })),
    };
  }

  private applyOfficialUsageBlock(key: KeyRecord, snapshot: OllamaCloudUsageSnapshot): void {
    const sessionThreshold = key.sessionRemainingThresholdPercent ?? 1;
    const weeklyThreshold = key.weeklyRemainingThresholdPercent ?? 1;
    if (snapshot.session && snapshot.session.remainingPercent <= sessionThreshold) {
      const settings = this.store.getUsageSettings(this.config);
      const fallback = getNextAnchoredIntervalResetAt(new Date(), settings.sessionResetAnchor, settings.sessionResetIntervalHours).toISOString();
      const cooldownUntil = snapshot.session.resetAt || fallback;
      if (key.status !== "session_blocked" || key.cooldownUntil !== cooldownUntil) {
        this.keyPool.markOfficialUsageBlocked(key.id, "session_blocked", cooldownUntil);
      }
      return;
    }
    if (snapshot.weekly && snapshot.weekly.remainingPercent <= weeklyThreshold) {
      const settings = this.store.getUsageSettings(this.config);
      const fallback = getNextFixedWeeklyResetAt(new Date(), settings.usageTimezone, settings.weeklyResetDayOfWeek, settings.weeklyResetTime).toISOString();
      const cooldownUntil = snapshot.weekly.resetAt || fallback;
      if (key.status !== "weekly_blocked" || key.cooldownUntil !== cooldownUntil) {
        this.keyPool.markOfficialUsageBlocked(key.id, "weekly_blocked", cooldownUntil);
      }
      return;
    }
    if ((key.status === "session_blocked" || key.status === "weekly_blocked") && key.usageSource === "dashboard_scraped") {
      this.store.patchKey(key.id, {
        status: key.enabled ? "available" : "disabled",
        blockReason: key.enabled ? "none" : key.blockReason,
        cooldownUntil: null,
        nextEligibleAt: null,
      });
    }
  }

  private isAvailable(key: KeyRecord): boolean {
    return this.isQuotaAvailable(key) && key.activeRequests < this.config.maxConcurrentRequestsPerKey;
  }

  private isQuotaAvailable(key: KeyRecord): boolean {
    const cooldown = safeDate(key.cooldownUntil);
    return key.enabled &&
      key.status !== "invalid" &&
      key.status !== "disabled" &&
      (!cooldown || cooldown <= Date.now());
  }

  private jitterMs(): number {
    return Math.floor(Math.random() * Math.max(0, this.config.usageRefreshJitterSeconds) * 1000);
  }
}
