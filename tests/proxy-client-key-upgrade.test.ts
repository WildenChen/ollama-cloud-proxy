import { afterEach, describe, expect, test } from "bun:test";
import { AdminRoutes } from "../src/admin/adminRoutes";
import type { AppConfig } from "../src/config/env";
import { ConcurrencyManager } from "../src/concurrency/concurrencyManager";
import { EventStore } from "../src/events/eventStore";
import { KeyPoolManager } from "../src/keyPool/keyPoolManager";
import { ModelManager } from "../src/models/modelManager";
import { ProxyHandler } from "../src/proxy/proxyHandler";
import { Router } from "../src/server/router";
import { setAdminPassword } from "../src/security/auth";
import { KeyCipher } from "../src/security/encryption";
import { DatabaseStore } from "../src/storage/database";
import { UsageService } from "../src/usage/usageService";
import { WebService } from "../src/web/webService";

const servers: Array<{ stop: (force?: boolean) => void }> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()?.stop(true);
});

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    keyEncryptionSecret: "test-secret",
    clientApiKeys: new Map(),
    upstreamBaseUrl: "http://127.0.0.1:1",
    ollamaWebBaseUrl: "http://127.0.0.1:1",
    ollamaWebSearchPath: "/api/web_search",
    ollamaWebFetchPath: "/api/web_fetch",
    ollamaWebTimeoutMs: 30000,
    ollamaCloudUsageUrl: "http://127.0.0.1:1/settings",
    ollamaUsageCookie: null,
    ollamaUsageRefreshTtlSeconds: 300,
    usageApiEnabled: true,
    usageOfficialStaleSeconds: 900,
    usageRefreshDebounceSeconds: 300,
    usageRefreshJitterSeconds: 0,
    usageEstimateUnitsPerSuccess: 1,
    maxConcurrentRequests: 5,
    maxConcurrentRequestsPerKey: 1,
    requestQueueMax: 30,
    requestQueueTimeoutMs: 120000,
    upstreamTotalTimeoutMs: 30000,
    upstreamIdleTimeoutMs: 10000,
    maxRequestBodySizeBytes: 20 * 1024 * 1024,
    keyRetryPolicy: "smart",
    keySelectionMode: "ordered",
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
    weeklyResetTime: "08:00",
    weeklyResetGraceMinutes: 5,
    weeklyReactivationJitterSeconds: 0,
    eventRetentionDays: 14,
    maxEvents: 100000,
    logLevel: "error",
    dbPath: `/tmp/ollama-cloud-proxy-key-upgrade-${crypto.randomUUID()}.sqlite`,
    ...overrides,
  };
}

function createApp(appConfig: AppConfig) {
  const store = new DatabaseStore(appConfig.dbPath);
  setAdminPassword(store, "admin-token");
  const events = new EventStore(store);
  const concurrency = new ConcurrencyManager(appConfig, events);
  const cipher = new KeyCipher(appConfig.keyEncryptionSecret);
  const keyPool = new KeyPoolManager(appConfig, store, events, cipher);
  const usageService = new UsageService(appConfig, store, keyPool, events);
  keyPool.setUsageHooks({
    onSelected: (keyId) => usageService.maybeScheduleStale(keyId),
    onSuccess: (keyId, usage) => usageService.recordSuccess(keyId, usage),
    onRateLimit: (keyId) => usageService.notifyRateLimit(keyId),
    onCookieChanged: (keyId) => usageService.notifyCookieChanged(keyId),
  });
  const models = new ModelManager(appConfig, store);
  const admin = new AdminRoutes(appConfig, store, keyPool, concurrency, events, models, cipher, usageService);
  const proxy = new ProxyHandler(appConfig, concurrency, keyPool, models, events, store);
  const web = new WebService(appConfig, concurrency, keyPool, events, store);
  const router = new Router(appConfig, admin, proxy, concurrency, keyPool, web, store, cipher, usageService);
  const server = Bun.serve({ port: 0, fetch: (req) => router.handle(req) });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}`, store, keyPool, models };
}

function createMockUpstream(handler: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

const adminHeaders = {
  authorization: "Bearer admin-token",
  "content-type": "application/json",
};

describe("Proxy access key upgrade compatibility", () => {
  test("environment-only keys stay valid and their secrets never appear in Admin summaries", async () => {
    const upstreamBaseUrl = createMockUpstream(() =>
      Response.json({ choices: [{ message: { role: "assistant", content: "OK" } }] }),
    );
    const app = createApp(config({
      upstreamBaseUrl,
      clientApiKeys: new Map([["legacy-env-secret", "legacy-openclaw"]]),
    }));
    app.keyPool.create({ name: "upstream", apiKey: "upstream-key" });

    const summaryResponse = await fetch(`${app.baseUrl}/admin/client-key-summary`, {
      headers: { authorization: "Bearer admin-token" },
    });
    const summary = await summaryResponse.json();
    const stats = await (await fetch(`${app.baseUrl}/admin/stats`)).json();

    expect(summaryResponse.status).toBe(200);
    expect(summary).toMatchObject({
      protectionEnabled: true,
      anonymousMode: false,
      effectiveTotal: 1,
      databaseManagedTotal: 0,
      environmentManagedTotal: 1,
    });
    expect(summary.items[0]).toMatchObject({
      name: "legacy-openclaw",
      source: "environment",
      editable: false,
      tokenPreview: null,
    });
    expect(stats.clientAccess.environmentManagedTotal).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("legacy-env-secret");
    expect(JSON.stringify(stats)).not.toContain("legacy-env-secret");

    const completion = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer legacy-env-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(completion.status).toBe(200);
  });

  test("an existing anonymous deployment remains operational after upgrade", async () => {
    const upstreamBaseUrl = createMockUpstream(() =>
      Response.json({ choices: [{ message: { role: "assistant", content: "OK" } }] }),
    );
    const app = createApp(config({ upstreamBaseUrl, clientApiKeys: new Map() }));
    app.keyPool.create({ name: "upstream", apiKey: "upstream-key" });

    const stats = await (await fetch(`${app.baseUrl}/admin/stats`)).json();
    expect(stats.clientAccess).toMatchObject({
      protectionEnabled: false,
      anonymousMode: true,
      effectiveTotal: 0,
    });

    const completion = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(completion.status).toBe(200);
  });

  test("creation returns a one-time token, lists only a preview, and disables later reveal", async () => {
    const upstreamBaseUrl = createMockUpstream(() => Response.json({ data: [] }));
    const app = createApp(config({ upstreamBaseUrl, ollamaCompatDiscoveryPublic: false }));
    app.keyPool.create({ name: "upstream", apiKey: "upstream-key" });

    const createResponse = await fetch(`${app.baseUrl}/admin/client-keys`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "openclaw", notes: "main client" }),
    });
    const created = await createResponse.json();
    const token = created.token;

    expect(createResponse.status).toBe(201);
    expect(token).toMatch(/^ocp_[A-Za-z0-9_-]{43}$/);
    expect(created.clientKey.encryptedToken).toBeUndefined();
    expect(created.clientKey.token).toBeUndefined();

    const summary = await (await fetch(`${app.baseUrl}/admin/client-key-summary`, {
      headers: { authorization: "Bearer admin-token" },
    })).json();
    expect(summary.items[0].tokenPreview).toBe(created.clientKey.tokenPreview);
    expect(summary).toMatchObject({
      protectionEnabled: false,
      anonymousMode: true,
      effectiveTotal: 1,
    });
    expect(JSON.stringify(summary)).not.toContain(token);

    const transitionAnonymous = await fetch(`${app.baseUrl}/v1/models`);
    expect(transitionAnonymous.status).toBe(200);

    const enableProtection = await fetch(`${app.baseUrl}/admin/client-access`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableProtection.status).toBe(200);
    expect(await enableProtection.json()).toMatchObject({
      protectionEnabled: true,
      anonymousMode: false,
      effectiveTotal: 1,
    });

    const missingTokenDenied = await fetch(`${app.baseUrl}/v1/models`);
    expect(missingTokenDenied.status).toBe(401);

    const revealResponse = await fetch(`${app.baseUrl}/admin/client-keys/${created.clientKey.id}/reveal`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token" },
    });
    expect(revealResponse.status).toBe(410);
    expect((await revealResponse.json()).error.type).toBe("client_key_reveal_disabled");

    const modelsResponse = await fetch(`${app.baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(modelsResponse.status).toBe(200);
  });

  test("connection testing separates authentication, upstream availability, and model readiness", async () => {
    const upstreamBaseUrl = createMockUpstream((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/v1/models") {
        return Response.json({ object: "list", data: [{ id: "test-model", object: "model" }] });
      }
      return Response.json({ choices: [{ message: { role: "assistant", content: "OK" } }] });
    });
    const app = createApp(config({ upstreamBaseUrl }));
    app.keyPool.create({ name: "upstream", apiKey: "upstream-key" });

    const created = await (await fetch(`${app.baseUrl}/admin/client-keys`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "tester" }),
    })).json();

    const modelRefresh = await fetch(`${app.baseUrl}/admin/models/refresh`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token" },
    });
    expect(modelRefresh.status).toBe(200);

    const validTest = await fetch(`${app.baseUrl}/admin/client-key-test`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ token: created.token }),
    });
    const valid = await validTest.json();
    expect(validTest.status).toBe(200);
    expect(valid.authentication.ok).toBe(true);
    expect(valid.upstream.ok).toBe(true);
    expect(valid.models.ok).toBe(true);
    expect(valid.models.count).toBe(1);
    expect(JSON.stringify(valid)).not.toContain(created.token);

    const invalidTest = await fetch(`${app.baseUrl}/admin/client-key-test`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ token: "wrong-token" }),
    });
    const invalid = await invalidTest.json();
    expect(invalidTest.status).toBe(200);
    expect(invalid.authentication.ok).toBe(false);
    expect(invalid.upstream.ok).toBe(true);
    expect(invalid.models.ok).toBe(true);
  });

  test("cannot enable protection before at least one usable key exists", async () => {
    const app = createApp(config());

    const response = await fetch(`${app.baseUrl}/admin/client-access`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.type).toBe("client_key_required");
    const stats = await (await fetch(`${app.baseUrl}/admin/stats`)).json();
    expect(stats.clientAccess.anonymousMode).toBe(true);
  });
});
