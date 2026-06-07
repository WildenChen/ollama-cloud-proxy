import type { AppConfig } from "../config/env";
import type { ConcurrencyManager } from "../concurrency/concurrencyManager";
import { json, openAiError } from "../errors/responses";
import type { EventStore } from "../events/eventStore";
import { classifyUpstreamResponse } from "../keyPool/errorClassifier";
import type { KeyPoolManager } from "../keyPool/keyPoolManager";
import { publicKey } from "../keyPool/keyPoolManager";
import type { ModelManager } from "../models/modelManager";
import type { DatabaseStore, UsageSettingsPatch } from "../storage/database";
import type { KeyRecord } from "../types/domain";
import { getNextAnchoredIntervalResetAt, getNextFixedWeeklyResetAt, parseIso } from "../utils/time";
import { APP_VERSION } from "../config/version";

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON object expected");
  }
  return parsed as Record<string, unknown>;
}

export class AdminRoutes {
  constructor(
    private readonly config: AppConfig,
    private readonly store: DatabaseStore,
    private readonly keyPool: KeyPoolManager,
    private readonly concurrency: ConcurrencyManager,
    private readonly events: EventStore,
    private readonly models: ModelManager
  ) {}

  async handle(req: Request, path: string): Promise<Response> {
    if (path === "/admin/stats" && req.method === "GET") return json(this.stats());
    if (path === "/admin/usage-overview" && req.method === "GET") return json(this.usageOverview());
    if (path === "/admin/usage-settings" && req.method === "GET") return json(this.usageSettings());
    if (path === "/admin/usage-settings" && req.method === "PATCH") return this.patchUsageSettings(req);
    if (path === "/admin/events" && req.method === "GET") return json({ events: this.eventsFor(req) });
    if (path === "/admin/models" && req.method === "GET") return json(this.modelsOverview());
    if (path === "/admin/models/refresh" && req.method === "POST") return this.refreshModels();
    const modelTestMatch = path.match(/^\/admin\/models\/(.+)\/test$/);
    if (modelTestMatch && req.method === "POST") return this.testModel(decodeURIComponent(modelTestMatch[1]));
    if (path === "/admin/keys" && req.method === "GET") return json({ keys: this.keyPool.listPublic(false) });
    if (path === "/admin/keys" && req.method === "POST") return this.createKey(req);

    const match = path.match(/^\/admin\/keys\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return openAiError(404, "not_found", "Admin endpoint not found");

    const id = decodeURIComponent(match[1]);
    const action = match[2];

    if (!action && req.method === "GET") {
      const key = this.keyPool.getPublic(id);
      return key ? json({ key }) : openAiError(404, "key_not_found", "Key not found");
    }
    if (!action && req.method === "PATCH") return this.patchKey(req, id);
    if (!action && req.method === "DELETE") return json({ key: this.keyPool.softDelete(id) });

    if (req.method !== "POST") return openAiError(405, "method_not_allowed", "Method not allowed");
    if (action === "enable") return json({ key: this.keyPool.enable(id) });
    if (action === "disable") return json({ key: this.keyPool.disable(id) });
    if (action === "reset-cooldown") return json({ key: this.keyPool.resetCooldown(id) });
    if (action === "rotate") return this.rotateKey(req, id);
    if (action === "test") return this.testKey(id);

    return openAiError(404, "not_found", "Admin key action not found");
  }

  private async createKey(req: Request) {
    try {
      const body = await readJson(req);
      const key = this.keyPool.create({
        name: String(body.name || ""),
        accountLabel: body.accountLabel ? String(body.accountLabel) : null,
        notes: body.notes ? String(body.notes) : null,
        apiKey: String(body.apiKey || ""),
      });
      return json({ key }, 201);
    } catch (error) {
      return openAiError(400, "invalid_request", (error as Error).message);
    }
  }

  private async patchKey(req: Request, id: string) {
    try {
      const body = await readJson(req);
      return json({ key: this.keyPool.patchMetadata(id, body) });
    } catch (error) {
      return openAiError(400, "invalid_request", (error as Error).message);
    }
  }

  private async rotateKey(req: Request, id: string) {
    try {
      const body = await readJson(req);
      return json({ key: this.keyPool.rotate(id, String(body.apiKey || "")) });
    } catch (error) {
      return openAiError(400, "invalid_request", (error as Error).message);
    }
  }

  private async testKey(id: string) {
    const key = this.store.getKey(id, true);
    if (!key) return openAiError(404, "key_not_found", "Key not found");

    const started = Date.now();
    try {
      const apiKey = this.keyPool.decryptKey(key);
      const response = await fetch(`${this.config.upstreamBaseUrl}/v1/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(Math.min(this.config.upstreamTotalTimeoutMs, 30000)),
      });
      if (response.ok) {
        this.store.patchKey(id, {
          status: key.enabled ? "available" : "disabled",
          blockReason: key.enabled ? "none" : key.blockReason,
          lastSuccessAt: new Date().toISOString(),
          consecutiveFailures: 0,
          cooldownUntil: null,
          nextEligibleAt: null,
        });
        this.events.emit({
          level: "info",
          type: "key_tested",
          message: `Key ${key.name} test succeeded`,
          keyId: key.id,
          keyName: key.name,
          statusCode: response.status,
          durationMs: Date.now() - started,
        });
        return json({ ok: true, statusCode: response.status, key: this.keyPool.getPublic(id) });
      }

      const body = await response.text();
      const classification = await classifyUpstreamResponse(
        response.status,
        body,
        key.consecutiveFailures,
        this.store.getUsageSettings(this.config)
      );
      this.keyPool.markFailure(id, classification, Date.now() - started);
      this.events.emit({
        level: "warn",
        type: "key_tested",
        message: `Key ${key.name} test failed`,
        keyId: key.id,
        keyName: key.name,
        statusCode: response.status,
        durationMs: Date.now() - started,
      });
      return json({ ok: false, statusCode: response.status, key: this.keyPool.getPublic(id) }, 200);
    } catch (error) {
      this.events.emit({
        level: "error",
        type: "key_tested",
        message: `Key ${key.name} test errored`,
        keyId: key.id,
        keyName: key.name,
        durationMs: Date.now() - started,
        details: { errorMessage: (error as Error).message },
      });
      return openAiError(503, "key_test_failed", "Key test failed", { errorMessage: (error as Error).message });
    }
  }

  private modelsOverview() {
    const tests = Object.fromEntries(
      this.store.getModelTests().map((row) => [
        String(row.model),
        {
          model: String(row.model),
          upstreamModel: row.upstreamModel ? String(row.upstreamModel) : null,
          ok: Number(row.ok || 0) === 1,
          statusCode: row.statusCode === null || row.statusCode === undefined ? null : Number(row.statusCode),
          responseTimeMs: row.responseTimeMs === null || row.responseTimeMs === undefined ? null : Number(row.responseTimeMs),
          message: row.message ? String(row.message) : null,
          testedAt: String(row.testedAt),
        },
      ])
    );
    return {
      ...this.models.listModelsFromCache(),
      cache: this.models.cacheStats(),
      tests,
    };
  }

  private async refreshModels() {
    const requestId = crypto.randomUUID();
    const key = this.keyPool.selectKey(requestId, "admin-model-refresh");
    if (!key) return openAiError(503, "no_available_key", "No available Ollama Cloud key", this.keyPool.summary());
    const started = Date.now();
    try {
      const response = await fetch(`${this.config.upstreamBaseUrl}/v1/models`, {
        headers: { authorization: `Bearer ${this.keyPool.decryptKey(key)}` },
        signal: AbortSignal.timeout(Math.min(this.config.upstreamTotalTimeoutMs, 30000)),
      });
      const durationMs = Date.now() - started;
      if (response.ok) {
        const body = await response.json();
        this.models.setCachedModels(body);
        this.keyPool.markSuccess(key.id, durationMs);
        this.keyPool.releaseKey(key.id);
        return json(this.modelsOverview());
      }
      const body = await response.text();
      const classification = await classifyUpstreamResponse(
        response.status,
        body,
        key.consecutiveFailures,
        this.store.getUsageSettings(this.config)
      );
      this.keyPool.markFailure(key.id, classification, durationMs);
      this.keyPool.releaseKey(key.id);
      return openAiError(response.status, classification.blockReason, classification.message);
    } catch (error) {
      this.keyPool.releaseKey(key.id);
      return openAiError(503, "model_refresh_failed", "Model list refresh failed", {
        errorMessage: (error as Error).message,
      });
    }
  }

  private async testModel(model: string) {
    const mapped = this.models.mapModel(model);
    const upstreamModel = mapped.upstreamModel || model;
    const requestId = crypto.randomUUID();
    const key = this.keyPool.selectKey(requestId, "admin-model-test", model, upstreamModel);
    if (!key) {
      this.store.upsertModelTest({
        model,
        upstreamModel,
        ok: false,
        message: "No available key",
      });
      return openAiError(503, "no_available_key", "No available Ollama Cloud key", this.keyPool.summary());
    }

    const started = Date.now();
    try {
      const response = await fetch(`${this.config.upstreamBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.keyPool.decryptKey(key)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: upstreamModel,
          messages: [{ role: "user", content: "Reply with OK." }],
          stream: false,
          max_tokens: 16,
        }),
        signal: AbortSignal.timeout(Math.min(this.config.upstreamTotalTimeoutMs, 30000)),
      });
      const responseTimeMs = Date.now() - started;
      const text = await response.text();
      if (response.ok) {
        this.keyPool.markSuccess(key.id, responseTimeMs);
        this.keyPool.releaseKey(key.id);
        this.store.upsertModelTest({
          model,
          upstreamModel,
          ok: true,
          statusCode: response.status,
          responseTimeMs,
          message: this.modelTestMessage(text),
        });
        return json({ ok: true, model, upstreamModel, statusCode: response.status, responseTimeMs, result: this.modelsOverview().tests[model] });
      }

      const classification = await classifyUpstreamResponse(
        response.status,
        text,
        key.consecutiveFailures,
        this.store.getUsageSettings(this.config)
      );
      this.keyPool.markFailure(key.id, classification, responseTimeMs);
      this.keyPool.releaseKey(key.id);
      this.store.upsertModelTest({
        model,
        upstreamModel,
        ok: false,
        statusCode: response.status,
        responseTimeMs,
        message: classification.message,
      });
      return json({ ok: false, model, upstreamModel, statusCode: response.status, responseTimeMs, result: this.modelsOverview().tests[model] }, 200);
    } catch (error) {
      const responseTimeMs = Date.now() - started;
      this.keyPool.releaseKey(key.id);
      this.store.upsertModelTest({
        model,
        upstreamModel,
        ok: false,
        responseTimeMs,
        message: (error as Error).message,
      });
      return openAiError(503, "model_test_failed", "Model test failed", { errorMessage: (error as Error).message });
    }
  }

  private modelTestMessage(text: string) {
    try {
      const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: string }; text?: string }> };
      return parsed.choices?.[0]?.message?.content || parsed.choices?.[0]?.text || "OK";
    } catch {
      return text.slice(0, 120) || "OK";
    }
  }

  private usageSettings() {
    const settings = this.store.getUsageSettings(this.config);
    return {
      settings,
      nextSessionResetAt: getNextAnchoredIntervalResetAt(
        new Date(),
        settings.sessionResetAnchor,
        settings.sessionResetIntervalHours
      ).toISOString(),
      nextWeeklyResetAt: getNextFixedWeeklyResetAt(
        new Date(),
        settings.usageTimezone,
        settings.weeklyResetDayOfWeek,
        settings.weeklyResetTime
      ).toISOString(),
    };
  }

  private async patchUsageSettings(req: Request) {
    try {
      const body = await readJson(req);
      const patch: UsageSettingsPatch = {};
      if (typeof body.usageTimezone === "string") patch.usageTimezone = body.usageTimezone.trim();
      if (typeof body.sessionResetMode === "string") patch.sessionResetMode = body.sessionResetMode.trim();
      if (typeof body.sessionResetAnchor === "string") patch.sessionResetAnchor = new Date(body.sessionResetAnchor).toISOString();
      if ("sessionResetIntervalHours" in body) patch.sessionResetIntervalHours = Number(body.sessionResetIntervalHours);
      if (typeof body.weeklyResetMode === "string") patch.weeklyResetMode = body.weeklyResetMode.trim();
      if ("weeklyResetDayOfWeek" in body) patch.weeklyResetDayOfWeek = Number(body.weeklyResetDayOfWeek);
      if (typeof body.weeklyResetTime === "string") patch.weeklyResetTime = body.weeklyResetTime.trim();
      if ("weeklyResetGraceMinutes" in body) patch.weeklyResetGraceMinutes = Number(body.weeklyResetGraceMinutes);
      if ("weeklyReactivationJitterSeconds" in body) {
        patch.weeklyReactivationJitterSeconds = Number(body.weeklyReactivationJitterSeconds);
      }
      this.store.patchUsageSettings(this.config, patch);
      return json(this.usageSettings());
    } catch (error) {
      return openAiError(400, "invalid_usage_settings", (error as Error).message);
    }
  }

  private stats() {
    const settings = this.store.getUsageSettings(this.config);
    const nextSessionResetAt = getNextAnchoredIntervalResetAt(
      new Date(),
      settings.sessionResetAnchor,
      settings.sessionResetIntervalHours
    ).toISOString();
    const nextWeeklyResetAt = getNextFixedWeeklyResetAt(
      new Date(),
      settings.usageTimezone,
      settings.weeklyResetDayOfWeek,
      settings.weeklyResetTime
    ).toISOString();
    const keySummary = this.keyPool.summary();
    const runtimeClients = new Map(
      this.concurrency.clientRuntimeStats().map((item) => [item.clientName, item])
    );
    const persistedClients = this.store.getTodayClientStats().map((row) => {
      const runtime = runtimeClients.get(String(row.clientName));
      return {
        clientName: String(row.clientName),
        activeRequests: runtime?.activeRequests || 0,
        queuedRequests: runtime?.queuedRequests || 0,
        totalRequestsToday: Number(row.totalRequests || 0),
        totalSuccessesToday: Number(row.totalSuccesses || 0),
        totalFailuresToday: Number(row.totalFailures || 0),
        lastRequestAt: row.lastRequestAt || null,
        topErrorTypes: row.errorTypesJson ? JSON.parse(String(row.errorTypesJson)) : {},
      };
    });
    for (const [clientName, runtime] of runtimeClients) {
      if (!persistedClients.some((client) => client.clientName === clientName)) {
        persistedClients.push({
          clientName,
          activeRequests: runtime.activeRequests,
          queuedRequests: runtime.queuedRequests,
          totalRequestsToday: 0,
          totalSuccessesToday: 0,
          totalFailuresToday: 0,
          lastRequestAt: null,
          topErrorTypes: {},
        });
      }
    }

    return {
      status: "ok",
      version: APP_VERSION,
      concurrency: this.concurrency.stats(),
      keys: keySummary,
      usage: {
        note: "Session and weekly usage are estimated by this proxy unless an official usage API is configured.",
        overview: this.usageOverview(),
        windows: {
          session: {
            durationHours: 5,
            estimatedFields: ["estimatedSessionRequests", "estimatedSessionDurationMs", "sessionWindowStartedAt"],
          },
          weekly: {
            estimatedFields: ["estimatedWeeklyRequests", "estimatedWeeklyDurationMs", "weeklyWindowStartedAt"],
          },
          lifetimeFields: ["totalRequests", "totalSuccesses", "totalFailures"],
        },
        settings,
        sessionResetMode: settings.sessionResetMode,
        sessionResetAnchor: settings.sessionResetAnchor,
        sessionResetIntervalHours: settings.sessionResetIntervalHours,
        nextSessionResetAt,
        weeklyResetMode: settings.weeklyResetMode,
        weeklyResetDayOfWeek: settings.weeklyResetDayOfWeek,
        weeklyResetTime: settings.weeklyResetTime,
        usageTimezone: settings.usageTimezone,
        nextWeeklyResetAt,
        weeklyResetGraceMinutes: settings.weeklyResetGraceMinutes,
        weeklyReactivationJitterSeconds: settings.weeklyReactivationJitterSeconds,
        weeklyBlockedKeysCount: keySummary.weeklyBlockedKeys,
        keysReactivatingAtNextWeeklyReset: this.store
          .listKeys(false)
          .filter((key) => key.status === "weekly_blocked")
          .map(publicKey),
      },
      clients: persistedClients,
      models: {
        aliases: this.config.modelAliases,
        ollamaNativeApplyAliases: this.config.ollamaNativeApplyAliases,
        today: this.store.getTodayModelStats(),
        cache: this.models.cacheStats(),
      },
      adminUi: {
        enabled: true,
        path: "/admin",
      },
    };
  }

  private eventsFor(req: Request) {
    const url = new URL(req.url);
    return this.events.list({
      limit: Number(url.searchParams.get("limit") || 100),
      keyId: url.searchParams.get("keyId") || undefined,
      clientName: url.searchParams.get("clientName") || undefined,
      type: url.searchParams.get("type") || undefined,
      level: url.searchParams.get("level") || undefined,
      since: url.searchParams.get("since") || undefined,
    });
  }

  private usageOverview() {
    const settings = this.store.getUsageSettings(this.config);
    const keys = this.store.listKeys(false);
    const now = new Date();
    const totals = this.emptyAccountUsage("all", "All accounts");
    const accounts = new Map<string, ReturnType<typeof this.emptyAccountUsage>>();

    for (const key of keys) {
      const accountId = key.accountLabel?.trim() || `key:${key.id}`;
      const accountName = key.accountLabel?.trim() || key.name;
      const account = accounts.get(accountId) ?? this.emptyAccountUsage(accountId, accountName);
      this.addKeyUsage(totals, key, now, settings);
      this.addKeyUsage(account, key, now, settings);
      accounts.set(accountId, account);
    }

    return {
      source: "estimated_by_proxy",
      accountGrouping: "accountLabel",
      note: "Totals cover all keys known to this proxy. Keys without accountLabel are treated as separate accounts.",
      totals,
      accounts: Array.from(accounts.values()).sort((a, b) => b.weekly.estimatedRequests - a.weekly.estimatedRequests),
      topModelsToday: this.store.getTodayModelStats().map((row) => ({
        model: String(row.model),
        totalRequests: Number(row.totalRequests || 0),
        totalSuccesses: Number(row.totalSuccesses || 0),
        totalFailures: Number(row.totalFailures || 0),
        promptTokens: Number(row.promptTokens || 0),
        completionTokens: Number(row.completionTokens || 0),
        totalTokens: Number(row.totalTokens || 0),
        cachedTokens: Number(row.cachedTokens || 0),
      })),
      nextSessionResetAt: getNextAnchoredIntervalResetAt(
        now,
        settings.sessionResetAnchor,
        settings.sessionResetIntervalHours
      ).toISOString(),
      nextWeeklyResetAt: getNextFixedWeeklyResetAt(
        now,
        settings.usageTimezone,
        settings.weeklyResetDayOfWeek,
        settings.weeklyResetTime
      ).toISOString(),
    };
  }

  private emptyAccountUsage(id: string, name: string) {
    return {
      id,
      name,
      keyCount: 0,
      availableKeys: 0,
      sessionBlockedKeys: 0,
      weeklyBlockedKeys: 0,
      coolingDownKeys: 0,
      invalidKeys: 0,
      disabledKeys: 0,
      activeRequests: 0,
      session: {
        estimatedRequests: 0,
        estimatedDurationMs: 0,
        windowStartedAt: null as string | null,
      },
      weekly: {
        estimatedRequests: 0,
        estimatedDurationMs: 0,
        windowStartedAt: null as string | null,
      },
      lifetime: {
        totalRequests: 0,
        totalSuccesses: 0,
        totalFailures: 0,
      },
    };
  }

  private addKeyUsage(
    target: ReturnType<typeof this.emptyAccountUsage>,
    key: KeyRecord,
    now: Date,
    settings: ReturnType<DatabaseStore["getUsageSettings"]>
  ) {
    const session = this.effectiveSessionUsage(key, now, settings);
    const weekly = this.effectiveWeeklyUsage(key, now, settings);
    target.keyCount += 1;
    target.availableKeys += this.isEffectivelyAvailable(key, now.getTime()) ? 1 : 0;
    target.sessionBlockedKeys += key.status === "session_blocked" ? 1 : 0;
    target.weeklyBlockedKeys += key.status === "weekly_blocked" ? 1 : 0;
    target.coolingDownKeys += key.status === "cooling_down" ? 1 : 0;
    target.invalidKeys += key.status === "invalid" ? 1 : 0;
    target.disabledKeys += !key.enabled || key.status === "disabled" ? 1 : 0;
    target.activeRequests += key.activeRequests;
    target.session.estimatedRequests += session.estimatedRequests;
    target.session.estimatedDurationMs += session.estimatedDurationMs;
    target.session.windowStartedAt = this.earliestIso(target.session.windowStartedAt, session.windowStartedAt);
    target.weekly.estimatedRequests += weekly.estimatedRequests;
    target.weekly.estimatedDurationMs += weekly.estimatedDurationMs;
    target.weekly.windowStartedAt = this.earliestIso(target.weekly.windowStartedAt, weekly.windowStartedAt);
    target.lifetime.totalRequests += key.totalRequests;
    target.lifetime.totalSuccesses += key.totalSuccesses;
    target.lifetime.totalFailures += key.totalFailures;
  }

  private effectiveSessionUsage(
    key: KeyRecord,
    now: Date,
    settings: ReturnType<DatabaseStore["getUsageSettings"]>
  ) {
    const startedAt = parseIso(key.sessionWindowStartedAt);
    if (!startedAt) {
      return { estimatedRequests: 0, estimatedDurationMs: 0, windowStartedAt: null as string | null };
    }
    const nextReset = getNextAnchoredIntervalResetAt(
      new Date(startedAt),
      settings.sessionResetAnchor,
      settings.sessionResetIntervalHours
    );
    if (now.getTime() >= nextReset.getTime()) {
      return { estimatedRequests: 0, estimatedDurationMs: 0, windowStartedAt: null as string | null };
    }
    return {
      estimatedRequests: key.estimatedSessionRequests,
      estimatedDurationMs: key.estimatedSessionDurationMs,
      windowStartedAt: key.sessionWindowStartedAt,
    };
  }

  private effectiveWeeklyUsage(
    key: KeyRecord,
    now: Date,
    settings: ReturnType<DatabaseStore["getUsageSettings"]>
  ) {
    const startedAt = parseIso(key.weeklyWindowStartedAt);
    if (!startedAt) return { estimatedRequests: 0, estimatedDurationMs: 0, windowStartedAt: null as string | null };
    const nextReset = getNextFixedWeeklyResetAt(
      new Date(startedAt),
      settings.usageTimezone,
      settings.weeklyResetDayOfWeek,
      settings.weeklyResetTime
    );
    if (now.getTime() >= nextReset.getTime()) {
      return { estimatedRequests: 0, estimatedDurationMs: 0, windowStartedAt: null as string | null };
    }
    return {
      estimatedRequests: key.estimatedWeeklyRequests,
      estimatedDurationMs: key.estimatedWeeklyDurationMs,
      windowStartedAt: key.weeklyWindowStartedAt,
    };
  }

  private isEffectivelyAvailable(key: KeyRecord, now: number) {
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

  private earliestIso(current: string | null, next: string | null) {
    if (!next) return current;
    if (!current) return next;
    return Date.parse(next) < Date.parse(current) ? next : current;
  }
}
