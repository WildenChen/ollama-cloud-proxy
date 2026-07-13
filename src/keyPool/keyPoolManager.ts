import type { AppConfig } from "../config/env";
import type { DatabaseStore, KeyMutationPatch } from "../storage/database";
import type { EventStore } from "../events/eventStore";
import type { ErrorClassification, KeyRecord, PublicKeyRecord } from "../types/domain";
import { apiKeyPreview, KeyCipher } from "../security/encryption";
import { cooldownUntilFromClassification } from "./errorClassifier";
import { getNextAnchoredIntervalResetAt, getNextFixedWeeklyResetAt, isoNow, parseIso } from "../utils/time";

export function publicKey(key: KeyRecord): PublicKeyRecord {
  const {
    encryptedApiKey: _encryptedApiKey,
    encryptedOllamaUsageCookie,
    ...safe
  } = key;
  return { ...safe, hasOllamaUsageCookie: Boolean(encryptedOllamaUsageCookie) };
}

function isCooldownActive(key: KeyRecord, now: number): boolean {
  const cooldownUntil = parseIso(key.cooldownUntil);
  return Boolean(cooldownUntil && cooldownUntil > now);
}

function publicKeyWithEffectiveStatus(key: KeyRecord, now = Date.now()): PublicKeyRecord {
  const safe = publicKey(key);
  if (
    safe.enabled &&
    safe.deletedAt === null &&
    safe.status !== "invalid" &&
    safe.status !== "disabled" &&
    !isCooldownActive(key, now)
  ) {
    return {
      ...safe,
      status: "available",
      blockReason: "none",
      cooldownUntil: null,
      nextEligibleAt: null,
    };
  }
  return safe;
}

function parseRemainingThreshold(value: unknown, field: string): number | null {
  if (value === null || value === "") return null;
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }
  return threshold;
}

export class KeyPoolManager {
  constructor(
    private readonly config: AppConfig,
    private readonly store: DatabaseStore,
    private readonly events: EventStore,
    private readonly cipher: KeyCipher
  ) {}

  listPublic(includeDeleted = false) {
    const now = Date.now();
    return this.store.listKeys(includeDeleted).map((key) => publicKeyWithEffectiveStatus(key, now));
  }

  getPublic(id: string) {
    const key = this.store.getKey(id, true);
    return key ? publicKeyWithEffectiveStatus(key) : null;
  }

  decryptKey(key: KeyRecord): string {
    return this.cipher.decrypt(key.encryptedApiKey);
  }

  decryptOllamaUsageCookie(key: KeyRecord): string | null {
    return key.encryptedOllamaUsageCookie ? this.cipher.decrypt(key.encryptedOllamaUsageCookie) : null;
  }

  create(input: { name: string; notes?: string | null; apiKey: string; ollamaUsageCookie?: string | null }) {
    const name = input.name.trim();
    const apiKey = input.apiKey.trim();
    if (!name) throw new Error("name is required");
    if (!apiKey) throw new Error("apiKey is required");
    const usageCookie = input.ollamaUsageCookie?.trim();
    const key = this.store.createKey({
      name,
      notes: input.notes ?? null,
      apiKeyPreview: apiKeyPreview(apiKey),
      encryptedApiKey: this.cipher.encrypt(apiKey),
      encryptedOllamaUsageCookie: usageCookie ? this.cipher.encrypt(usageCookie) : null,
    });
    this.events.emit({
      level: "info",
      type: "key_created",
      message: `Key ${key.name} created`,
      keyId: key.id,
      keyName: key.name,
    });
    return publicKey(key);
  }

  patchMetadata(id: string, body: Record<string, unknown>) {
    const patch: KeyMutationPatch = {};
    if (typeof body.name === "string") {
      if (!body.name.trim()) throw new Error("name cannot be empty");
      patch.name = body.name.trim();
    }
    if ("notes" in body) patch.notes = body.notes ? String(body.notes) : null;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if ("sessionRemainingThresholdPercent" in body) {
      patch.sessionRemainingThresholdPercent = parseRemainingThreshold(
        body.sessionRemainingThresholdPercent,
        "sessionRemainingThresholdPercent"
      );
    }
    if ("weeklyRemainingThresholdPercent" in body) {
      patch.weeklyRemainingThresholdPercent = parseRemainingThreshold(
        body.weeklyRemainingThresholdPercent,
        "weeklyRemainingThresholdPercent"
      );
    }
    if (typeof body.ollamaUsageCookie === "string") {
      const value = body.ollamaUsageCookie.trim();
      patch.encryptedOllamaUsageCookie = value ? this.cipher.encrypt(value) : null;
      patch.ollamaUsageJson = null;
      patch.ollamaUsageLastRefreshAt = null;
      patch.ollamaUsageLastError = null;
    }
    if (body.clearOllamaUsageCookie === true) {
      patch.encryptedOllamaUsageCookie = null;
      patch.ollamaUsageJson = null;
      patch.ollamaUsageLastRefreshAt = null;
      patch.ollamaUsageLastError = null;
    }
    const key = this.store.patchKey(id, patch);
    this.events.emit({
      level: "info",
      type: "key_updated",
      message: `Key ${key.name} updated`,
      keyId: key.id,
      keyName: key.name,
    });
    return publicKey(key);
  }

  rotate(id: string, apiKey: string) {
    if (!apiKey?.trim()) throw new Error("apiKey is required");
    const key = this.store.patchKey(id, {
      encryptedApiKey: this.cipher.encrypt(apiKey.trim()),
      apiKeyPreview: apiKeyPreview(apiKey.trim()),
      status: "unknown",
      blockReason: "none",
      cooldownUntil: null,
      nextEligibleAt: null,
      consecutiveFailures: 0,
    });
    this.events.emit({
      level: "info",
      type: "key_rotated",
      message: `Key ${key.name} rotated`,
      keyId: key.id,
      keyName: key.name,
    });
    return publicKey(key);
  }

  enable(id: string) {
    const current = this.store.getKeyOrThrow(id, true);
    const status = current.status === "invalid" ? current.status : "available";
    const key = this.store.patchKey(id, {
      enabled: true,
      status,
      blockReason: status === "invalid" ? current.blockReason : "none",
      deletedAt: null,
    });
    this.events.emit({ level: "info", type: "key_enabled", message: `Key ${key.name} enabled`, keyId: key.id, keyName: key.name });
    return publicKey(key);
  }

  disable(id: string) {
    const key = this.store.patchKey(id, {
      enabled: false,
      status: "disabled",
      blockReason: "manual_disabled",
    });
    this.events.emit({ level: "info", type: "key_disabled", message: `Key ${key.name} disabled`, keyId: key.id, keyName: key.name });
    return publicKey(key);
  }

  resetCooldown(id: string) {
    const current = this.store.getKeyOrThrow(id, true);
    const resettableStatus = current.enabled && current.status !== "disabled";
    const key = this.store.patchKey(id, {
      cooldownUntil: null,
      nextEligibleAt: null,
      status: resettableStatus ? "available" : current.status,
      blockReason: resettableStatus ? "none" : current.blockReason,
      consecutiveFailures: resettableStatus ? 0 : current.consecutiveFailures,
    });
    this.events.emit({ level: "info", type: "key_cooldown_reset", message: `Key ${key.name} cooldown reset`, keyId: key.id, keyName: key.name });
    return publicKey(key);
  }

  markOfficialUsageBlocked(id: string, status: "session_blocked" | "weekly_blocked", cooldownUntil: string | null) {
    const key = this.store.patchKey(id, {
      status,
      blockReason: status === "session_blocked" ? "session_usage_inferred" : "weekly_usage_inferred",
      cooldownUntil,
      nextEligibleAt: cooldownUntil,
      usageSource: "dashboard_scraped",
      resetSource: cooldownUntil ? "dashboard_observed" : "fallback",
    });
    this.events.emit({
      level: "warn",
      type: "official_usage_blocked",
      message: `Key ${key.name} blocked by official Ollama Cloud usage`,
      keyId: key.id,
      keyName: key.name,
      details: { status, cooldownUntil },
    });
    return publicKey(key);
  }

  softDelete(id: string) {
    const key = this.store.patchKey(id, {
      enabled: false,
      status: "disabled",
      blockReason: "manual_disabled",
      deletedAt: isoNow(),
    });
    this.events.emit({ level: "info", type: "key_deleted", message: `Key ${key.name} deleted`, keyId: key.id, keyName: key.name });
    return publicKey(key);
  }

  selectKey(
    requestId: string,
    clientName: string,
    originalModel?: string,
    upstreamModel?: string,
    excludedKeyIds: Set<string> = new Set()
  ): KeyRecord | null {
    const selected = this.selectCandidate(excludedKeyIds);
    if (!selected) return null;
    const key = this.store.incrementKeyActive(selected.id);
    this.events.emit({
      level: "debug",
      type: "key_selected",
      message: `Selected key ${key.name}`,
      clientName,
      requestId,
      keyId: key.id,
      keyName: key.name,
      originalModel,
      upstreamModel,
    });
    return key;
  }

  selectableCount(): number {
    const now = Date.now();
    return this.store.listKeys(false).filter((key) => this.isSelectable(key, now)).length;
  }

  releaseKey(id: string) {
    this.store.decrementKeyActive(id);
  }

  markSuccess(id: string, durationMs: number) {
    const current = this.store.getKeyOrThrow(id, true);
    const now = isoNow();
    const usage = this.rolloverUsagePatch(current, new Date(now));
    const patch: KeyMutationPatch = {
      ...usage,
      lastSuccessAt: now,
      status: current.enabled ? "available" : "disabled",
      blockReason: current.enabled ? "none" : current.blockReason,
      totalRequests: current.totalRequests + 1,
      totalSuccesses: current.totalSuccesses + 1,
      consecutiveFailures: Math.max(0, current.consecutiveFailures - 1),
      estimatedSessionRequests: (usage.estimatedSessionRequests ?? current.estimatedSessionRequests) + 1,
      estimatedWeeklyRequests: (usage.estimatedWeeklyRequests ?? current.estimatedWeeklyRequests) + 1,
      estimatedSessionDurationMs: (usage.estimatedSessionDurationMs ?? current.estimatedSessionDurationMs) + durationMs,
      estimatedWeeklyDurationMs: (usage.estimatedWeeklyDurationMs ?? current.estimatedWeeklyDurationMs) + durationMs,
      usageSource: "estimated_by_proxy",
      sessionWindowStartedAt: usage.sessionWindowStartedAt ?? current.sessionWindowStartedAt ?? now,
      weeklyWindowStartedAt: usage.weeklyWindowStartedAt ?? current.weeklyWindowStartedAt ?? now,
      cooldownUntil: null,
      nextEligibleAt: null,
    };
    const key = this.store.patchKey(id, patch);
    this.events.emit({
      level: "info",
      type: "key_success",
      message: `Key ${key.name} succeeded`,
      keyId: key.id,
      keyName: key.name,
      durationMs,
    });
  }

  markFailure(id: string, classification: ErrorClassification, durationMs?: number) {
    const current = this.store.getKeyOrThrow(id, true);
    const cooldownUntil = cooldownUntilFromClassification(classification);
    const usage = this.rolloverUsagePatch(current);
    const key = this.store.patchKey(id, {
      ...usage,
      lastFailureAt: isoNow(),
      status: classification.status,
      blockReason: classification.blockReason,
      cooldownUntil,
      nextEligibleAt: cooldownUntil,
      totalRequests: current.totalRequests + 1,
      totalFailures: current.totalFailures + 1,
      consecutiveFailures: current.consecutiveFailures + 1,
      usageSource:
        classification.blockReason === "session_usage_inferred" ||
        classification.blockReason === "weekly_usage_inferred"
          ? "inferred_from_error"
          : current.usageSource,
      resetSource:
        classification.blockReason === "weekly_usage_inferred"
          ? "fixed_weekly"
          : classification.blockReason === "session_usage_inferred"
            ? "inferred_from_error"
            : current.resetSource,
    });
    this.events.emit({
      level: classification.status === "invalid" ? "error" : "warn",
      type: "key_failure",
      message: classification.message,
      keyId: key.id,
      keyName: key.name,
      durationMs: durationMs ?? null,
      details: { status: key.status, blockReason: key.blockReason, cooldownUntil },
    });
    this.events.emit({
      level: classification.status === "invalid" ? "error" : "warn",
      type: classification.eventType,
      message: classification.message,
      keyId: key.id,
      keyName: key.name,
      details: { cooldownUntil },
    });
  }

  private rolloverUsagePatch(key: KeyRecord, now = new Date()): KeyMutationPatch {
    const nowIso = now.toISOString();
    const patch: KeyMutationPatch = {};
    const settings = this.store.getUsageSettings(this.config);
    const sessionStartedAt = parseIso(key.sessionWindowStartedAt);
    if (!sessionStartedAt) {
      patch.estimatedSessionRequests = 0;
      patch.estimatedSessionDurationMs = 0;
      patch.sessionWindowStartedAt = nowIso;
    } else {
      const nextSessionResetAfterWindowStart = getNextAnchoredIntervalResetAt(
        new Date(sessionStartedAt),
        settings.sessionResetAnchor,
        settings.sessionResetIntervalHours
      );
      if (now.getTime() >= nextSessionResetAfterWindowStart.getTime()) {
        patch.estimatedSessionRequests = 0;
        patch.estimatedSessionDurationMs = 0;
        patch.sessionWindowStartedAt = nowIso;
      }
    }

    const weeklyStartedAt = parseIso(key.weeklyWindowStartedAt);
    if (!weeklyStartedAt) {
      patch.estimatedWeeklyRequests = 0;
      patch.estimatedWeeklyDurationMs = 0;
      patch.weeklyWindowStartedAt = nowIso;
      return patch;
    }

    const nextResetAfterWindowStart = getNextFixedWeeklyResetAt(
      new Date(weeklyStartedAt),
      settings.usageTimezone,
      settings.weeklyResetDayOfWeek,
      settings.weeklyResetTime
    );
    if (now.getTime() >= nextResetAfterWindowStart.getTime()) {
      patch.estimatedWeeklyRequests = 0;
      patch.estimatedWeeklyDurationMs = 0;
      patch.weeklyWindowStartedAt = nowIso;
    }
    return patch;
  }

  summary() {
    const keys = this.store.listKeys(false);
    const now = Date.now();
    const count = (predicate: (key: KeyRecord) => boolean) => keys.filter(predicate).length;
    return {
      totalKeys: keys.length,
      availableKeys: count((key) => this.isSelectable(key, now)),
      coolingDownKeys: count((key) => isCooldownActive(key, now)),
      weeklyBlockedKeys: count((key) => key.status === "weekly_blocked" && isCooldownActive(key, now)),
      sessionBlockedKeys: count((key) => key.status === "session_blocked" && isCooldownActive(key, now)),
      invalidKeys: count((key) => key.status === "invalid"),
      disabledKeys: count((key) => !key.enabled || key.status === "disabled"),
    };
  }

  nextRecoveryAt(status: "session_blocked" | "weekly_blocked"): string | null {
    const times = this.store
      .listKeys(false)
      .filter((key) => key.status === status && key.cooldownUntil)
      .map((key) => Date.parse(key.cooldownUntil!))
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b);
    return times.length > 0 ? new Date(times[0]).toISOString() : null;
  }

  private selectCandidate(excludedKeyIds: Set<string>): KeyRecord | null {
    const now = Date.now();
    const candidates = this.store
      .listKeys(false)
      .filter((key) => !excludedKeyIds.has(key.id) && this.isSelectable(key, now));
    if (candidates.length === 0) return null;
    if (this.config.keySelectionMode === "ordered") return candidates[0];
    candidates.sort((a, b) => this.score(a, now) - this.score(b, now));
    const top = candidates.slice(0, Math.min(3, candidates.length));
    return top[Math.floor(Math.random() * top.length)] ?? null;
  }

  private isSelectable(key: KeyRecord, now: number): boolean {
    const cooldownUntil = parseIso(key.cooldownUntil);
    return (
      key.enabled &&
      key.deletedAt === null &&
      key.status !== "invalid" &&
      key.status !== "disabled" &&
      (!cooldownUntil || cooldownUntil <= now) &&
      key.activeRequests < this.config.maxConcurrentRequestsPerKey
    );
  }

  private score(key: KeyRecord, now: number): number {
    const lastSuccess = parseIso(key.lastSuccessAt);
    const lastUsed = parseIso(key.lastUsedAt);
    const recentSuccessBonus = lastSuccess && now - lastSuccess < 6 * 60 * 60 * 1000 ? -20 : 0;
    const recentUsePenalty = lastUsed ? Math.max(0, 30 - (now - lastUsed) / 1000) : 0;
    return (
      key.consecutiveFailures * 100 +
      key.estimatedSessionRequests * 2 +
      key.estimatedWeeklyRequests * 0.25 +
      key.activeRequests * 1000 +
      recentUsePenalty +
      recentSuccessBonus +
      Math.random()
    );
  }
}
