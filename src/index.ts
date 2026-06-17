import { AdminRoutes } from "./admin/adminRoutes";
import { loadConfig } from "./config/env";
import { ConcurrencyManager } from "./concurrency/concurrencyManager";
import { EventStore } from "./events/eventStore";
import { KeyPoolManager } from "./keyPool/keyPoolManager";
import { ModelManager } from "./models/modelManager";
import { ProxyHandler } from "./proxy/proxyHandler";
import { Router } from "./server/router";
import { KeyCipher } from "./security/encryption";
import { DatabaseStore } from "./storage/database";
import { WebService } from "./web/webService";

const config = loadConfig();
const store = new DatabaseStore(config.dbPath);
const events = new EventStore(store);
const cipher = new KeyCipher(config.keyEncryptionSecret);
const concurrency = new ConcurrencyManager(config, events);
const keyPool = new KeyPoolManager(config, store, events, cipher);
const models = new ModelManager(config, store);
const admin = new AdminRoutes(config, store, keyPool, concurrency, events, models);
const proxy = new ProxyHandler(config, concurrency, keyPool, models, events, store);
const web = new WebService(config, concurrency, keyPool, events, store);
const router = new Router(config, admin, proxy, concurrency, keyPool, web);

events.cleanup(config.eventRetentionDays, config.maxEvents);
setInterval(() => events.cleanup(config.eventRetentionDays, config.maxEvents), 60 * 60 * 1000);

const server = Bun.serve({
  port: config.port,
  idleTimeout: Math.ceil(config.upstreamIdleTimeoutMs / 1000),
  async fetch(req) {
    try {
      return await router.handle(req);
    } catch (error) {
      console.error("[UNHANDLED]", error);
      return Response.json(
        {
          error: {
            message: "Internal server error",
            type: "internal_error",
          },
        },
        { status: 500 }
      );
    }
  },
});

console.log(`Ollama Cloud Proxy listening on :${server.port}`);

async function shutdown(signal: string) {
  console.log(`${signal} received, draining active requests`);
  concurrency.stopAccepting();
  concurrency.rejectQueueForShutdown();
  await concurrency.waitForDrain(30_000);
  server.stop(true);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
