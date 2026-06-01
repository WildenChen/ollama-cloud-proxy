import type { AppConfig } from "../config/env";
import type { EventStore } from "../events/eventStore";

export class QueueError extends Error {
  constructor(
    readonly type: "queue_full" | "queue_timeout" | "server_shutting_down" | "client_aborted",
    message: string
  ) {
    super(message);
  }
}

type QueueItem = {
  requestId: string;
  clientName: string;
  resolve: (slot: ConcurrencySlot) => void;
  reject: (error: QueueError) => void;
  timeout: Timer;
  startedAt: number;
  signal?: AbortSignal;
  abortListener?: () => void;
};

export type ConcurrencySlot = {
  release: () => void;
};

export class ConcurrencyManager {
  private activeRequests = 0;
  private readonly queue: QueueItem[] = [];
  private accepting = true;
  private readonly activeByClient = new Map<string, number>();
  private readonly queuedByClient = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly events: EventStore
  ) {}

  acquire(requestId: string, clientName: string, signal?: AbortSignal): Promise<ConcurrencySlot> {
    if (!this.accepting) {
      return Promise.reject(new QueueError("server_shutting_down", "Server is shutting down"));
    }

    if (this.activeRequests < this.config.maxConcurrentRequests) {
      return Promise.resolve(this.allocate(clientName));
    }

    if (this.queue.length >= this.config.requestQueueMax) {
      this.events.emit({
        level: "warn",
        type: "queue_rejected",
        message: "Request queue is full",
        clientName,
        requestId,
        details: this.stats(),
      });
      return Promise.reject(new QueueError("queue_full", "Ollama Cloud Proxy queue is full"));
    }

    this.events.emit({
      level: "info",
      type: "queue_wait_started",
      message: "Request entered queue",
      clientName,
      requestId,
      details: this.stats(),
    });

    this.bump(this.queuedByClient, clientName, 1);

    return new Promise((resolve, reject) => {
      const item: QueueItem = {
        requestId,
        clientName,
        resolve,
        reject,
        startedAt: Date.now(),
        signal,
        timeout: setTimeout(() => {
          this.removeFromQueue(item);
          this.bump(this.queuedByClient, clientName, -1);
          this.events.emit({
            level: "warn",
            type: "queue_timeout",
            message: "Request queue timeout",
            clientName,
            requestId,
            details: this.stats(),
          });
          reject(new QueueError("queue_timeout", "Ollama Cloud Proxy queue timeout"));
        }, this.config.requestQueueTimeoutMs),
      };

      item.abortListener = () => {
        this.removeFromQueue(item);
        this.bump(this.queuedByClient, clientName, -1);
        reject(new QueueError("client_aborted", "Client aborted while waiting in queue"));
      };

      if (signal) {
        if (signal.aborted) {
          clearTimeout(item.timeout);
          this.bump(this.queuedByClient, clientName, -1);
          reject(new QueueError("client_aborted", "Client aborted while waiting in queue"));
          return;
        }
        signal.addEventListener("abort", item.abortListener, { once: true });
      }

      this.queue.push(item);
    });
  }

  stats() {
    return {
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      activeRequests: this.activeRequests,
      queuedRequests: this.queue.length,
      requestQueueMax: this.config.requestQueueMax,
      requestQueueTimeoutMs: this.config.requestQueueTimeoutMs,
      maxConcurrentRequestsPerKey: this.config.maxConcurrentRequestsPerKey,
    };
  }

  clientRuntimeStats() {
    const names = new Set([...this.activeByClient.keys(), ...this.queuedByClient.keys()]);
    return [...names].map((clientName) => ({
      clientName,
      activeRequests: this.activeByClient.get(clientName) || 0,
      queuedRequests: this.queuedByClient.get(clientName) || 0,
    }));
  }

  stopAccepting() {
    this.accepting = false;
  }

  async waitForDrain(timeoutMs: number) {
    const started = Date.now();
    while (this.activeRequests > 0 && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  rejectQueueForShutdown() {
    for (const item of [...this.queue]) {
      this.removeFromQueue(item);
      this.bump(this.queuedByClient, item.clientName, -1);
      item.reject(new QueueError("server_shutting_down", "Server is shutting down"));
    }
  }

  private allocate(clientName: string): ConcurrencySlot {
    this.activeRequests++;
    this.bump(this.activeByClient, clientName, 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeRequests = Math.max(0, this.activeRequests - 1);
        this.bump(this.activeByClient, clientName, -1);
        this.drainQueue();
      },
    };
  }

  private drainQueue() {
    while (this.activeRequests < this.config.maxConcurrentRequests && this.queue.length > 0) {
      const item = this.queue.shift()!;
      clearTimeout(item.timeout);
      if (item.signal && item.abortListener) {
        item.signal.removeEventListener("abort", item.abortListener);
      }
      this.bump(this.queuedByClient, item.clientName, -1);
      item.resolve(this.allocate(item.clientName));
    }
  }

  private removeFromQueue(item: QueueItem) {
    const index = this.queue.indexOf(item);
    if (index >= 0) this.queue.splice(index, 1);
    clearTimeout(item.timeout);
    if (item.signal && item.abortListener) {
      item.signal.removeEventListener("abort", item.abortListener);
    }
  }

  private bump(map: Map<string, number>, key: string, delta: number) {
    const next = Math.max(0, (map.get(key) || 0) + delta);
    if (next === 0) map.delete(key);
    else map.set(key, next);
  }
}
