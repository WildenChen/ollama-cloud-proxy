import { afterEach, describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/env";
import { ConcurrencyManager } from "../src/concurrency/concurrencyManager";
import { openAiError } from "../src/errors/responses";
import { decodeUpstreamClientError, normalizeUpstreamClientError } from "../src/errors/upstreamError";
import { EventStore } from "../src/events/eventStore";
import { classifyUpstreamResponse } from "../src/keyPool/errorClassifier";
import { KeyPoolManager } from "../src/keyPool/keyPoolManager";
import { ModelManager } from "../src/models/modelManager";
import { ProxyHandler } from "../src/proxy/proxyHandler";
import { KeyCipher } from "../src/security/encryption";
import { DatabaseStore } from "../src/storage/database";

const servers: Array<{ stop: (force?: boolean) => void }> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()?.stop(true);
});

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    keyEncryptionSecret: "upstream-error-test-secret",
    clientApiKeys: new Map([["client-token", "open-minis"]]),
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
    usageRefreshDebounceSeconds: 300,
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
    dbPath: `/tmp/ollama-cloud-proxy-upstream-error-${crypto.randomUUID()}.sqlite`,
    ...overrides,
  };
}

function createProxy(upstreamHandler: (req: Request) => Response | Promise<Response>) {
  const upstream = Bun.serve({ port: 0, fetch: upstreamHandler });
  servers.push(upstream);
  const appConfig = config({ upstreamBaseUrl: `http://127.0.0.1:${upstream.port}` });
  const store = new DatabaseStore(appConfig.dbPath);
  const events = new EventStore(store);
  const concurrency = new ConcurrencyManager(appConfig, events);
  const keyPool = new KeyPoolManager(appConfig, store, events, new KeyCipher(appConfig.keyEncryptionSecret));
  const models = new ModelManager(appConfig, store);
  const proxy = new ProxyHandler(appConfig, concurrency, keyPool, models, events, store);
  const key = keyPool.create({ name: "working-key", apiKey: "upstream-secret-key" });
  store.patchKey(key.id, { status: "available", blockReason: "none", consecutiveFailures: 0 });
  return { proxy, store, keyId: key.id };
}

async function callChat(proxy: ProxyHandler) {
  return proxy.handle(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "minimax-m3", messages: [{ role: "user", content: "hello" }] }),
    }),
    "/v1/chat/completions",
    { clientName: "open-minis", authenticated: true }
  );
}

describe("upstream client error preservation", () => {
  test("returns safe OpenAI-compatible fields from an upstream 400 JSON error without invalidating the key", async () => {
    const { proxy, store, keyId } = createProxy(() =>
      Response.json(
        {
          error: {
            message: "messages[3].tool_calls is invalid; Bearer bearer-secret; apiKey=inline-secret",
            type: "invalid_request_error",
            code: "invalid_tool_calls",
            details: { cookie: "cookie-secret", field: "messages[3].tool_calls", safe: "keep" },
          },
          request_id: "req_open_minis_123",
        },
        { status: 400 }
      )
    );

    const response = await callChat(proxy);
    const body = await response.json();
    const stored = store.getKey(keyId, false)!;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("messages[3].tool_calls is invalid");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("invalid_tool_calls");
    expect(body.error.upstream_status).toBe(400);
    expect(body.error.request_id).toBe("req_open_minis_123");
    expect(body.error.details).toMatchObject({ cookie: "[REDACTED]", field: "messages[3].tool_calls", safe: "keep" });
    expect(serialized).not.toContain("bearer-secret");
    expect(serialized).not.toContain("inline-secret");
    expect(serialized).not.toContain("cookie-secret");
    expect(serialized).not.toContain("upstream-secret-key");
    expect(stored.status).toBe("available");
    expect(stored.consecutiveFailures).toBe(0);
  });

  test("returns a redacted bounded message for an upstream 400 text response", async () => {
    const { proxy } = createProxy(() =>
      new Response("messages[2].content is invalid; Cookie=session-secret; /home/wilden/private/file.txt", {
        status: 400,
        headers: { "content-type": "text/plain" },
      })
    );

    const response = await callChat(proxy);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(400);
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("messages[2].content is invalid");
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("/home/wilden/");
  });

  test("preserves sanitized validation details from an upstream 422 response", async () => {
    const { proxy } = createProxy(() =>
      Response.json(
        {
          code: "validation_error",
          detail: [
            {
              loc: ["body", "messages", 3, "tool_calls"],
              msg: "Field required",
              type: "missing",
            },
          ],
        },
        { status: 422 }
      )
    );

    const response = await callChat(proxy);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("validation_error");
    expect(body.error.upstream_status).toBe(422);
    expect(body.error.details[0]).toMatchObject({
      loc: ["body", "messages", 3, "tool_calls"],
      msg: "Field required",
      type: "missing",
    });
  });

  test("redacts nested credentials and free-text secrets in the normalizer", () => {
    const normalized = normalizeUpstreamClientError(
      JSON.stringify({
        message: "Authorization: Bearer abcdef123456; token=plain-secret",
        apiKey: "object-secret",
        details: { session: "session-secret", safe: "visible" },
      }),
      400
    );
    const serialized = JSON.stringify(normalized);

    expect(serialized).not.toContain("abcdef123456");
    expect(serialized).not.toContain("plain-secret");
    expect(serialized).not.toContain("object-secret");
    expect(serialized).not.toContain("session-secret");
    expect(serialized).toContain("visible");
  });

  test("keeps 429 and provider 5xx classification behavior unchanged", async () => {
    const appConfig = config();
    const rateLimit = await classifyUpstreamResponse(429, "rate limit", 0, appConfig);
    const provider = await classifyUpstreamResponse(502, "Bearer internal-secret", 0, appConfig);

    expect(rateLimit.category).toBe("key");
    expect(rateLimit.blockReason).toBe("rate_limited");
    expect(provider.category).toBe("provider");
    expect(provider.message).toBe("Temporary upstream provider error");
    expect(decodeUpstreamClientError(rateLimit.message)).toBeNull();
    expect(decodeUpstreamClientError(provider.message)).toBeNull();

    const providerResponse = await openAiError(502, provider.blockReason, provider.message).json();
    expect(providerResponse.error).toEqual({ message: "Temporary upstream provider error", type: "provider_error" });
    expect(JSON.stringify(providerResponse)).not.toContain("internal-secret");
  });
});
