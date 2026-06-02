import type { AppConfig } from "../config/env";
import type { AdminRoutes } from "../admin/adminRoutes";
import type { ProxyHandler } from "../proxy/proxyHandler";
import { json, notFound, openAiError } from "../errors/responses";
import { authenticateClient, requireAdmin } from "../security/auth";
import type { ConcurrencyManager } from "../concurrency/concurrencyManager";
import type { KeyPoolManager } from "../keyPool/keyPoolManager";
import { APP_VERSION } from "../config/version";

export class Router {
  constructor(
    private readonly config: AppConfig,
    private readonly admin: AdminRoutes,
    private readonly proxy: ProxyHandler,
    private readonly concurrency: ConcurrencyManager,
    private readonly keyPool: KeyPoolManager
  ) {}

  async handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;

    if (path === "/health" && req.method === "GET") {
      return json({
        status: "ok",
        version: APP_VERSION,
        concurrency: this.concurrency.stats(),
        keys: this.keyPool.summary(),
      });
    }

    if (path === "/admin" && req.method === "GET") {
      return this.staticFile("public/admin/index.html", "text/html; charset=utf-8");
    }

    if ((path === "/admin/app.css" || path === "/admin/app.js") && req.method === "GET") {
      const filePath = path === "/admin/app.css" ? "public/admin/app.css" : "public/admin/app.js";
      const contentType = path.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/javascript; charset=utf-8";
      return this.staticFile(filePath, contentType);
    }

    if (path.startsWith("/admin/")) {
      const denied = requireAdmin(req, this.config);
      if (denied) return denied;
      return this.admin.handle(req, path);
    }

    if (
      path.startsWith("/v1/") ||
      path === "/api/tags" ||
      path === "/api/chat"
    ) {
      const auth = authenticateClient(req, this.config);
      if ("response" in auth) return auth.response;
      return this.proxy.handle(req, path, auth.identity);
    }

    return notFound();
  }

  private staticFile(path: string, contentType: string): Response {
    return new Response(Bun.file(path), {
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  }
}
