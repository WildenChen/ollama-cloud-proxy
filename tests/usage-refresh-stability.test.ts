import { afterEach, describe, expect, test } from "bun:test";
import { AdminRoutes } from "../src/admin/adminRoutes";
import type { AppConfig } from "../src/config/env";
import { ConcurrencyManager } from "../src/concurrency/concurrencyManager";
import { EventStore } from "../src/events/eventStore";
import { KeyPoolManager } from "../src/keyPool/keyPoolManager";
import { ModelManager } from "../src/models/modelManager";
import { KeyCipher } from "../src/security/encryption";
import { DatabaseStore } from "../src/storage/database";
import { UsageService } from "../src/usage/usageService";

const servers: Array<{ stop: (force?: boolean) => void }> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()?.stop(true);
});

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    keyEncryptionSecret: "usage-refresh-test-secret",
    clientApiKeys: new Map(),
    upstreamBaseUrl: "http://127.0.0.1:1",
    ollamaWebBaseUrl: "http://127.0.0.1:1",
    ollamaWebSearchPath: "/api/web_search",
    ollamaWebFetchPath: "/api/web_fetch",
    ollamaWebTimeoutMs: 30_000,
    ollamaCloudUsageUrl: "http://127.0.0.1:1/settings",
    ollamaUsageCookie: null,
    ollamaUsageRefreshTtlSeconds: 600,
    usageApiEnabled: true,
    usageOfficialStaleSeconds: 900,
    usageRefreshDebounceSeconds: 0,
    usageRefreshJitterSeconds: 0,
    usageEstimateUnitsPerSuccess: 1,
    maxConcurrentRequests: 5,
    maxConcurrentRequestsPerKey: 1,
    requestQueueMax: 30,
    requestQueueTimeoutMs: 120_000,
    upstreamTotalTimeoutMs: 30_000,
    upstreamIdleTimeoutMs: 10_000,
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
    maxEvents: 100_000,
    logLevel: "error",
    dbPath: `/tmp/ollama-cloud-proxy-usage-refresh-${crypto.randomUUID()}.sqlite`,
    ...overrides,
  };
}

function setup(appConfig: AppConfig) {
  const store = new DatabaseStore(appConfig.dbPath);
  const events = new EventStore(store);
  const cipher = new KeyCipher(appConfig.keyEncryptionSecret);
  const keyPool = new KeyPoolManager(appConfig, store, events, cipher);
  const usage = new UsageService(appConfig, store, keyPool, events);
  keyPool.setUsageHooks({
    onSuccess: (keyId, tokenUsage) => usage.recordSuccess(keyId, tokenUsage),
    onCookieChanged: (keyId) => usage.notifyCookieChanged(keyId),
  });
  return { store, events, cipher, keyPool, usage };
}

function usageHtml(used = 12, weeklyUsed = 45) {
  return [
    '<span class="capitalize">free</span>',
    `<div data-usage-track aria-label="${used}% used"><span class="local-time" data-time="2026-08-01T00:00:00.000Z"></span></div>`,
    `<div data-usage-track aria-label="${weeklyUsed}% used"><span class="local-time" data-time="2026-08-04T00:00:00.000Z"></span></div>`,
  ].join("");
}

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("condition was not met before timeout");
    await Bun.sleep(10);
  }
}

describe("usage refresh stability", () => {
  test("successful key traffic refreshes at most once per 10-minute TTL and usage errors do not invalidate the key", async () => {
    let calls = 0;
    const settings = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(settings);

    const appConfig = config({ ollamaCloudUsageUrl: `http://127.0.0.1:${settings.port}/settings` });
    expect(appConfig.ollamaUsageRefreshTtlSeconds).toBe(600);
    const { store, keyPool, usage } = setup(appConfig);
    const created = keyPool.create({ name: "key-1", apiKey: "good-key", ollamaUsageCookie: "cookie-1" });

    keyPool.markSuccess(created.id, 20);
    await waitFor(() => store.getUsageAccountState(created.id)?.lastErrorCode === "upstream_error");

    const afterFailure = store.getKey(created.id, false)!;
    const usageState = store.getUsageAccountState(created.id)!;
    expect(calls).toBe(1);
    expect(afterFailure.status).toBe("available");
    expect(afterFailure.consecutiveFailures).toBe(0);
    expect(usageState.lastErrorCode).toBe("upstream_error");
    expect(usageState.officialCheckedAt).not.toBeNull();

    keyPool.markSuccess(created.id, 20);
    await Bun.sleep(50);
    expect(calls).toBe(1);

    store.upsertUsageAccountState({
      ...usageState,
      officialCheckedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    });
    const previousErrorAt = usageState.lastErrorAt;
    keyPool.markSuccess(created.id, 20);
    await waitFor(() => store.getUsageAccountState(created.id)?.lastErrorAt !== previousErrorAt);
    expect(calls).toBe(2);
    expect(store.getKey(created.id, false)!.status).toBe("available");
    expect(usage.cachedSnapshot(created.id)).toBeNull();
  });

  test("admin read paths use cached usage and never call the upstream settings endpoint", async () => {
    let calls = 0;
    const settings = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return new Response(usageHtml(), { headers: { "content-type": "text/html" } });
      },
    });
    servers.push(settings);

    const appConfig = config({ ollamaCloudUsageUrl: `http://127.0.0.1:${settings.port}/settings` });
    const { store, events, cipher, keyPool, usage } = setup(appConfig);
    keyPool.create({ name: "key-1", apiKey: "good-key", ollamaUsageCookie: "cookie-1" });
    const concurrency = new ConcurrencyManager(appConfig, events);
    const models = new ModelManager(appConfig, store);
    const admin = new AdminRoutes(appConfig, store, keyPool, concurrency, events, models, cipher, usage);

    const response = await admin.handle(new Request("http://localhost/admin/stats"), "/admin/stats");
    expect(response.status).toBe(200);
    expect(calls).toBe(0);
  });

  test("a failed refresh preserves the last successful snapshot and only updates attempt/error metadata", async () => {
    let fail = false;
    let calls = 0;
    const settings = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return fail
          ? new Response("not found", { status: 404 })
          : new Response(usageHtml(16, 33), { headers: { "content-type": "text/html" } });
      },
    });
    servers.push(settings);

    const appConfig = config({ ollamaCloudUsageUrl: `http://127.0.0.1:${settings.port}/settings` });
    const { store, keyPool, usage } = setup(appConfig);
    const created = keyPool.create({ name: "key-1", apiKey: "good-key", ollamaUsageCookie: "cookie-1" });
    store.patchKey(created.id, { status: "available", blockReason: "none" });

    const first = await usage.refreshKey(created.id, true);
    const successfulState = store.getUsageAccountState(created.id)!;
    expect(first?.session?.usedPercent).toBe(16);

    fail = true;
    const fallback = await usage.refreshKey(created.id, true);
    const failedState = store.getUsageAccountState(created.id)!;

    expect(calls).toBe(2);
    expect(fallback?.session?.usedPercent).toBe(16);
    expect(failedState.officialJson).toBe(successfulState.officialJson);
    expect(failedState.officialFetchedAt).toBe(successfulState.officialFetchedAt);
    expect(failedState.officialCheckedAt).not.toBe(successfulState.officialCheckedAt);
    expect(failedState.lastErrorCode).toBe("upstream_error");
    expect(store.getKey(created.id, false)!.status).toBe("available");
  });

  test("forced refreshes bypass TTL but concurrent requests share one in-flight call", async () => {
    let calls = 0;
    const settings = Bun.serve({
      port: 0,
      async fetch() {
        calls += 1;
        await Bun.sleep(80);
        return new Response(usageHtml(), { headers: { "content-type": "text/html" } });
      },
    });
    servers.push(settings);

    const appConfig = config({ ollamaCloudUsageUrl: `http://127.0.0.1:${settings.port}/settings` });
    const { keyPool, usage } = setup(appConfig);
    const created = keyPool.create({ name: "key-1", apiKey: "good-key", ollamaUsageCookie: "cookie-1" });

    await Promise.all([
      usage.refreshKey(created.id, true),
      usage.refreshKey(created.id, true),
      usage.refreshKey(created.id, true),
    ]);
    expect(calls).toBe(1);

    const summary = await usage.refreshMany([created.id, created.id]);
    expect(calls).toBe(2);
    expect(summary).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
  });
});
