import type { AppConfig } from "../config/env";
import type { AdminRoutes } from "../admin/adminRoutes";
import type { ProxyHandler } from "../proxy/proxyHandler";
import { json, notFound, openAiError } from "../errors/responses";
import { authenticateClient, requireAdmin } from "../security/auth";
import type { ConcurrencyManager } from "../concurrency/concurrencyManager";
import type { KeyPoolManager } from "../keyPool/keyPoolManager";
import type { WebService } from "../web/webService";
import { APP_VERSION } from "../config/version";
import type { DatabaseStore } from "../storage/database";
import type { KeyCipher } from "../security/encryption";
import type { UsageService } from "../usage/usageService";

const ADMIN_ASSETS = new Map([
  ["/admin/app.css", ["public/admin/app.css", "text/css; charset=utf-8"]],
  ["/admin/app.js", ["public/admin/app.js", "text/javascript; charset=utf-8"]],
  ["/admin/onboarding.css", ["public/admin/onboarding.css", "text/css; charset=utf-8"]],
  ["/admin/accessibility.css", ["public/admin/accessibility.css", "text/css; charset=utf-8"]],
  ["/admin/credential-ux.css", ["public/admin/credential-ux.css", "text/css; charset=utf-8"]],
  ["/admin/error-ux.css", ["public/admin/error-ux.css", "text/css; charset=utf-8"]],
  ["/admin/mobile-key-card.css", ["public/admin/mobile-key-card.css", "text/css; charset=utf-8"]],
  ["/admin/onboarding.js", ["public/admin/onboarding.js", "text/javascript; charset=utf-8"]],
  ["/admin/readiness.js", ["public/admin/readiness.js", "text/javascript; charset=utf-8"]],
  ["/admin/credential-ux.js", ["public/admin/credential-ux.js", "text/javascript; charset=utf-8"]],
  ["/admin/credential-status.js", ["public/admin/credential-status.js", "text/javascript; charset=utf-8"]],
  ["/admin/error-ux.js", ["public/admin/error-ux.js", "text/javascript; charset=utf-8"]],
  ["/admin/error-guidance.js", ["public/admin/error-guidance.js", "text/javascript; charset=utf-8"]],
] as const);

export class Router {
  constructor(
    private readonly config: AppConfig,
    private readonly admin: AdminRoutes,
    private readonly proxy: ProxyHandler,
    private readonly concurrency: ConcurrencyManager,
    private readonly keyPool: KeyPoolManager,
    private readonly web: WebService,
    private readonly store: DatabaseStore,
    private readonly cipher: KeyCipher,
    private readonly usageService: UsageService
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

    if ((path === "/api/usage" || path === "/api/usage/accounts") && req.method === "GET") {
      if (!this.config.usageApiEnabled) return notFound();
      return json(
        path.endsWith("/accounts") ? this.usageService.accountsSnapshot() : this.usageService.overviewSnapshot(),
        200,
        { "cache-control": "no-store" }
      );
    }

    if (path === "/admin" && req.method === "GET") {
      return this.adminIndex();
    }

    const adminAsset = ADMIN_ASSETS.get(path);
    if (adminAsset && req.method === "GET") {
      return this.staticFile(adminAsset[0], adminAsset[1]);
    }

    if (path.startsWith("/admin/")) {
      if (
        path === "/admin/auth/status" ||
        path === "/admin/auth/setup" ||
        path === "/admin/auth/login" ||
        path === "/admin/auth/logout" ||
        (path === "/admin/stats" && req.method === "GET")
      ) {
        return this.admin.handle(req, path);
      }
      const denied = requireAdmin(req, this.store, this.config.keyEncryptionSecret);
      if (denied) return denied;
      return this.admin.handle(req, path);
    }

    if (
      (path === "/api/version" && req.method === "GET") ||
      (path === "/api/ps" && req.method === "GET") ||
      (
        this.config.ollamaCompatDiscoveryPublic &&
        (path === "/api/tags" || path === "/v1/models") &&
        req.method === "GET" &&
        !this.hasBearerToken(req)
      )
    ) {
      return this.proxy.handle(req, path, { clientName: "ollama-discovery", authenticated: false });
    }

    if ((path === "/v1/web/search" || path === "/api/web_search") && req.method === "POST") {
      const auth = authenticateClient(req, this.config, this.store, this.cipher);
      if ("response" in auth) return auth.response;
      return this.web.handleSearch(req, auth.identity);
    }

    if ((path === "/v1/web/fetch" || path === "/api/web_fetch") && req.method === "POST") {
      const auth = authenticateClient(req, this.config, this.store, this.cipher);
      if ("response" in auth) return auth.response;
      return this.web.handleFetch(req, auth.identity);
    }

    if (path === "/v1/search" && req.method === "GET") {
      return this.web.listSearchProviders();
    }

    if (path === "/v1/search" && req.method === "POST") {
      const auth = authenticateClient(req, this.config, this.store, this.cipher);
      if ("response" in auth) return auth.response;
      return this.web.handleOmniSearch(req, auth.identity);
    }

    if (
      path.startsWith("/v1/") ||
      path === "/api/tags" ||
      path === "/api/chat" ||
      path === "/api/generate"
    ) {
      const auth = authenticateClient(req, this.config, this.store, this.cipher);
      if ("response" in auth) return auth.response;
      return this.proxy.handle(req, path, auth.identity);
    }

    return notFound();
  }

  private hasBearerToken(req: Request): boolean {
    return /^Bearer\s+.+$/i.test(req.headers.get("authorization") || "");
  }

  private async adminIndex(): Promise<Response> {
    const template = await Bun.file("public/admin/index.html").text();
    const html = template
      .replace(
        "</head>",
        [
          '    <link rel="stylesheet" href="/admin/onboarding.css?v=1.4.0-onboarding" />',
          '    <link rel="stylesheet" href="/admin/accessibility.css?v=1.4.0-accessibility" />',
          '    <link rel="stylesheet" href="/admin/credential-ux.css?v=1.4.0-credentials" />',
          '    <link rel="stylesheet" href="/admin/error-ux.css?v=1.4.0-errors" />',
          '    <link rel="stylesheet" href="/admin/mobile-key-card.css?v=1.5.1-mobile-key-card" />',
          '    <script src="/admin/error-ux.js?v=1.4.0-errors" type="module"></script>',
          "  </head>",
        ].join("\n")
      )
      .replace(
        '<section id="notice" class="notice hidden" role="status"></section>',
        '<section id="notice" class="notice hidden" role="status"></section>\n      <div id="errorGuidanceRoot" class="hidden"></div>'
      )
      .replace(
        '<section id="overviewPage" class="page active">',
        '<section id="overviewPage" class="page active">\n        <div id="serviceReadinessRoot" aria-live="polite"></div>\n        <div id="onboardingRoot"></div>\n        <div id="keyFilterRoot"></div>'
      )
      .replace(
        '<section id="settingsPage" class="page">',
        '<section id="settingsPage" class="page">\n        <div id="credentialGuideRoot"></div>'
      )
      .replace(
        "</body>",
        [
          '    <script src="/admin/onboarding.js?v=1.4.0-onboarding" type="module"></script>',
          '    <script src="/admin/credential-ux.js?v=1.4.0-credentials" type="module"></script>',
          "  </body>",
        ].join("\n")
      );

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
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
