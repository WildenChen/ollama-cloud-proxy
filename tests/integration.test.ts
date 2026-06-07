import { afterEach, describe, expect, test } from "bun:test";
import { AdminRoutes } from "../src/admin/adminRoutes";
import type { AppConfig } from "../src/config/env";
import { ConcurrencyManager } from "../src/concurrency/concurrencyManager";
import { EventStore } from "../src/events/eventStore";
import { KeyPoolManager } from "../src/keyPool/keyPoolManager";
import { ModelManager } from "../src/models/modelManager";
import { ProxyHandler } from "../src/proxy/proxyHandler";
import { proxyReadableStream } from "../src/proxy/stream";
import { Router } from "../src/server/router";
import { KeyCipher } from "../src/security/encryption";
import { DatabaseStore } from "../src/storage/database";

const servers: Array<{ stop: (force?: boolean) => void }> = [];

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.stop(true);
  }
});

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    adminToken: "admin-token",
    keyEncryptionSecret: "test-secret",
    clientApiKeys: new Map([["client-token", "openclaw"]]),
    upstreamBaseUrl: "http://127.0.0.1:1",
    maxConcurrentRequests: 5,
    maxConcurrentRequestsPerKey: 1,
    requestQueueMax: 30,
    requestQueueTimeoutMs: 120000,
    upstreamTotalTimeoutMs: 30000,
    upstreamIdleTimeoutMs: 10000,
    maxRequestBodySizeBytes: 20 * 1024 * 1024,
    keyRetryPolicy: "smart",
    maxKeyAttemptsPerRequest: "all",
    maxNetworkRetryAttempts: 3,
    modelsCacheTtlSeconds: 3600,
    modelAliases: {},
    ollamaCompatDiscoveryPublic: true,
    ollamaNativeApplyAliases: true,
    usageTimezone: "Asia/Taipei",
    sessionResetMode: "fixed_anchor",
    sessionResetAnchor: "2026-06-06T20:00:00.000Z",
    sessionResetIntervalHours: 5,
    weeklyResetMode: "fixed_weekly",
    weeklyResetDayOfWeek: 1,
    weeklyResetTime: "08:30",
    weeklyResetGraceMinutes: 5,
    weeklyReactivationJitterSeconds: 0,
    eventRetentionDays: 14,
    maxEvents: 100000,
    logLevel: "error",
    dbPath: `/tmp/ollama-cloud-proxy-test-${crypto.randomUUID()}.sqlite`,
    ...overrides,
  };
}

function createApp(appConfig: AppConfig) {
  const store = new DatabaseStore(appConfig.dbPath);
  const events = new EventStore(store);
  const concurrency = new ConcurrencyManager(appConfig, events);
  const keyPool = new KeyPoolManager(appConfig, store, events, new KeyCipher(appConfig.keyEncryptionSecret));
  const models = new ModelManager(appConfig, store);
  const admin = new AdminRoutes(appConfig, store, keyPool, concurrency, events, models);
  const proxy = new ProxyHandler(appConfig, concurrency, keyPool, models, events, store);
  const router = new Router(appConfig, admin, proxy, concurrency, keyPool);
  const server = Bun.serve({ port: 0, fetch: (req) => router.handle(req) });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}`, store, keyPool, concurrency, events };
}

function createMockUpstream(handler: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

describe("proxy integration", () => {
  test("Admin create key hides full API key", async () => {
    const app = createApp(config());
    const response = await fetch(`${app.baseUrl}/admin/keys`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "free-01", apiKey: "ollama_secret_abcdef" }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(JSON.stringify(body)).not.toContain("ollama_secret_abcdef");
    expect(body.key.apiKeyPreview).toBe("ollama_sec...cdef");
  });

  test("Admin delete key hides it from the active key list", async () => {
    const app = createApp(config());
    const createResponse = await fetch(`${app.baseUrl}/admin/keys`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "free-01", apiKey: "ollama_secret_abcdef" }),
    });
    const created = await createResponse.json();

    const deleteResponse = await fetch(`${app.baseUrl}/admin/keys/${created.key.id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer admin-token" },
    });
    const listResponse = await fetch(`${app.baseUrl}/admin/keys`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const listed = await listResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(listResponse.status).toBe(200);
    expect(listed.keys).toHaveLength(0);
    expect(app.store.getKey(created.key.id, true)?.deletedAt).toBeTruthy();
  });

  test("Admin usage settings expose and persist reset anchors", async () => {
    const app = createApp(config());
    const patchResponse = await fetch(`${app.baseUrl}/admin/usage-settings`, {
      method: "PATCH",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({
        usageTimezone: "Asia/Taipei",
        sessionResetAnchor: "2026-06-07T04:00:00+08:00",
        sessionResetIntervalHours: 5,
        weeklyResetDayOfWeek: 7,
        weeklyResetTime: "04:00",
      }),
    });
    const patched = await patchResponse.json();
    const getResponse = await fetch(`${app.baseUrl}/admin/usage-settings`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const settings = await getResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);
    expect(patched.settings.sessionResetAnchor).toBe("2026-06-06T20:00:00.000Z");
    expect(settings.settings.weeklyResetDayOfWeek).toBe(7);
    expect(settings.settings.weeklyResetTime).toBe("04:00");
  });

  test("Admin key list treats expired cooldown as available", async () => {
    const app = createApp(config());
    const key = app.keyPool.create({ name: "cooldown-expired", apiKey: "good-key" });
    app.store.patchKey(key.id, {
      status: "cooling_down",
      blockReason: "provider_error",
      cooldownUntil: new Date(Date.now() - 60_000).toISOString(),
      nextEligibleAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const keysResponse = await fetch(`${app.baseUrl}/admin/keys`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const statsResponse = await fetch(`${app.baseUrl}/admin/stats`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const keysBody = await keysResponse.json();
    const statsBody = await statsResponse.json();

    expect(keysResponse.status).toBe(200);
    expect(keysBody.keys[0].status).toBe("available");
    expect(keysBody.keys[0].blockReason).toBe("none");
    expect(keysBody.keys[0].cooldownUntil).toBeNull();
    expect(statsBody.keys.availableKeys).toBe(1);
    expect(statsBody.keys.coolingDownKeys).toBe(0);
  });

  test("Admin key list keeps active cooldown visible", async () => {
    const app = createApp(config());
    const key = app.keyPool.create({ name: "cooldown-active", apiKey: "good-key" });
    const cooldownUntil = new Date(Date.now() + 60_000).toISOString();
    app.store.patchKey(key.id, {
      status: "cooling_down",
      blockReason: "provider_error",
      cooldownUntil,
      nextEligibleAt: cooldownUntil,
    });

    const keysResponse = await fetch(`${app.baseUrl}/admin/keys`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const statsResponse = await fetch(`${app.baseUrl}/admin/stats`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const keysBody = await keysResponse.json();
    const statsBody = await statsResponse.json();

    expect(keysResponse.status).toBe(200);
    expect(keysBody.keys[0].status).toBe("cooling_down");
    expect(keysBody.keys[0].blockReason).toBe("provider_error");
    expect(keysBody.keys[0].cooldownUntil).toBe(cooldownUntil);
    expect(statsBody.keys.availableKeys).toBe(0);
    expect(statsBody.keys.coolingDownKeys).toBe(1);
  });

  test("Admin stats reports Admin UI as enabled", async () => {
    const app = createApp(config());

    const response = await fetch(`${app.baseUrl}/admin/stats`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.adminUi).toEqual({ enabled: true, path: "/admin" });
    expect(body.usage.windows.lifetimeFields).toContain("totalRequests");
  });

  test("Admin usage overview totals all keys and groups by account label", async () => {
    const app = createApp(config());
    const now = new Date().toISOString();
    const first = app.keyPool.create({ name: "free-a-1", accountLabel: "free-a", apiKey: "good-key-a1" });
    const second = app.keyPool.create({ name: "free-a-2", accountLabel: "free-a", apiKey: "good-key-a2" });
    const ungrouped = app.keyPool.create({ name: "free-b-1", apiKey: "good-key-b1" });

    app.store.patchKey(first.id, {
      estimatedSessionRequests: 3,
      estimatedWeeklyRequests: 10,
      estimatedSessionDurationMs: 1200,
      estimatedWeeklyDurationMs: 5000,
      sessionWindowStartedAt: now,
      weeklyWindowStartedAt: now,
      totalRequests: 10,
      totalSuccesses: 9,
      totalFailures: 1,
    });
    app.store.patchKey(second.id, {
      estimatedSessionRequests: 2,
      estimatedWeeklyRequests: 7,
      estimatedSessionDurationMs: 800,
      estimatedWeeklyDurationMs: 3000,
      sessionWindowStartedAt: now,
      weeklyWindowStartedAt: now,
      totalRequests: 7,
      totalSuccesses: 7,
    });
    app.store.patchKey(ungrouped.id, {
      estimatedSessionRequests: 1,
      estimatedWeeklyRequests: 4,
      sessionWindowStartedAt: now,
      weeklyWindowStartedAt: now,
      totalRequests: 4,
      totalSuccesses: 4,
    });

    const response = await fetch(`${app.baseUrl}/admin/usage-overview`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totals.keyCount).toBe(3);
    expect(body.totals.session.estimatedRequests).toBe(6);
    expect(body.totals.weekly.estimatedRequests).toBe(21);
    expect(body.totals.lifetime.totalRequests).toBe(21);
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts.find((account: { name: string }) => account.name === "free-a")?.keyCount).toBe(2);
    expect(body.accounts.find((account: { name: string }) => account.name === "free-a")?.weekly.estimatedRequests).toBe(17);
    expect(body.accounts.find((account: { name: string }) => account.name === "free-b-1")?.keyCount).toBe(1);
  });

  test("queue full returns queue_full", async () => {
    const app = createApp(config({ maxConcurrentRequests: 0, requestQueueMax: 0 }));

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.type).toBe("queue_full");
  });

  test("queue timeout returns queue_timeout", async () => {
    const app = createApp(config({
      maxConcurrentRequests: 0,
      requestQueueMax: 1,
      requestQueueTimeoutMs: 10,
    }));

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.type).toBe("queue_timeout");
  });

  test("database startup clears stale key active requests", () => {
    const appConfig = config();
    const firstStore = new DatabaseStore(appConfig.dbPath);
    const keyPool = new KeyPoolManager(appConfig, firstStore, new EventStore(firstStore), new KeyCipher(appConfig.keyEncryptionSecret));
    const key = keyPool.create({ name: "stale", apiKey: "good-key" });
    firstStore.patchKey(key.id, { activeRequests: 7 });

    const restartedStore = new DatabaseStore(appConfig.dbPath);

    expect(restartedStore.getKey(key.id, true)?.activeRequests).toBe(0);
  });

  test("client token is required when CLIENT_API_KEYS is configured", async () => {
    const app = createApp(config());
    const response = await fetch(`${app.baseUrl}/v1/models`);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.type).toBe("unauthorized");
  });

  test("successful /v1/models forwards through selected key and updates stats", async () => {
    const upstreamBaseUrl = createMockUpstream((req) => {
      expect(req.headers.get("authorization")).toBe("Bearer good-key");
      return Response.json({ object: "list", data: [{ id: "llama", object: "model" }] });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    const key = app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });
    const body = await response.json();
    const updated = app.store.getKey(key.id, true)!;

    expect(response.status).toBe(200);
    expect(body.data[0].id).toBe("llama");
    expect(updated.totalSuccesses).toBe(1);
    expect(updated.activeRequests).toBe(0);
  });

  test("401 from upstream marks key invalid and does not leak secret", async () => {
    const upstreamBaseUrl = createMockUpstream(() => Response.json({ error: "bad key" }, { status: 401 }));
    const app = createApp(config({ upstreamBaseUrl }));
    const key = app.keyPool.create({ name: "bad", apiKey: "bad-key-secret" });

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });
    const bodyText = await response.text();
    const updated = app.store.getKey(key.id, true)!;

    expect(response.status).toBe(503);
    expect(updated.status).toBe("invalid");
    expect(updated.activeRequests).toBe(0);
    expect(bodyText).not.toContain("bad-key-secret");
  });

  test("upstream key failures try every selectable key before failing", async () => {
    const seenAuthHeaders: string[] = [];
    const upstreamBaseUrl = createMockUpstream((req) => {
      seenAuthHeaders.push(req.headers.get("authorization") || "");
      return Response.json({ error: "bad key" }, { status: 401 });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    const first = app.keyPool.create({ name: "bad-1", apiKey: "bad-key-1" });
    const second = app.keyPool.create({ name: "bad-2", apiKey: "bad-key-2" });
    const third = app.keyPool.create({ name: "bad-3", apiKey: "bad-key-3" });

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });

    expect(response.status).toBe(503);
    expect(seenAuthHeaders).toHaveLength(3);
    expect(new Set(seenAuthHeaders)).toEqual(new Set([
      "Bearer bad-key-1",
      "Bearer bad-key-2",
      "Bearer bad-key-3",
    ]));
    expect(app.store.getKey(first.id, true)?.status).toBe("invalid");
    expect(app.store.getKey(second.id, true)?.status).toBe("invalid");
    expect(app.store.getKey(third.id, true)?.status).toBe("invalid");
  });

  test("upstream key failures continue until a later selectable key succeeds", async () => {
    const seenAuthHeaders: string[] = [];
    const upstreamBaseUrl = createMockUpstream((req) => {
      const auth = req.headers.get("authorization") || "";
      seenAuthHeaders.push(auth);
      if (auth !== "Bearer good-key") {
        return Response.json({ error: "bad key" }, { status: 401 });
      }
      return Response.json({ object: "list", data: [{ id: "llama", object: "model" }] });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    app.keyPool.create({ name: "bad-1", apiKey: "bad-key-1" });
    app.keyPool.create({ name: "bad-2", apiKey: "bad-key-2" });
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].id).toBe("llama");
    expect(seenAuthHeaders).toContain("Bearer good-key");
    expect(seenAuthHeaders.length).toBeLessThanOrEqual(3);
  });

  test("session-limited keys are tried until a later selectable key succeeds", async () => {
    const seenAuthHeaders: string[] = [];
    const upstreamBaseUrl = createMockUpstream((req) => {
      const auth = req.headers.get("authorization") || "";
      seenAuthHeaders.push(auth);
      if (auth === "Bearer good-key") {
        return Response.json({ object: "list", data: [{ id: "llama", object: "model" }] });
      }
      return Response.json({ error: "usage limit reached for this 5-hour session" }, { status: 429 });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    for (let index = 1; index <= 4; index++) {
      app.keyPool.create({ name: `session-${index}`, apiKey: `session-key-${index}` });
    }
    const good = app.keyPool.create({ name: "good", apiKey: "good-key" });
    app.store.patchKey(good.id, { estimatedSessionRequests: 1000, estimatedWeeklyRequests: 1000 });

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].id).toBe("llama");
    expect(seenAuthHeaders).toContain("Bearer good-key");
    expect(app.store.listKeys(false).filter((key) => key.status === "session_blocked").length).toBeGreaterThanOrEqual(1);
  });

  test("all session-limited keys return no_available_key_after_attempts", async () => {
    const upstreamBaseUrl = createMockUpstream(() =>
      Response.json({ error: "usage limit reached for this 5-hour session" }, { status: 429 })
    );
    const app = createApp(config({ upstreamBaseUrl }));
    for (let index = 1; index <= 5; index++) {
      app.keyPool.create({ name: `session-${index}`, apiKey: `session-key-${index}` });
    }

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.type).toBe("no_available_key_after_attempts");
    expect(body.error.details.attemptedKeysCount).toBe(5);
    expect(body.error.details.sessionBlockedKeysCount).toBe(5);
  });

  test("request errors do not try another key or mark keys unavailable", async () => {
    const seenAuthHeaders: string[] = [];
    const upstreamBaseUrl = createMockUpstream((req) => {
      seenAuthHeaders.push(req.headers.get("authorization") || "");
      return Response.json({ error: "bad request" }, { status: 400 });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    app.keyPool.create({ name: "first", apiKey: "first-key" });
    app.keyPool.create({ name: "second", apiKey: "second-key" });

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });

    expect(response.status).toBe(400);
    expect(seenAuthHeaders).toHaveLength(1);
    expect(app.store.listKeys(false).some((key) => key.status === "cooling_down")).toBe(false);
    expect(app.store.listKeys(false).reduce((sum, key) => sum + key.totalRequests, 0)).toBe(0);
  });

  test("provider errors stop at MAX_NETWORK_RETRY_ATTEMPTS", async () => {
    const seenAuthHeaders: string[] = [];
    const upstreamBaseUrl = createMockUpstream((req) => {
      seenAuthHeaders.push(req.headers.get("authorization") || "");
      return Response.json({ error: "temporary unavailable" }, { status: 502 });
    });
    const app = createApp(config({ upstreamBaseUrl, maxNetworkRetryAttempts: 3 }));
    for (let index = 1; index <= 5; index++) {
      app.keyPool.create({ name: `key-${index}`, apiKey: `key-${index}` });
    }

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });

    expect(response.status).toBe(503);
    expect(seenAuthHeaders).toHaveLength(3);
  });

  test("weekly-limited key is blocked and next selectable key can succeed", async () => {
    const seenAuthHeaders: string[] = [];
    const upstreamBaseUrl = createMockUpstream((req) => {
      const auth = req.headers.get("authorization") || "";
      seenAuthHeaders.push(auth);
      if (auth === "Bearer good-key") {
        return Response.json({ object: "list", data: [{ id: "llama", object: "model" }] });
      }
      return Response.json({ error: "weekly 7-day usage limit reached" }, { status: 429 });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    for (let index = 1; index <= 3; index++) {
      app.keyPool.create({ name: `weekly-${index}`, apiKey: `weekly-key-${index}` });
    }
    const good = app.keyPool.create({ name: "good", apiKey: "good-key" });
    app.store.patchKey(good.id, { estimatedSessionRequests: 1000, estimatedWeeklyRequests: 1000 });

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });

    expect(response.status).toBe(200);
    expect(seenAuthHeaders).toContain("Bearer good-key");
    expect(app.store.listKeys(false).some((key) => key.status === "weekly_blocked")).toBe(true);
  });

  test("estimated usage windows roll over while lifetime counters keep increasing", async () => {
    const upstreamBaseUrl = createMockUpstream(() =>
      Response.json({ object: "list", data: [{ id: "llama", object: "model" }] })
    );
    const app = createApp(
      config({
        upstreamBaseUrl,
        sessionResetAnchor: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
      })
    );
    const key = app.keyPool.create({ name: "old-window", apiKey: "good-key" });
    app.store.patchKey(key.id, {
      estimatedSessionRequests: 50,
      estimatedSessionDurationMs: 5000,
      sessionWindowStartedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      estimatedWeeklyRequests: 500,
      estimatedWeeklyDurationMs: 50000,
      weeklyWindowStartedAt: "2026-05-01T00:00:00.000Z",
      totalRequests: 10,
      totalSuccesses: 8,
      totalFailures: 2,
    });

    const response = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: "Bearer client-token" },
    });
    const updated = app.store.getKey(key.id, true)!;

    expect(response.status).toBe(200);
    expect(updated.estimatedSessionRequests).toBe(1);
    expect(updated.estimatedWeeklyRequests).toBe(1);
    expect(updated.totalRequests).toBe(11);
    expect(updated.totalSuccesses).toBe(9);
    expect(updated.totalFailures).toBe(2);
  });

  test("model alias rewrites chat completion request body", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      const body = await req.json();
      return Response.json({ model: body.model, choices: [] });
    });
    const app = createApp(
      config({ upstreamBaseUrl, modelAliases: { "kilo-default": "actual-model" } })
    );
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "kilo-default", messages: [{ role: "user", content: "hi" }] }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model).toBe("actual-model");
  });

  test("non-stream OpenAI responses record token usage by model", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      const body = await req.json();
      return Response.json({
        model: body.model,
        choices: [{ message: { role: "assistant", content: "OK" } }],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 3,
          total_tokens: 14,
          prompt_tokens_details: { cached_tokens: 5 },
        },
      });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "minimax-m3", messages: [{ role: "user", content: "hi" }], stream: false }),
    });
    const statsResponse = await fetch(`${app.baseUrl}/admin/stats`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const stats = await statsResponse.json();

    expect(response.status).toBe(200);
    expect(stats.models.today[0].model).toBe("minimax-m3");
    expect(Number(stats.models.today[0].promptTokens)).toBe(11);
    expect(Number(stats.models.today[0].completionTokens)).toBe(3);
    expect(Number(stats.models.today[0].totalTokens)).toBe(14);
    expect(Number(stats.models.today[0].cachedTokens)).toBe(5);
  });

  test("Admin can refresh and test models", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/v1/models") {
        return Response.json({ object: "list", data: [{ id: "minimax-m3", object: "model" }] });
      }
      if (path === "/v1/chat/completions") {
        const body = await req.json();
        expect(body.model).toBe("minimax-m3");
        return Response.json({ choices: [{ message: { role: "assistant", content: "OK" } }] });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const refreshResponse = await fetch(`${app.baseUrl}/admin/models/refresh`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token" },
    });
    const refreshBody = await refreshResponse.json();
    const testResponse = await fetch(`${app.baseUrl}/admin/models/${encodeURIComponent("minimax-m3")}/test`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token" },
    });
    const testBody = await testResponse.json();
    const overviewResponse = await fetch(`${app.baseUrl}/admin/models`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const overview = await overviewResponse.json();

    expect(refreshResponse.status).toBe(200);
    expect(refreshBody.count).toBe(1);
    expect(refreshBody.models[0].id).toBe("minimax-m3");
    expect(testResponse.status).toBe(200);
    expect(testBody.ok).toBe(true);
    expect(testBody.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(overview.tests["minimax-m3"].ok).toBe(true);
    expect(overview.tests["minimax-m3"].message).toBe("OK");
  });

  test("Ollama /api/tags returns public compatibility model list from aliases", async () => {
    const app = createApp(config({ modelAliases: { "kilo-default": "actual-model" } }));

    const response = await fetch(`${app.baseUrl}/api/tags`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models[0].name).toBe("kilo-default");
    expect(body.models[0].model).toBe("kilo-default");
    expect(body.models[0].modified_at).toBe("2026-01-01T00:00:00Z");
    expect(body.models[0].size).toBe(0);
    expect(body.models[0].digest).toBe("proxy");
    expect(body.models[0].details.family).toBe("ollama-cloud-proxy");
    expect(body.models[0].details.families).toEqual(["ollama-cloud-proxy"]);
  });

  test("Ollama /api/tags includes models from cached OpenAI model list", async () => {
    const app = createApp(config());
    app.store.setModelsCache(JSON.stringify({
      object: "list",
      data: [{ id: "minimax-m3", object: "model" }],
    }));

    const response = await fetch(`${app.baseUrl}/api/tags`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models[0].name).toBe("minimax-m3");
    expect(body.models[0].model).toBe("minimax-m3");
    expect(body.models[0].details.format).toBe("proxy");
  });

  test("Ollama /api/tags omits aliases when native alias rewriting is disabled", async () => {
    const app = createApp(config({
      modelAliases: { "kilo-default": "actual-model" },
      ollamaNativeApplyAliases: false,
    }));
    app.store.setModelsCache(JSON.stringify({
      object: "list",
      data: [{ id: "actual-model", object: "model" }],
    }));

    const response = await fetch(`${app.baseUrl}/api/tags`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models.map((model: { name: string }) => model.name)).not.toContain("kilo-default");
    expect(body.models.map((model: { name: string }) => model.name)).toContain("actual-model");
  });

  test("Ollama /api/tags can require client token when public discovery is disabled", async () => {
    const app = createApp(config({
      modelAliases: { "kilo-default": "actual-model" },
      ollamaCompatDiscoveryPublic: false,
    }));

    const unauthorized = await fetch(`${app.baseUrl}/api/tags`);

    expect(unauthorized.status).toBe(401);
  });

  test("Ollama /api/tags with client token passes through native upstream response", async () => {
    const upstreamBaseUrl = createMockUpstream((req) => {
      expect(new URL(req.url).pathname).toBe("/api/tags");
      expect(req.headers.get("authorization")).toBe("Bearer good-key");
      return Response.json({
        models: [{ name: "minimax-m2.5", model: "minimax-m2.5", details: { family: "llama" } }],
      });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/api/tags`, {
      headers: { authorization: "Bearer client-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models[0].name).toBe("minimax-m2.5");
    expect(body.models[0].model).toBe("minimax-m2.5");
    expect(body.models[0].details.family).toBe("llama");
  });

  test("Ollama /api/version returns public Ollama-compatible version", async () => {
    const app = createApp(config());

    const response = await fetch(`${app.baseUrl}/api/version`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe("0.12.6");
    expect(body.proxy_version).toBe("1.1.8");
  });

  test("Ollama /api/ps returns public empty running-model list", async () => {
    const app = createApp(config());

    const response = await fetch(`${app.baseUrl}/api/ps`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toEqual([]);
  });

  test("Ollama inference endpoints still require client token", async () => {
    const app = createApp(config());

    const chatResponse = await fetch(`${app.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "minimax-m2.5", messages: [] }),
    });
    const generateResponse = await fetch(`${app.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "minimax-m2.5", prompt: "hi" }),
    });

    expect(chatResponse.status).toBe(401);
    expect(generateResponse.status).toBe(401);
  });

  test("Ollama /api/chat non-stream passes native body through unchanged", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      expect(new URL(req.url).pathname).toBe("/api/chat");
      const body = await req.json();
      expect(body.model).toBe("minimax-m2.5");
      expect(body.stream).toBe(false);
      expect(body.tools[0].function.name).toBe("read");
      return Response.json({
        model: body.model,
        created_at: "2026-06-02T00:00:00.000Z",
        message: { role: "assistant", content: "OK" },
        done: true,
      });
    });
    const app = createApp(config({
      upstreamBaseUrl,
      modelAliases: { "minimax-m2.5": "actual-model" },
      ollamaNativeApplyAliases: false,
    }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "minimax-m2.5",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "read", parameters: {} } }],
        stream: false,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message.content).toBe("OK");
    expect(body.done).toBe(true);
  });

  test("Ollama /api/chat applies model aliases by default", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      const body = await req.json();
      expect(body.model).toBe("actual-model");
      return Response.json({ model: body.model, message: { role: "assistant", content: "OK" }, done: true });
    });
    const app = createApp(config({ upstreamBaseUrl, modelAliases: { "kilo-default": "actual-model" } }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "kilo-default",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model).toBe("actual-model");
  });

  test("Ollama /api/generate leaves model unchanged when native aliases are disabled", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      const body = await req.json();
      expect(body.model).toBe("kilo-default");
      return Response.json({ model: body.model, response: "OK", done: true });
    });
    const app = createApp(config({
      upstreamBaseUrl,
      modelAliases: { "kilo-default": "actual-model" },
      ollamaNativeApplyAliases: false,
    }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "kilo-default",
        prompt: "hi",
        stream: false,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model).toBe("kilo-default");
  });

  test("Ollama /api/generate non-stream passes native body through unchanged", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      expect(new URL(req.url).pathname).toBe("/api/generate");
      const body = await req.json();
      expect(body.model).toBe("minimax-m2.5");
      expect(body.prompt).toBe("hi");
      expect(body.stream).toBe(false);
      return Response.json({
        model: body.model,
        created_at: "2026-06-02T00:00:00.000Z",
        response: "OK",
        done: true,
      });
    });
    const app = createApp(config({
      upstreamBaseUrl,
      modelAliases: { "minimax-m2.5": "actual-model" },
      ollamaNativeApplyAliases: false,
    }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "minimax-m2.5",
        prompt: "hi",
        stream: false,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.response).toBe("OK");
    expect(body.done).toBe(true);
  });

  test("Ollama /api/chat stream passes native chunks through unchanged", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      expect(new URL(req.url).pathname).toBe("/api/chat");
      const body = await req.json();
      expect(body.model).toBe("minimax-m2.5");
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              '{"model":"minimax-m2.5","message":{"role":"assistant","content":"OK"},"done":false}\n'
            )
          );
          controller.enqueue(
            encoder.encode(
              '{"model":"minimax-m2.5","message":{"role":"assistant","content":""},"done":true}\n'
            )
          );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "application/x-ndjson" },
      });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "minimax-m2.5",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(lines[0].message.content).toBe("OK");
    expect(lines[1].done).toBe(true);
    expect(lines[1].message.content).toBe("");
    expect(app.concurrency.stats().activeRequests).toBe(0);
    expect(app.store.listKeys(false)[0].activeRequests).toBe(0);
  });

  test("Ollama /api/chat preserves native tool call streams", async () => {
    const upstreamBaseUrl = createMockUpstream(async (req) => {
      expect(new URL(req.url).pathname).toBe("/api/chat");
      const body = await req.json();
      expect(body.tools[0].function.name).toBe("read");
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              '{"model":"minimax-m2.5","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"read","arguments":{"path":"BOOT.md"}}}]},"done":false}\n'
            )
          );
          controller.enqueue(
            encoder.encode(
              '{"model":"minimax-m2.5","message":{"role":"assistant","content":""},"done":true}\n'
            )
          );
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "application/x-ndjson" },
      });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    app.keyPool.create({ name: "good", apiKey: "good-key" });

    const response = await fetch(`${app.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        authorization: "Bearer client-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "minimax-m2.5",
        messages: [{ role: "user", content: "read BOOT.md" }],
        tools: [{ type: "function", function: { name: "read", parameters: {} } }],
      }),
    });
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

    expect(response.status).toBe(200);
    expect(lines[0].message.tool_calls[0].function.name).toBe("read");
    expect(lines[0].message.tool_calls[0].function.arguments.path).toBe("BOOT.md");
    expect(lines[0].done).toBe(false);
    expect(lines[1].done).toBe(true);
  });
});

describe("proxy stream helper", () => {
  test("idle timeout finalizes as upstream timeout", async () => {
    let finalized: { ok: boolean; aborted: boolean; errorType?: string } | null = null;
    let abortedUpstream = false;
    const stream = proxyReadableStream(
      new ReadableStream({ start() {} }),
      new AbortController().signal,
      10,
      100,
      () => {
        abortedUpstream = true;
      },
      (input) => {
        finalized = input;
      }
    );

    await new Response(stream).text().catch(() => "");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(abortedUpstream).toBe(true);
    expect(finalized as unknown).toEqual({ ok: false, aborted: false, errorType: "upstream_timeout" });
  });

  test("cancel finalizes as client abort", async () => {
    let finalized: { ok: boolean; aborted: boolean; errorType?: string } | null = null;
    let abortedUpstream = false;
    const stream = proxyReadableStream(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
        },
      }),
      new AbortController().signal,
      1000,
      1000,
      () => {
        abortedUpstream = true;
      },
      (input) => {
        finalized = input;
      }
    );

    const reader = stream!.getReader();
    await reader.read();
    await reader.cancel();

    expect(abortedUpstream).toBe(true);
    expect(finalized as unknown).toEqual({ ok: false, aborted: true, errorType: "client_aborted" });
  });
});
