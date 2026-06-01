import type { AppConfig } from "../config/env";
import type { ConcurrencyManager, ConcurrencySlot } from "../concurrency/concurrencyManager";
import { QueueError } from "../concurrency/concurrencyManager";
import { openAiError } from "../errors/responses";
import type { EventStore } from "../events/eventStore";
import { classifyNetworkError, classifyUpstreamResponse } from "../keyPool/errorClassifier";
import type { KeyPoolManager } from "../keyPool/keyPoolManager";
import type { ModelManager } from "../models/modelManager";
import type { DatabaseStore } from "../storage/database";
import type { ClientIdentity, KeyRecord } from "../types/domain";
import { getNextFixedWeeklyResetAt } from "../utils/time";
import { readBodyWithLimit } from "./body";
import { proxyReadableStream } from "./stream";

type ResponseFormat = "openai" | "ollama_tags" | "ollama_chat" | "ollama_chat_stream";

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

    if (path === "/api/tags" && req.method === "GET") {
      const cached = this.models.getCachedModels();
      if (cached) return Response.json(this.toOllamaTags(cached));
      return this.forwardWithQueue(req, requestId, client, null, null, undefined, startedAt, {
        upstreamPath: "/v1/models",
        responseFormat: "ollama_tags",
      });
    }

    if (path === "/api/chat" && req.method === "POST") {
      let mappedBody: {
        body: string;
        originalModel: string | null;
        upstreamModel: string | null;
        stream: boolean;
      };
      try {
        const rawBody = await readBodyWithLimit(req, this.config.maxRequestBodySizeBytes);
        mappedBody = this.ollamaChatToOpenAiBody(rawBody);
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
          upstreamPath: "/v1/chat/completions",
          responseFormat: mappedBody.stream ? "ollama_chat_stream" : "ollama_chat",
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
    const attempts = this.config.maxUpstreamRetriesPerRequest + 1;
    let lastError: Response | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const selectedKey = this.keyPool.selectKey(
        requestId,
        client.clientName,
        originalModel ?? undefined,
        upstreamModel ?? undefined
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
        options
      );

      if (response.retry) {
        lastError = response.response;
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
          details: { attempt: attempt + 1, maxRetries: this.config.maxUpstreamRetriesPerRequest },
        });
        continue;
      }

      return response.response;
    }

    slot.release();
    this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, "upstream_error");
    return lastError || openAiError(503, "upstream_error", "No available upstream");
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
    options: { upstreamPath: string; responseFormat: ResponseFormat }
  ): Promise<{ response: Response; retry: boolean }> {
    const controller = new AbortController();
    const abortOnClient = () => controller.abort(new Error("client_aborted"));
    req.signal.addEventListener("abort", abortOnClient, { once: true });
    const totalTimer = setTimeout(() => controller.abort(new Error("upstream_total_timeout")), this.config.upstreamTotalTimeoutMs);

    const finalized = { done: false };
    const finalize = (ok: boolean, errorType?: string) => {
      if (finalized.done) return;
      finalized.done = true;
      clearTimeout(totalTimer);
      req.signal.removeEventListener("abort", abortOnClient);
      this.keyPool.releaseKey(key.id);
      slot.release();
      const durationMs = Date.now() - startedAt;
      if (ok) {
        this.keyPool.markSuccess(key.id, durationMs);
        this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", true);
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
        const classification = await classifyUpstreamResponse(
          upstream.status,
          errorBody,
          key.consecutiveFailures,
          this.config
        );
        this.keyPool.markFailure(key.id, classification, Date.now() - startedAt);
        this.keyPool.releaseKey(key.id);
        req.signal.removeEventListener("abort", abortOnClient);
        const shouldRetry =
          classification.retryable && attempt < this.config.maxUpstreamRetriesPerRequest;
        if (shouldRetry) {
          return { response: openAiError(upstream.status, classification.blockReason, classification.message), retry: true };
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
        };
      }

      const headers = this.responseHeaders(upstream.headers);
      if (options.upstreamPath === "/v1/models") {
        const modelResponse = await upstream.json();
        this.models.setCachedModels(modelResponse);
        finalize(true);
        const merged = this.models.mergeAliases(modelResponse);
        const responseBody =
          options.responseFormat === "ollama_tags" ? this.toOllamaTags(merged) : merged;
        return { retry: false, response: Response.json(responseBody, { headers }) };
      }

      if (options.responseFormat === "ollama_chat") {
        const openAiResponse = await upstream.json();
        finalize(true);
        return {
          retry: false,
          response: Response.json(
            this.toOllamaChatResponse(openAiResponse, originalModel || upstreamModel || "unknown"),
            { headers }
          ),
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
      const responseBody =
        options.responseFormat === "ollama_chat_stream"
          ? this.toOllamaChatStream(proxiedBody, originalModel || upstreamModel || "unknown")
          : proxiedBody;
      if (options.responseFormat === "ollama_chat_stream") {
        headers.set("content-type", "application/x-ndjson; charset=utf-8");
      }

      return {
        retry: false,
        response: new Response(responseBody, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers,
        }),
      };
    } catch (error) {
      clearTimeout(totalTimer);
      const timeout = String((error as Error).message || "").includes("timeout");
      const classification = classifyNetworkError(timeout);
      this.keyPool.markFailure(key.id, classification, Date.now() - startedAt);
      this.keyPool.releaseKey(key.id);
      req.signal.removeEventListener("abort", abortOnClient);
      const shouldRetry = classification.retryable && attempt < this.config.maxUpstreamRetriesPerRequest;
      if (shouldRetry) {
        return { response: openAiError(503, classification.blockReason, classification.message), retry: true };
      }
      slot.release();
      this.recordResult(client.clientName, upstreamModel || originalModel || "unknown", false, classification.blockReason);
      return {
        retry: false,
        response: openAiError(503, classification.blockReason, classification.message),
      };
    }
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
    return {
      ...this.keyPool.summary(),
      ...this.concurrency.stats(),
      nextWeeklyResetAt: getNextFixedWeeklyResetAt(
        new Date(),
        this.config.usageTimezone,
        this.config.weeklyResetDayOfWeek,
        this.config.weeklyResetTime
      ).toISOString(),
    };
  }

  private recordResult(clientName: string, model: string, success: boolean, errorType?: string) {
    this.store.recordClientRequest(clientName, success, errorType);
    this.store.recordModelRequest(model, success);
  }

  private ollamaChatToOpenAiBody(rawBody: string): {
    body: string;
    originalModel: string | null;
    upstreamModel: string | null;
    stream: boolean;
  } {
    const parsed = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    const model = typeof parsed.model === "string" ? parsed.model : null;
    const mapped = this.models.mapModel(model);
    const stream = parsed.stream !== false;
    const body = JSON.stringify({
      model: mapped.upstreamModel,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      stream,
      tools: parsed.tools,
    });

    return { body, ...mapped, stream };
  }

  private toOllamaTags(response: unknown) {
    const data =
      response && typeof response === "object" && Array.isArray((response as { data?: unknown }).data)
        ? ((response as { data: Array<{ id?: unknown }> }).data)
        : [];
    return {
      models: data
        .map((item) => (typeof item.id === "string" ? item.id : null))
        .filter((name): name is string => Boolean(name))
        .map((name) => ({
          name,
          model: name,
          modified_at: new Date(0).toISOString(),
          size: 0,
          digest: "",
          details: {
            parent_model: "",
            format: "",
            family: "",
            families: [],
            parameter_size: "",
            quantization_level: "",
          },
        })),
    };
  }

  private toOllamaChatResponse(response: unknown, model: string) {
    const choice =
      response && typeof response === "object" && Array.isArray((response as { choices?: unknown }).choices)
        ? (response as { choices: Array<{ message?: { role?: string; content?: unknown } }> }).choices[0]
        : undefined;
    const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
    return {
      model,
      created_at: new Date().toISOString(),
      message: {
        role: choice?.message?.role || "assistant",
        content,
      },
      done: true,
    };
  }

  private toOllamaChatStream(stream: ReadableStream<Uint8Array> | null, model: string) {
    if (!stream) return stream;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    return stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    model,
                    created_at: new Date().toISOString(),
                    message: { role: "assistant", content: "" },
                    done: true,
                  }) + "\n"
                )
              );
              continue;
            }

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { role?: string; content?: string } }>;
              };
              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content || "";
              if (!content) continue;
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    model,
                    created_at: new Date().toISOString(),
                    message: { role: delta?.role || "assistant", content },
                    done: false,
                  }) + "\n"
                )
              );
            } catch {
              // Ignore malformed upstream chunks; the stream finalizer handles transport errors.
            }
          }
        },
        flush(controller) {
          buffer += decoder.decode();
          if (buffer.trim() === "data: [DONE]") {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  model,
                  created_at: new Date().toISOString(),
                  message: { role: "assistant", content: "" },
                  done: true,
                }) + "\n"
              )
            );
          }
        },
      })
    );
  }
}
