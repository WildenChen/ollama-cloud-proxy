import type { AppConfig } from "../config/env";
import type { ConcurrencyManager } from "../concurrency/concurrencyManager";
import { json, openAiError } from "../errors/responses";
import type { EventStore } from "../events/eventStore";
import { classifyUpstreamResponse } from "../keyPool/errorClassifier";
import type { KeyPoolManager } from "../keyPool/keyPoolManager";
import { publicKey } from "../keyPool/keyPoolManager";
import type { ModelManager } from "../models/modelManager";
import type { DatabaseStore } from "../storage/database";
import { getNextFixedWeeklyResetAt } from "../utils/time";

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
    if (path === "/admin/events" && req.method === "GET") return json({ events: this.eventsFor(req) });
    if (path === "/admin/keys" && req.method === "GET") return json({ keys: this.keyPool.listPublic(true) });
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
        this.config
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

  private stats() {
    const nextWeeklyResetAt = getNextFixedWeeklyResetAt(
      new Date(),
      this.config.usageTimezone,
      this.config.weeklyResetDayOfWeek,
      this.config.weeklyResetTime
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
      concurrency: this.concurrency.stats(),
      keys: keySummary,
      usage: {
        weeklyResetMode: this.config.weeklyResetMode,
        weeklyResetDayOfWeek: this.config.weeklyResetDayOfWeek,
        weeklyResetTime: this.config.weeklyResetTime,
        usageTimezone: this.config.usageTimezone,
        nextWeeklyResetAt,
        weeklyResetGraceMinutes: this.config.weeklyResetGraceMinutes,
        weeklyReactivationJitterSeconds: this.config.weeklyReactivationJitterSeconds,
        weeklyBlockedKeysCount: keySummary.weeklyBlockedKeys,
        keysReactivatingAtNextWeeklyReset: this.store
          .listKeys(false)
          .filter((key) => key.status === "weekly_blocked")
          .map(publicKey),
      },
      clients: persistedClients,
      models: {
        aliases: this.config.modelAliases,
        today: this.store.getTodayModelStats(),
      },
      adminUi: "not_implemented_json_api_only",
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
}
