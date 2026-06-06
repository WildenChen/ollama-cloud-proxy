import type { AppConfig } from "../config/env";
import { APP_VERSION } from "../config/version";
import type { ConcurrencyManager, ConcurrencySlot } from "../concurrency/concurrencyManager";
import { QueueError } from "../concurrency/concurrencyManager";
import { openAiError } from "../errors/responses";
import type { EventStore } from "../events/eventStore";
import { classifyNetworkError, classifyUpstreamResponse } from "../keyPool/errorClassifier";
import type { KeyPoolManager } from "../keyPool/keyPoolManager";
import type { ModelManager } from "../models/modelManager";
import type { DatabaseStore } from "../storage/database";
import type { TokenUsageInput } from "../storage/database";
import type { ClientIdentity, ErrorClassification, KeyRecord } from "../types/domain";
import { getNextAnchoredIntervalResetAt, getNextFixedWeeklyResetAt } from "../utils/time";
import { readBodyWithLimit } from "./body";
import { proxyReadableStream } from "./stream";

type ResponseFormat = "openai" | "passthrough";
type AttemptStopReason =
  | "success"
  | "try_next_key"
  | "request_error"
  | "network_retry_limit"
  | "key_attempt_limit"
  | "no_selectable_key";

type AttemptResult = {
  response: Response;
  retry: boolean;
  classification?: ErrorClassification;
  errorType?: string;
  stopReason: AttemptStopReason;
};

export class ProxyHandler {
  constructor(
    private readonly config: AppConfig,
    private readonly concurrency: ConcurrencyManager,
    private readonly keyPool: KeyPoolManager,
    private readonly models: ModelManager,
    private readonly events: EventStore,
    private readonly store: DatabaseStore
  ) {}

  async handle(req: Request, path: string, client: ClientIdentity): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    if (path === "/v1/models" && req.method === "GET") {
      const cached = this.models.getCachedModels();
      if (cached) return Response.json(cached);
      return this.forwardWithQueue(req, requestId, client, null, null, undefined, startedAt, {
        upstreamPath: "/v1/models",
        responseFormat: "openai",
      });
    }

    if (path === "/api/version" && req.method === "GET") {
      return Response.json({ version: "0.12.6", proxy_version: APP_VERSION });
    }

    if (path === "/api/tags" && req.method === "GET") {
      if (client.authenticated) {
        return this.forwardWithQueue(req, requestId, client, null, null, undefined, startedAt, {
          upstreamPath: "/api/tags",
          responseFormat: "passthrough",
        });
      }
      return Response.json(this.models.ollamaTags());
    }

    if (path === "/api/ps" && req.method === "GET") {
      return Response.json({ models: [] });
    }

    if ((path === "/api/chat" || path === "/api/generate") && req.method === "POST") {
      let rawBody: string;
      let mappedBody: { body: string; originalModel: string | null; upstreamModel: string | null };
      try {
        rawBody = await readBodyWithLimit(req, this.config.maxRequestBodySizeBytes);
        mappedBody = this.config.ollamaNativeApplyAliases
          ? this.models.applyAliasToBody(rawBody)
          : {
              body: rawBody,
              originalModel: this.modelFromBody(rawBody),
              upstreamModel: this.modelFromBody(rawBody),
            };
      } catch (error) {
        const type = (error as Error).message === "request_body_too_large" ? "request_body_too_large" : "invalid_request";
        return openAiError(type === "request_body_too_large" ? 413 : 400, type, (error as Error).message);
      }

      return this.forwardWithQueue(
        req,
        requestId,
        client,
        mappedBody.originalModel,
        mappedBody.upstreamModel,
        mappedBody.body,
        startedAt,
        {
          upstreamPath: path,
          responseFormat: "passthrough",
        }
      );
    }

    if (
      !(
        (path === "/v1/chat/completions" && req.method === "POST") ||
        (path === "/v1/completions" && req.method === "POST")
      )
    ) {
      return openAiError(404, "not_found", "Not Found");
    }

    let mappedBody: { body: string; originalModel: string | null; upstreamModel: string | null };
    try {
      const rawBody = await readBodyWithLimit(req, this.config.maxRequestBodySizeBytes);
      mappedBody = this.models.applyAliasToBody(rawBody);
    } catch (error) {
      const type = (error as Error).message === "request_body_too_large" ? "request_body_too_large" : "invalid_request";
      return openAiError(type === "request_body_too_large" ? 413 : 400, type, (error as Error).message);
    }

    return this.forwardWithQueue(
      req,
      requestId,
      client,
      mappedBody.originalModel,
      mappedBody.upstreamModel,
      mappedBody.body,
      startedAt,
      {
        upstreamPath: path,
        responseFormat: "openai",
      }
    );
  }

  private async forwardWithQueue(
    req: Request,
    requestId: string,
    client: ClientIdentity,
    originalModel: string | null,
    upstreamModel: string | null,
    body: string | undefined,
    startedAt: number,
    options: { upstreamPath: string; responseFormat: ResponseFormat }
  ): Promise<Response> {
    let slot: ConcurrencySlot;
    try {
      slot = await this.concurrency.acquire(requestId, client.clientName, req.signal);
    } catch (error) {
      if (error instanceof QueueError) {
        return this.queueError(error);
      }
      throw error;
    }

    this.events.emit({
      level: "info",
      type: "request_started",
      message: `${req.method} ${new URL(req.url).pathname}`,
      clientName: client.clientName,
      requestId,
      originalModel,
      upstreamModel,
    });

    return this.forwardAttempts(req, requestId, client, originalModel, upstreamModel, body, startedAt, slot, options);
  }

  private async forwardAttempts(
    req: Request,
    requestId: string,
    client: ClientIdentity,
    originalModel: string | null,
    upstreamModel: string | null,
    body: string | undefined,
    startedAt: number,
    slot: ConcurrencySlot,
    options: { upstreamPath: string; responseFormat: ResponseFormat }
  ): Promise<Response> {
    const selectableAtStart = this.keyPool.selectableCount();
    const attempts = this.maxKeyAttempts(selectableAtStart);
    const triedKeyIds = new Set<string>();
    const attemptedKeys: Array<{ id: string; name: string }> = [];
    let networkAttempts = 0;
    let lastStopReason: AttemptStopReason = "no_selectable_key";

    for (let attempt = 0; attempt < attempts; attempt++) {
      const selectedKey = this.keyPool.selectKey(
        requestId,
        client.clientName,
        originalModel ?? undefined,
        upstreamModel ?? undefined,
        triedKeyIds
      );
      if (!selectedKey) {
        slot.release();
        this.events.emit({
          level: "warn",
          type: "no_available_key",
          message: "No available Ollama Cloud key",
          clientName: client.clientName,
          requestId,
          originalModel,
          upstreamModel,
          details: this.noAvailableKeyDetails(),
        });
        this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, "no_available_key");
        return openAiError(503, "no_available_key", "No available Ollama Cloud key", this.noAvailableKeyDetails());
      }
      triedKeyIds.add(selectedKey.id);
      attemptedKeys.push({ id: selectedKey.id, name: selectedKey.name });

      const response = await this.tryUpstream(
        req,
        requestId,
        client,
        selectedKey,
        originalModel,
        upstreamModel,
        body,
        startedAt,
        slot,
        attempt,
        attempts,
        options
      );
      if (response.classification?.category === "network" || response.classification?.category === "provider") {
        networkAttempts += 1;
      }
      const shouldTryNextKey =
        response.retry &&
        response.stopReason === "try_next_key" &&
        (!response.classification || response.classification.category === "key" || networkAttempts < this.config.maxNetworkRetryAttempts);
      this.events.emit({
        level: response.retry ? "warn" : response.response.ok ? "info" : "warn",
        type: "key_attempt",
        message: `Key attempt ${attempt + 1} ${response.retry ? "will try next key" : "finished"}`,
        clientName: client.clientName,
        requestId,
        keyId: selectedKey.id,
        keyName: selectedKey.name,
        originalModel,
        upstreamModel,
        details: {
          attemptIndex: attempt,
          attemptedKeysCount: attemptedKeys.length,
          maxAttempts: attempts,
          errorType: response.errorType || response.classification?.blockReason || null,
          shouldTryNextKey,
          stopReason: shouldTryNextKey ? "try_next_key" : response.stopReason,
        },
      });

      if (shouldTryNextKey) {
        lastStopReason = "try_next_key";
        this.events.emit({
          level: "warn",
          type: "retry_started",
          message: "Retrying upstream request with another key",
          clientName: client.clientName,
          requestId,
          keyId: selectedKey.id,
          keyName: selectedKey.name,
          originalModel,
          upstreamModel,
          details: { attempt: attempt + 1, maxAttempts: attempts, triedKeys: triedKeyIds.size },
        });
        continue;
      }

      if (response.retry) {
        lastStopReason =
          response.classification?.category === "network" || response.classification?.category === "provider"
            ? "network_retry_limit"
            : response.classification?.category === "key"
              ? "key_attempt_limit"
              : response.stopReason;
        break;
      }
      return response.response;
    }

    slot.release();
    const details = this.attemptExhaustedDetails(attemptedKeys.length, lastStopReason);
    this.events.emit({
      level: "error",
      type: "no_available_key",
      message: "No available key after attempts",
      clientName: client.clientName,
      requestId,
      originalModel,
      upstreamModel,
      details,
    });
    this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, "no_available_key_after_attempts");
    return openAiError(503, "no_available_key_after_attempts", "No available key after attempts", details);
  }

  private maxKeyAttempts(selectableAtStart: number): number {
    const available = Math.max(1, selectableAtStart);
    const configured = this.config.maxKeyAttemptsPerRequest;
    return configured === "all" ? available : Math.min(available, configured);
  }

  private async tryUpstream(
    req: Request,
    requestId: string,
    client: ClientIdentity,
    key: KeyRecord,
    originalModel: string | null,
    upstreamModel: string | null,
    body: string | undefined,
    startedAt: number,
    slot: ConcurrencySlot,
    attempt: number,
    maxAttempts: number,
    options: { upstreamPath: string; responseFormat: ResponseFormat }
  ): Promise<AttemptResult> {
    const controller = new AbortController();
    const abortOnClient = () => controller.abort(new Error("client_aborted"));
    req.signal.addEventListener("abort", abortOnClient, { once: true });
    const totalTimer = setTimeout(() => controller.abort(new Error("upstream_total_timeout")), this.config.upstreamTotalTimeoutMs);

    const finalized = { done: false };
    const finalize = (ok: boolean, errorType?: string, usage?: TokenUsageInput) => {
      if (finalized.done) return;
      finalized.done = true;
      clearTimeout(totalTimer);
      req.signal.removeEventListener("abort", abortOnClient);
      this.keyPool.releaseKey(key.id);
      slot.release();
      const durationMs = Date.now() - startedAt;
      if (ok) {
        this.keyPool.markSuccess(key.id, durationMs);
        this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", true, undefined, usage);
        this.events.emit({
          level: "info",
          type: "request_finished",
          message: "Request finished",
          clientName: client.clientName,
          requestId,
          keyId: key.id,
          keyName: key.name,
          originalModel,
          upstreamModel,
          durationMs,
        });
      } else {
        this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, errorType || "upstream_error");
        this.events.emit({
          level: errorType === "client_aborted" ? "warn" : "error",
          type: errorType === "client_aborted" ? "client_aborted" : "request_failed",
          message: errorType === "client_aborted" ? "Client aborted request" : "Request failed",
          clientName: client.clientName,
          requestId,
          keyId: key.id,
          keyName: key.name,
          originalModel,
          upstreamModel,
          durationMs,
          details: { errorType },
        });
      }
    };

    try {
      const upstream = await fetch(`${this.config.upstreamBaseUrl}${options.upstreamPath}`, {
        method: req.method,
        headers: this.upstreamHeaders(req, key),
        body,
        signal: controller.signal,
      });

      clearTimeout(totalTimer);

      if (!upstream.ok) {
        const errorBody = await upstream.text();
        if (
          options.responseFormat === "passthrough" &&
          upstream.status >= 400 &&
          upstream.status < 500 &&
          upstream.status !== 401 &&
          upstream.status !== 429
        ) {
          const headers = this.responseHeaders(upstream.headers);
          finalize(false, `upstream_${upstream.status}`);
          return {
            retry: false,
            response: new Response(errorBody, {
              status: upstream.status,
              statusText: upstream.statusText,
              headers,
            }),
            errorType: `upstream_${upstream.status}`,
            stopReason: "request_error",
          };
        }
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
        req.signal.removeEventListener("abort", abortOnClient);
        const shouldRetry = this.shouldTryAnotherKey(classification, attempt, maxAttempts);
        if (shouldRetry) {
          return {
            response: openAiError(upstream.status, classification.blockReason, classification.message),
            retry: true,
            classification,
            errorType: classification.blockReason,
            stopReason: "try_next_key",
          };
        }
        if (classification.category === "key") {
          return {
            response: openAiError(upstream.status, classification.blockReason, classification.message),
            retry: true,
            classification,
            errorType: classification.blockReason,
            stopReason: "key_attempt_limit",
          };
        }
        slot.release();
        this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, classification.blockReason);
        return {
          retry: false,
          response: openAiError(upstream.status, classification.blockReason, classification.message, {
            upstreamStatus: upstream.status,
            keyId: key.id,
            keyName: key.name,
          }),
          classification,
          errorType: classification.blockReason,
          stopReason: classification.category === "request" ? "request_error" : "key_attempt_limit",
        };
      }

      const headers = this.responseHeaders(upstream.headers);
      if (options.responseFormat === "openai" && options.upstreamPath === "/v1/models") {
        const modelResponse = await upstream.json();
        this.models.setCachedModels(modelResponse);
        finalize(true);
        return { retry: false, response: Response.json(this.models.mergeAliases(modelResponse), { headers }), stopReason: "success" };
      }

      const shouldBufferForUsage =
        Boolean(upstream.body) &&
        this.canBufferUsageResponse(options.upstreamPath, options.responseFormat, upstream.headers, body);
      if (shouldBufferForUsage) {
        const responseText = await upstream.text();
        const usage = this.extractUsage(responseText, options.responseFormat);
        finalize(true, undefined, usage);
        return {
          retry: false,
          response: new Response(responseText, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers,
          }),
          stopReason: "success",
        };
      }

      const proxiedBody = proxyReadableStream(
        upstream.body,
        req.signal,
        this.config.upstreamIdleTimeoutMs,
        this.config.upstreamTotalTimeoutMs,
        () => controller.abort(new Error("stream_aborted")),
        (result) => {
          if (result.ok) finalize(true);
          else {
            const classification = classifyNetworkError(result.errorType === "upstream_timeout");
            if (result.errorType !== "client_aborted") {
              this.keyPool.markFailure(key.id, classification, Date.now() - startedAt);
            }
            finalize(false, result.errorType);
          }
        }
      );
      return {
        retry: false,
        response: new Response(proxiedBody, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers,
        }),
        stopReason: "success",
      };
    } catch (error) {
      clearTimeout(totalTimer);
      const timeout = String((error as Error).message || "").includes("timeout");
      const classification = classifyNetworkError(timeout);
      this.keyPool.markFailure(key.id, classification, Date.now() - startedAt);
      this.keyPool.releaseKey(key.id);
      req.signal.removeEventListener("abort", abortOnClient);
      const shouldRetry = this.shouldTryAnotherKey(classification, attempt, maxAttempts);
      if (shouldRetry) {
        return {
          response: openAiError(503, classification.blockReason, classification.message),
          retry: true,
          classification,
          errorType: classification.blockReason,
          stopReason: "try_next_key",
        };
      }
      slot.release();
      this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, classification.blockReason);
      return {
        retry: false,
        response: openAiError(503, classification.blockReason, classification.message),
        classification,
        errorType: classification.blockReason,
        stopReason: "network_retry_limit",
      };
    }
  }

  private shouldTryAnotherKey(classification: ErrorClassification, attempt: number, maxAttempts: number): boolean {
    const keyCannotServeRequest =
      classification.status === "invalid" ||
      classification.status === "session_blocked" ||
      classification.status === "weekly_blocked";
    return attempt < maxAttempts - 1 && (classification.retryable || keyCannotServeRequest);
  }

  private attemptExhaustedDetails(attemptedKeysCount: number, stopReason: AttemptStopReason) {
    const summary = this.keyPool.summary();
    return {
      ...summary,
      attemptedKeysCount,
      sessionBlockedKeysCount: summary.sessionBlockedKeys,
      weeklyBlockedKeysCount: summary.weeklyBlockedKeys,
      coolingDownKeysCount: summary.coolingDownKeys,
      invalidKeysCount: summary.invalidKeys,
      nextSessionRecoveryAt: this.keyPool.nextRecoveryAt("session_blocked"),
      nextWeeklyResetAt: this.keyPool.nextRecoveryAt("weekly_blocked"),
      stopReason,
    };
  }

  private upstreamHeaders(req: Request, key: KeyRecord): Headers {
    const headers = new Headers();
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    headers.set("authorization", `Bearer ${this.keyPool.decryptKey(key)}`);
    return headers;
  }

  private responseHeaders(upstreamHeaders: Headers): Headers {
    const headers = new Headers(upstreamHeaders);
    headers.delete("connection");
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    return headers;
  }

  private queueError(error: QueueError): Response {
    const stats = this.concurrency.stats();
    if (error.type === "queue_full") {
      return openAiError(503, "queue_full", "Ollama Cloud Proxy queue is full", stats);
    }
    if (error.type === "queue_timeout") {
      return openAiError(503, "queue_timeout", "Ollama Cloud Proxy queue timeout", stats);
    }
    if (error.type === "client_aborted") {
      return openAiError(499, "client_aborted", "Client aborted request", stats);
    }
    return openAiError(503, "server_shutting_down", "Server is shutting down", stats);
  }

  private noAvailableKeyDetails() {
    const settings = this.store.getUsageSettings(this.config);
    return {
      ...this.keyPool.summary(),
      ...this.concurrency.stats(),
      nextWeeklyResetAt: getNextFixedWeeklyResetAt(
        new Date(),
        settings.usageTimezone,
        settings.weeklyResetDayOfWeek,
        settings.weeklyResetTime
      ).toISOString(),
      nextSessionResetAt: getNextAnchoredIntervalResetAt(
        new Date(),
        settings.sessionResetAnchor,
        settings.sessionResetIntervalHours
      ).toISOString(),
    };
  }

  private recordResult(clientName: string, model: string, success: boolean, errorType?: string, usage?: TokenUsageInput) {
    this.store.recordClientRequest(clientName, success, errorType);
    this.store.recordModelRequest(model, success, usage);
  }

  private modelFromBody(rawBody: string): string | null {
    try {
      const parsed = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      return typeof parsed.model === "string" ? parsed.model : null;
    } catch {
      return null;
    }
  }

  private canBufferUsageResponse(
    upstreamPath: string,
    responseFormat: ResponseFormat,
    headers: Headers,
    requestBody: string | undefined
  ) {
    if (upstreamPath === "/v1/models") return false;
    if (!headers.get("content-type")?.toLowerCase().includes("json")) return false;
    if (!requestBody) return true;
    try {
      const parsed = JSON.parse(requestBody) as Record<string, unknown>;
      return parsed.stream !== true;
    } catch {
      return responseFormat === "openai";
    }
  }

  private extractUsage(responseText: string, responseFormat: ResponseFormat): TokenUsageInput | undefined {
    try {
      const parsed = JSON.parse(responseText) as Record<string, unknown>;
      if (responseFormat === "openai" && parsed.usage && typeof parsed.usage === "object") {
        const usage = parsed.usage as Record<string, unknown>;
        const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
        const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
        const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);
        const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
        const inputDetails = usage.input_tokens_details as Record<string, unknown> | undefined;
        const cachedTokens = Number(promptDetails?.cached_tokens ?? inputDetails?.cache_read ?? 0);
        return { promptTokens, completionTokens, totalTokens, cachedTokens };
      }
      const promptTokens = Number(parsed.prompt_eval_count ?? 0);
      const completionTokens = Number(parsed.eval_count ?? 0);
      if (promptTokens || completionTokens) {
        return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cachedTokens: 0 };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
}
