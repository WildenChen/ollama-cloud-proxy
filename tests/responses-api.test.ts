import { afterEach, describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/env";
import { ConcurrencyManager } from "../src/concurrency/concurrencyManager";
import { EventStore } from "../src/events/eventStore";
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
    keyEncryptionSecret: "responses-api-test-secret",
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
    modelAliases: { "openminis-m3": "minimax-m3" },
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
    dbPath: `/tmp/ollama-cloud-proxy-responses-${crypto.randomUUID()}.sqlite`,
    ...overrides,
  };
}

function createProxy(
  upstreamHandler: (req: Request) => Response | Promise<Response>,
  overrides: Partial<AppConfig> = {}
) {
  const upstream = Bun.serve({ port: 0, fetch: upstreamHandler });
  servers.push(upstream);
  const appConfig = config({ upstreamBaseUrl: `http://127.0.0.1:${upstream.port}`, ...overrides });
  const store = new DatabaseStore(appConfig.dbPath);
  const events = new EventStore(store);
  const concurrency = new ConcurrencyManager(appConfig, events);
  const keyPool = new KeyPoolManager(appConfig, store, events, new KeyCipher(appConfig.keyEncryptionSecret));
  const models = new ModelManager(appConfig, store);
  const proxy = new ProxyHandler(appConfig, concurrency, keyPool, models, events, store);
  const key = keyPool.create({ name: "responses-key", apiKey: "upstream-responses-secret" });
  store.patchKey(key.id, { status: "available", blockReason: "none", consecutiveFailures: 0 });
  return { proxy, store, events, keyId: key.id };
}

async function callResponses(proxy: ProxyHandler, payload: Record<string, unknown>) {
  return proxy.handle(
    new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    "/v1/responses",
    { clientName: "open-minis", authenticated: true }
  );
}

describe("OpenAI Responses API compatibility", () => {
  test("forwards a non-streaming response, maps aliases, preserves tools, and records usage", async () => {
    let receivedPath = "";
    let receivedAuthorization = "";
    let receivedBody: Record<string, unknown> = {};
    const { proxy, store, keyId } = createProxy(async (req) => {
      receivedPath = new URL(req.url).pathname;
      receivedAuthorization = req.headers.get("authorization") || "";
      receivedBody = await req.json();
      return Response.json({
        id: "resp_123",
        object: "response",
        model: "minimax-m3",
        status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] }],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      });
    });

    const tools = [
      {
        type: "function",
        name: "lookup_weather",
        description: "Look up weather",
        parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    ];
    const response = await callResponses(proxy, {
      model: "openminis-m3",
      instructions: "Answer precisely.",
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
      tools,
      temperature: 0.2,
      max_output_tokens: 128,
    });
    const body = await response.json();
    const stored = store.getKey(keyId, false)!;

    expect(response.status).toBe(200);
    expect(body.object).toBe("response");
    expect(body.id).toBe("resp_123");
    expect(receivedPath).toBe("/v1/responses");
    expect(receivedAuthorization).toBe("Bearer upstream-responses-secret");
    expect(receivedBody.model).toBe("minimax-m3");
    expect(receivedBody.instructions).toBe("Answer precisely.");
    expect(receivedBody.tools).toEqual(tools);
    expect(receivedBody.temperature).toBe(0.2);
    expect(receivedBody.max_output_tokens).toBe(128);
    expect(stored.totalSuccesses).toBe(1);
    expect(stored.totalFailures).toBe(0);
  });

  test("passes through a streaming Responses API event stream and marks success after completion", async () => {
    const streamBody = [
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_stream"}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_stream","status":"completed"}}\n\n',
    ].join("");
    const { proxy, store, keyId } = createProxy(async (req) => {
      const payload = (await req.json()) as Record<string, unknown>;
      expect(payload.stream).toBe(true);
      return new Response(streamBody, { headers: { "content-type": "text/event-stream" } });
    });

    const response = await callResponses(proxy, {
      model: "minimax-m3",
      input: "Say hi",
      stream: true,
    });
    const text = await response.text();
    await Bun.sleep(5);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("response.output_text.delta");
    expect(text).toContain("response.completed");
    expect(store.getKey(keyId, false)!.totalSuccesses).toBe(1);
  });

  test("rejects stateful Responses fields before selecting or calling an upstream key", async () => {
    let upstreamCalls = 0;
    const { proxy, store, keyId } = createProxy(() => {
      upstreamCalls += 1;
      return Response.json({ object: "response" });
    });

    for (const payload of [
      { model: "minimax-m3", input: "continue", previous_response_id: "resp_previous" },
      { model: "minimax-m3", input: "continue", conversation: "conv_123" },
    ]) {
      const response = await callResponses(proxy, payload);
      const body = await response.json();
      const field = "previous_response_id" in payload ? "previous_response_id" : "conversation";

      expect(response.status).toBe(400);
      expect(body.error.type).toBe("unsupported_responses_state");
      expect(body.error.message).toContain(field);
      expect(body.error.details).toMatchObject({ field, mode: "non-stateful" });
    }

    expect(upstreamCalls).toBe(0);
    expect(store.getKey(keyId, false)!.consecutiveFailures).toBe(0);
  });

  test("preserves safe upstream 400 details on the Responses path without invalidating the key", async () => {
    const { proxy, store, keyId } = createProxy(() =>
      Response.json(
        {
          error: {
            message: "input[1].content is invalid",
            type: "invalid_request_error",
            code: "invalid_input_content",
          },
          request_id: "req_responses_400",
        },
        { status: 400 }
      )
    );

    const response = await callResponses(proxy, { model: "minimax-m3", input: "bad request" });
    const body = await response.json();
    const stored = store.getKey(keyId, false)!;

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("input[1].content is invalid");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("invalid_input_content");
    expect(body.error.upstream_status).toBe(400);
    expect(body.error.request_id).toBe("req_responses_400");
    expect(stored.status).toBe("available");
    expect(stored.consecutiveFailures).toBe(0);
  });

  test("still marks a key invalid when the actual Responses upstream returns 401", async () => {
    const { proxy, store, keyId } = createProxy(() =>
      Response.json({ error: { message: "invalid api key" } }, { status: 401 })
    );

    const response = await callResponses(proxy, { model: "minimax-m3", input: "hello" });
    const stored = store.getKey(keyId, false)!;

    expect(response.status).toBe(503);
    expect(stored.status).toBe("invalid");
    expect(stored.blockReason).toBe("auth_failed");
    expect(stored.consecutiveFailures).toBeGreaterThan(0);
  });
});
