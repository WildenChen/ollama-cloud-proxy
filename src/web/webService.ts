import type { AppConfig } from "../config/env";
import type { ConcurrencyManager, ConcurrencySlot } from "../concurrency/concurrencyManager";
import { QueueError } from "../concurrency/concurrencyManager";
import { openAiError } from "../errors/responses";
import type { EventStore } from "../events/eventStore";
import { classifyNetworkError, classifyUpstreamResponse } from "../keyPool/errorClassifier";
import type { KeyPoolManager } from "../keyPool/keyPoolManager";
import type { DatabaseStore } from "../storage/database";
import type { ClientIdentity, ErrorClassification, KeyRecord } from "../types/domain";
import { readBodyWithLimit } from "../proxy/body";

type WebSearchInput = {
  query: string;
  maxResults: number;
};

type WebFetchInput = {
  url: string;
};

type UpstreamKind = "search" | "fetch";

type WebAttemptSuccess = {
  ok: true;
  data: unknown;
  durationMs: number;
};

type WebAttemptFailure = {
  ok: false;
  response: Response;
  retry: boolean;
  classification?: ErrorClassification;
  errorType: string;
};

type WebAttemptResult = WebAttemptSuccess | WebAttemptFailure;

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function displayUrl(value: string): string {
  return value.replace(/^https?:\/\/(www\.)?/i, "").split("?")[0];
}

export class WebService {
  constructor(
    private readonly config: AppConfig,
    private readonly concurrency: ConcurrencyManager,
    private readonly keyPool: KeyPoolManager,
    private readonly events: EventStore,
    private readonly store: DatabaseStore
  ) {}

  async handleSearch(req: Request, client: ClientIdentity): Promise<Response> {
    const parsed = await this.parseJsonBody(req);
    if ("response" in parsed) return parsed.response;

    const rawQuery = this.stringField(parsed.body, "query") ?? this.stringField(parsed.body, "q");
    if (rawQuery === null) return openAiError(400, "invalid_request", "query or q is required");
    const query = this.sanitizeQuery(rawQuery);
    if ("response" in query) return query.response;

    const maxResults = this.parseMaxResults(parsed.body.max_results);
    if ("response" in maxResults) return maxResults.response;

    return this.searchWeb({ query: query.value, maxResults: maxResults.value }, client, req.signal);
  }

  listSearchProviders(): Response {
    const created = Math.floor(Date.now() / 1000);
    return Response.json({
      object: "list",
      data: [
        {
          id: "ollama-search",
          object: "search_provider",
          created,
          name: "Ollama Search",
          search_types: ["web"],
        },
      ],
    });
  }

  async handleOmniSearch(req: Request, client: ClientIdentity): Promise<Response> {
    const parsed = await this.parseJsonBody(req);
    if ("response" in parsed) return parsed.response;

    const provider = this.stringField(parsed.body, "provider") || "ollama-search";
    if (provider !== "ollama-search") {
      return openAiError(400, "invalid_request", `Unsupported search provider: ${provider}`);
    }
    const searchType = this.stringField(parsed.body, "search_type") || "web";
    if (searchType !== "web") {
      return openAiError(400, "invalid_request", `Ollama Search does not support search_type: ${searchType}`);
    }
    const rawQuery = this.stringField(parsed.body, "query");
    if (rawQuery === null) return openAiError(400, "invalid_request", "query is required");
    const query = this.sanitizeQuery(rawQuery);
    if ("response" in query) return query.response;
    const maxResults = this.parseMaxResults(parsed.body.max_results);
    if ("response" in maxResults) return maxResults.response;

    const response = await this.searchWeb({ query: query.value, maxResults: maxResults.value }, client, req.signal);
    if (!response.ok) return response;
    const legacy = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }>; duration_ms?: number };
    const now = new Date().toISOString();
    const results = Array.isArray(legacy.results)
      ? legacy.results.map((item, index) => {
          const url = typeof item.url === "string" ? item.url : "";
          const snippet = typeof item.content === "string" ? item.content : "";
          return {
            title: typeof item.title === "string" ? item.title : "",
            url,
            display_url: url ? displayUrl(url) : "",
            snippet,
            position: index + 1,
            score: null,
            published_at: null,
            favicon_url: null,
            content: snippet ? { format: "text", text: snippet, length: snippet.length } : null,
            metadata: null,
            citation: { provider: "ollama-search", retrieved_at: now, rank: index + 1 },
            provider_raw: null,
          };
        })
      : [];
    return Response.json({
      provider: "ollama-search",
      query: query.value,
      results,
      answer: null,
      usage: { queries_used: 1, search_cost_usd: 0 },
      metrics: {
        response_time_ms: Number(legacy.duration_ms || 0),
        upstream_latency_ms: Number(legacy.duration_ms || 0),
        total_results_available: results.length,
      },
      errors: [],
    });
  }

  async handleFetch(req: Request, client: ClientIdentity): Promise<Response> {
    const parsed = await this.parseJsonBody(req);
    if ("response" in parsed) return parsed.response;

    const url = this.stringField(parsed.body, "url");
    if (url === null) return openAiError(400, "invalid_request", "url is required");
    if (!url.trim()) return openAiError(400, "invalid_request", "url cannot be empty");
    const normalizedUrl = this.validateUrl(url.trim());
    if ("response" in normalizedUrl) return normalizedUrl.response;

    return this.fetchWeb({ url: normalizedUrl.value }, client, req.signal);
  }

  async searchWeb(input: WebSearchInput, client: ClientIdentity, signal?: AbortSignal): Promise<Response> {
    return this.performWebRequest({
      kind: "search",
      client,
      signal,
      upstreamPath: this.config.ollamaWebSearchPath,
      body: { query: input.query, max_results: input.maxResults },
      eventDetails: {
        queryPreview: input.query.slice(0, 80),
        maxResults: input.maxResults,
      },
      normalize: (data, durationMs) => {
        const payload = data as { results?: unknown };
        const results = Array.isArray(payload.results)
          ? payload.results.map((item) => {
              const result = item as Record<string, unknown>;
              return {
                title: typeof result.title === "string" ? result.title : "",
                url: typeof result.url === "string" ? result.url : "",
                content: typeof result.content === "string" ? result.content : "",
              };
            })
          : [];
        return Response.json({ results, backend: "ollama-web-search", duration_ms: durationMs });
      },
    });
  }

  async fetchWeb(input: WebFetchInput, client: ClientIdentity, signal?: AbortSignal): Promise<Response> {
    return this.performWebRequest({
      kind: "fetch",
      client,
      signal,
      upstreamPath: this.config.ollamaWebFetchPath,
      body: { url: input.url },
      eventDetails: { urlHost: new URL(input.url).host },
      normalize: (data, durationMs) => {
        const payload = data as Record<string, unknown>;
        const links = Array.isArray(payload.links) ? payload.links.filter((link): link is string => typeof link === "string") : [];
        return Response.json({
          title: typeof payload.title === "string" ? payload.title : "",
          content: typeof payload.content === "string" ? payload.content : "",
          links,
          backend: "ollama-web-fetch",
          duration_ms: durationMs,
        });
      },
    });
  }

  private async performWebRequest(options: {
    kind: UpstreamKind;
    client: ClientIdentity;
    signal?: AbortSignal;
    upstreamPath: string;
    body: Record<string, unknown>;
    eventDetails: Record<string, unknown>;
    normalize: (data: unknown, durationMs: number) => Response;
  }): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let slot: ConcurrencySlot;

    try {
      slot = await this.concurrency.acquire(requestId, options.client.clientName, options.signal);
    } catch (error) {
      if (error instanceof QueueError) return this.queueError(error);
      throw error;
    }

    this.events.emit({
      level: "info",
      type: "request_started",
      message: `web_${options.kind} request started`,
      clientName: options.client.clientName,
      requestId,
      details: options.eventDetails,
    });

    const selectableAtStart = this.keyPool.selectableCount();
    const attempts = this.maxKeyAttempts(selectableAtStart);
    const triedKeyIds = new Set<string>();
    let networkAttempts = 0;
    let lastErrorType = "no_available_key";

    for (let attempt = 0; attempt < attempts; attempt++) {
      const selectedKey = this.keyPool.selectKey(requestId, options.client.clientName, undefined, undefined, triedKeyIds);
      if (!selectedKey) break;
      triedKeyIds.add(selectedKey.id);

      const result = await this.tryWebUpstream(selectedKey, options, requestId, startedAt, attempt, attempts);
      if (result.ok) {
        slot.release();
        this.store.recordClientRequest(options.client.clientName, true);
        this.events.emit({
          level: "info",
          type: "request_finished",
          message: `web_${options.kind} request finished`,
          clientName: options.client.clientName,
          requestId,
          keyId: selectedKey.id,
          keyName: selectedKey.name,
          durationMs: result.durationMs,
        });
        return options.normalize(result.data, result.durationMs);
      }

      lastErrorType = result.errorType;
      if (result.classification?.category === "network" || result.classification?.category === "provider") {
        networkAttempts += 1;
      }
      const shouldTryNextKey =
        result.retry &&
        (!result.classification || result.classification.category === "key" || networkAttempts < this.config.maxNetworkRetryAttempts);

      this.events.emit({
        level: shouldTryNextKey ? "warn" : "error",
        type: "key_attempt",
        message: `web_${options.kind} key attempt ${attempt + 1} ${shouldTryNextKey ? "will try next key" : "finished"}`,
        clientName: options.client.clientName,
        requestId,
        keyId: selectedKey.id,
        keyName: selectedKey.name,
        details: {
          attemptIndex: attempt,
          maxAttempts: attempts,
          errorType: result.errorType,
          shouldTryNextKey,
        },
      });

      if (shouldTryNextKey) continue;
      slot.release();
      this.store.recordClientRequest(options.client.clientName, false, result.errorType);
      return result.response;
    }

    slot.release();
    this.store.recordClientRequest(options.client.clientName, false, lastErrorType);
    this.events.emit({
      level: "error",
      type: "no_available_key",
      message: `web_${options.kind} has no available key`,
      clientName: options.client.clientName,
      requestId,
      details: { attemptedKeysCount: triedKeyIds.size, ...this.keyPool.summary() },
    });
    return openAiError(503, "no_available_key", "No available Ollama Cloud key", {
      attemptedKeysCount: triedKeyIds.size,
      ...this.keyPool.summary(),
    });
  }

  private async tryWebUpstream(
    key: KeyRecord,
    options: {
      kind: UpstreamKind;
      client: ClientIdentity;
      signal?: AbortSignal;
      upstreamPath: string;
      body: Record<string, unknown>;
    },
    requestId: string,
    startedAt: number,
    attempt: number,
    maxAttempts: number
  ): Promise<WebAttemptResult> {
    const controller = new AbortController();
    const abortOnClient = () => controller.abort(new Error("client_aborted"));
    options.signal?.addEventListener("abort", abortOnClient, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("upstream_total_timeout")), this.config.ollamaWebTimeoutMs);

    try {
      const upstream = await fetch(this.upstreamUrl(options.upstreamPath), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.keyPool.decryptKey(key)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortOnClient);

      if (!upstream.ok) {
        const errorBody = await upstream.text();
        const classification = await classifyUpstreamResponse(
          upstream.status,
          errorBody,
          key.consecutiveFailures,
          this.store.getUsageSettings(this.config)
        );
        if (classification.category !== "request") {
          this.keyPool.markFailure(key.id, classification, Date.now() - startedAt);
        }
        this.keyPool.releaseKey(key.id);
        const shouldRetry = this.shouldTryAnotherKey(classification, attempt, maxAttempts);
        return {
          ok: false,
          retry: shouldRetry,
          response: openAiError(upstream.status, classification.blockReason, classification.message, {
            upstreamStatus: upstream.status,
            keyId: key.id,
            keyName: key.name,
          }),
          classification,
          errorType: classification.blockReason,
        };
      }

      const data = await upstream.json();
      const durationMs = Date.now() - startedAt;
      this.keyPool.releaseKey(key.id);
      this.keyPool.markSuccess(key.id, durationMs);
      return { ok: true, data, durationMs };
    } catch (error) {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortOnClient);
      const message = String((error as Error).message || "");
      const timeout = message.includes("timeout") || message.includes("aborted");
      const classification = classifyNetworkError(timeout);
      this.keyPool.markFailure(key.id, classification, Date.now() - startedAt);
      this.keyPool.releaseKey(key.id);
      return {
        ok: false,
        retry: this.shouldTryAnotherKey(classification, attempt, maxAttempts),
        response: openAiError(503, classification.blockReason, classification.message),
        classification,
        errorType: classification.blockReason,
      };
    }
  }

  private async parseJsonBody(req: Request): Promise<{ body: Record<string, unknown> } | { response: Response }> {
    let rawBody: string;
    try {
      rawBody = await readBodyWithLimit(req, this.config.maxRequestBodySizeBytes);
    } catch (error) {
      const type = (error as Error).message === "request_body_too_large" ? "request_body_too_large" : "invalid_request";
      return { response: openAiError(type === "request_body_too_large" ? 413 : 400, type, (error as Error).message) };
    }

    try {
      const parsed = JSON.parse(rawBody || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { response: openAiError(400, "invalid_request", "JSON body must be an object") };
      }
      return { body: parsed as Record<string, unknown> };
    } catch {
      return { response: openAiError(400, "invalid_request", "Invalid JSON body") };
    }
  }

  private stringField(body: Record<string, unknown>, field: string): string | null {
    return typeof body[field] === "string" ? body[field] : null;
  }

  private parseMaxResults(value: unknown): { value: number } | { response: Response } {
    if (value === undefined || value === null) return { value: 5 };
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return { response: openAiError(400, "invalid_request", "max_results must be a positive integer") };
    }
    if (value > 10) {
      return { response: openAiError(400, "invalid_request", "max_results must be less than or equal to 10") };
    }
    return { value };
  }

  private sanitizeQuery(value: string): { value: string } | { response: Response } {
    if (CONTROL_CHAR_RE.test(value)) {
      return { response: openAiError(400, "invalid_request", "query contains invalid control characters") };
    }
    const clean = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!clean) return { response: openAiError(400, "invalid_request", "query cannot be empty") };
    return { value: clean };
  }

  private validateUrl(value: string): { value: string } | { response: Response } {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { response: openAiError(400, "invalid_request", "url must use http or https") };
      }
      return { value: url.toString() };
    } catch {
      return { response: openAiError(400, "invalid_request", "url must be a valid URL") };
    }
  }

  private upstreamUrl(path: string): string {
    return new URL(path, this.config.ollamaWebBaseUrl).toString();
  }

  private maxKeyAttempts(selectableAtStart: number): number {
    const available = Math.max(1, selectableAtStart);
    const configured = this.config.maxKeyAttemptsPerRequest;
    return configured === "all" ? available : Math.min(available, configured);
  }

  private shouldTryAnotherKey(classification: ErrorClassification, attempt: number, maxAttempts: number): boolean {
    const keyCannotServeRequest =
      classification.status === "invalid" ||
      classification.status === "session_blocked" ||
      classification.status === "weekly_blocked";
    return attempt < maxAttempts - 1 && (classification.retryable || keyCannotServeRequest);
  }

  private queueError(error: QueueError): Response {
    const stats = this.concurrency.stats();
    if (error.type === "queue_full") return openAiError(503, "queue_full", "Ollama Cloud Proxy queue is full", stats);
    if (error.type === "queue_timeout") return openAiError(503, "queue_timeout", "Ollama Cloud Proxy queue timeout", stats);
    if (error.type === "client_aborted") return openAiError(499, "client_aborted", "Client aborted request", stats);
    return openAiError(503, "server_shutting_down", "Server is shutting down", stats);
  }
}
