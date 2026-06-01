import { afterEach, describe, expect, test } from "bun:test";
import { AdminRoutes } from "../src/admin/adminRoutes";
import type { AppConfig } from "../src/config/env";
import { ConcurrencyManager } from "../src/concurrency/concurrencyManager";
import { EventStore } from "../src/events/eventStore";
import { KeyPoolManager } from "../src/keyPool/keyPoolManager";
import { ModelManager } from "../src/models/modelManager";
import { ProxyHandler } from "../src/proxy/proxyHandler";
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
    maxUpstreamRetriesPerRequest: 1,
    modelsCacheTtlSeconds: 3600,
    modelAliases: {},
    usageTimezone: "Asia/Taipei",
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
  return { baseUrl: `http://127.0.0.1:${server.port}`, store, keyPool };
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

    expect(response.status).toBe(401);
    expect(updated.status).toBe("invalid");
    expect(updated.activeRequests).toBe(0);
    expect(bodyText).not.toContain("bad-key-secret");
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
});
