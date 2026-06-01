import type { AppConfig } from "../config/env";
import type { DatabaseStore, KeyMutationPatch } from "../storage/database";
import type { EventStore } from "../events/eventStore";
import type { ErrorClassification, KeyRecord, PublicKeyRecord } from "../types/domain";
import { apiKeyPreview, KeyCipher } from "../security/encryption";
import { cooldownUntilFromClassification } from "./errorClassifier";
import { isoNow, parseIso } from "../utils/time";

export function publicKey(key: KeyRecord): PublicKeyRecord {
  const { encryptedApiKey: _encryptedApiKey, ...safe } = key;
  return safe;
}

export class KeyPoolManager {
  constructor(
    private readonly config: AppConfig,
    private readonly store: DatabaseStore,
    private readonly events: EventStore,
    private readonly cipher: KeyCipher
  ) {}

  listPublic(includeDeleted = false) {
    return this.store.listKeys(includeDeleted).map(publicKey);
  }

  getPublic(id: string) {
    const key = this.store.getKey(id, true);
    return key ? publicKey(key) : null;
  }

  decryptKey(key: KeyRecord): string {
    return this.cipher.decrypt(key.encryptedApiKey);
  }

  create(input: { name: string; accountLabel?: string | null; notes?: string | null; apiKey: string }) {
    const name = input.name.trim();
    const apiKey = input.apiKey.trim();
    if (!name) throw new Error("name is required");
    if (!apiKey) throw new Error("apiKey is required");
    const key = this.store.createKey({
      name,
      accountLabel: input.accountLabel ?? null,
      notes: input.notes ?? null,
      apiKeyPreview: apiKeyPreview(apiKey),
      encryptedApiKey: this.cipher.encrypt(apiKey),
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
    if ("accountLabel" in body) patch.accountLabel = body.accountLabel ? String(body.accountLabel) : null;
    if ("notes" in body) patch.notes = body.notes ? String(body.notes) : null;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
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
    const key = this.store.patchKey(id, {
      cooldownUntil: null,
      nextEligibleAt: null,
      status: current.enabled && current.status !== "invalid" ? "available" : current.status,
      blockReason: current.enabled && current.status !== "invalid" ? "none" : current.blockReason,
    });
    this.events.emit({ level: "info", type: "key_cooldown_reset", message: `Key ${key.name} cooldown reset`, keyId: key.id, keyName: key.name });
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

  selectKey(requestId: string, clientName: string, originalModel?: string, upstreamModel?: string): KeyRecord | null {
    const selected = this.selectCandidate();
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

  releaseKey(id: string) {
    this.store.decrementKeyActive(id);
  }

  markSuccess(id: string, durationMs: number) {
    const current = this.store.getKeyOrThrow(id, true);
    const now = isoNow();
    const patch: KeyMutationPatch = {
      lastSuccessAt: now,
      status: current.enabled ? "available" : "disabled",
      blockReason: current.enabled ? "none" : current.blockReason,
      totalRequests: current.totalRequests + 1,
      totalSuccesses: current.totalSuccesses + 1,
      consecutiveFailures: Math.max(0, current.consecutiveFailures - 1),
      estimatedSessionRequests: current.estimatedSessionRequests + 1,
      estimatedWeeklyRequests: current.estimatedWeeklyRequests + 1,
      estimatedSessionDurationMs: current.estimatedSessionDurationMs + durationMs,
      estimatedWeeklyDurationMs: current.estimatedWeeklyDurationMs + durationMs,
      usageSource: "estimated_by_proxy",
      sessionWindowStartedAt: current.sessionWindowStartedAt ?? now,
      weeklyWindowStartedAt: current.weeklyWindowStartedAt ?? now,
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
    const key = this.store.patchKey(id, {
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
    if (classification.eventType !== "key_failure") {
      this.events.emit({
        level: classification.status === "invalid" ? "error" : "warn",
        type: classification.eventType,
        message: classification.message,
        keyId: key.id,
        keyName: key.name,
        details: { cooldownUntil },
      });
    }
  }

  summary() {
    const keys = this.store.listKeys(false);
    const now = Date.now();
    const count = (predicate: (key: KeyRecord) => boolean) => keys.filter(predicate).length;
    return {
      totalKeys: keys.length,
      availableKeys: count((key) => this.isSelectable(key, now)),
      coolingDownKeys: count((key) => key.status === "cooling_down" || Boolean(parseIso(key.cooldownUntil) && parseIso(key.cooldownUntil)! > now)),
      weeklyBlockedKeys: count((key) => key.status === "weekly_blocked"),
      sessionBlockedKeys: count((key) => key.status === "session_blocked"),
      invalidKeys: count((key) => key.status === "invalid"),
      disabledKeys: count((key) => !key.enabled || key.status === "disabled"),
    };
  }

  private selectCandidate(): KeyRecord | null {
    const now = Date.now();
    const candidates = this.store.listKeys(false).filter((key) => this.isSelectable(key, now));
    if (candidates.length === 0) return null;
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
