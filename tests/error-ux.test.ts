import { describe, expect, test } from "bun:test";
import {
  buildSafeDiagnostic,
  classifyUserFacingError,
  redactDiagnostic,
} from "../public/admin/error-guidance.js";
import { Router } from "../src/server/router";

function routerForStaticAdmin() {
  return new Router(
    {} as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
}

describe("user-facing error classification", () => {
  test("distinguishes authentication, upstream keys, quota, and usage-only failures", () => {
    expect(classifyUserFacingError({ code: "unauthorized", status: 401, context: "/admin/keys" }).kind).toBe("admin_auth");
    expect(classifyUserFacingError({ code: "unauthorized", status: 401, context: "/v1/chat/completions client token" }).kind).toBe("client_auth");
    expect(classifyUserFacingError({ code: "no_available_key", status: 503 }).kind).toBe("no_available_key");
    expect(classifyUserFacingError({ code: "invalid_api_key", status: 401 }).kind).toBe("upstream_key_invalid");
    expect(classifyUserFacingError({ code: "weekly_blocked", status: 429 }).kind).toBe("quota_limited");
    const usage = classifyUserFacingError({ code: "official_usage_refresh_failed", message: "Usage Cookie expired" });
    expect(usage.kind).toBe("usage_cookie");
    expect(usage.usageOnly).toBe(true);
  });

  test("distinguishes temporary network, queue, invalid setting, and stale data", () => {
    expect(classifyUserFacingError({ code: "model_refresh_failed", status: 503 }).kind).toBe("upstream_unavailable");
    expect(classifyUserFacingError({ code: "queue_timeout", status: 503 }).kind).toBe("queue_busy");
    expect(classifyUserFacingError({ code: "invalid_usage_settings", status: 400 }).kind).toBe("invalid_setting");
    expect(classifyUserFacingError({ code: "key_not_found", status: 404 }).kind).toBe("upstream_key_invalid");
    expect(classifyUserFacingError({ code: "client_key_not_found", status: 404 }).kind).toBe("not_found");
  });
});

describe("safe diagnostics", () => {
  test("redacts bearer tokens, client tokens, cookies, query secrets, and local user paths", () => {
    const input = [
      "Bearer top-secret-token",
      "ocp_abcdefghijklmnopqrstuvwxyz012345",
      "__Secure-session=session-secret",
      "ocp_admin_session=admin-secret",
      "https://example.test/path?token=query-secret&key=another-secret",
      "apiKey=inline-secret",
      "/Users/wilden/private/file.txt",
      "/home/wilden/private/file.txt",
    ].join(" | ");
    const output = redactDiagnostic(input);

    expect(output).not.toContain("top-secret-token");
    expect(output).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(output).not.toContain("session-secret");
    expect(output).not.toContain("admin-secret");
    expect(output).not.toContain("query-secret");
    expect(output).not.toContain("another-secret");
    expect(output).not.toContain("inline-secret");
    expect(output).not.toContain("/Users/wilden/");
    expect(output).not.toContain("/home/wilden/");
    expect(output).toContain("[REDACTED]");
  });

  test("redacts sensitive object fields recursively", () => {
    const output = buildSafeDiagnostic({
      endpoint: "/admin/keys",
      code: "invalid_request",
      message: "Request failed",
      details: {
        apiKey: "secret-api-key",
        nested: { cookie: "secret-cookie", safeValue: "keep" },
      },
    });

    expect(output.details.apiKey).toBe("[REDACTED]");
    expect(output.details.nested.cookie).toBe("[REDACTED]");
    expect(output.details.nested.safeValue).toBe("keep");
  });
});

describe("error guidance assets", () => {
  test("loads the error monitor before the main Admin module", async () => {
    const response = await routerForStaticAdmin().handle(new Request("http://localhost/admin"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('id="errorGuidanceRoot"');
    expect(html).toContain('/admin/error-ux.css?v=1.4.0-errors');
    expect(html).toContain('/admin/error-ux.js?v=1.4.0-errors');
    expect(html.indexOf("/admin/error-ux.js")).toBeLessThan(html.indexOf("/admin/app.js"));
  });

  test("serves error guidance assets without admin authentication", async () => {
    const router = routerForStaticAdmin();
    const assets = [
      ["/admin/error-ux.css", "text/css"],
      ["/admin/error-ux.js", "text/javascript"],
      ["/admin/error-guidance.js", "text/javascript"],
    ];

    for (const [path, contentType] of assets) {
      const response = await router.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect((await response.text()).length).toBeGreaterThan(20);
    }
  });

  test("builds the early error monitor for browsers", async () => {
    const result = await Bun.build({
      entrypoints: ["public/admin/error-ux.js"],
      target: "browser",
      write: false,
    });

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  test("provides direct actions, field errors, and safe diagnostic copy", async () => {
    const source = await Bun.file("public/admin/error-ux.js").text();

    expect(source).toContain("ocp:api-error");
    expect(source).toContain("buildSafeDiagnostic");
    expect(source).toContain("data-error-action");
    expect(source).toContain("aria-invalid");
    expect(source).toContain("fieldErrorMessage");
    expect(source).toContain("copyText(JSON.stringify(currentError.diagnostic");
    expect(source).toContain("button[data-credential-filter='attention']");
  });
});
