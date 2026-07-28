import { describe, expect, test } from "bun:test";
import {
  deriveCredentialKeyState,
  deriveUsageCookieState,
  matchesCredentialFilter,
  summarizeCredentials,
} from "../public/admin/credential-status.js";
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

describe("credential status model", () => {
  test("separates available, blocked, invalid, and disabled upstream keys", () => {
    expect(deriveCredentialKeyState({ status: "available", enabled: true }).category).toBe("available");
    expect(deriveCredentialKeyState({ status: "session_blocked", enabled: true }).label).toBe("session_blocked");
    expect(deriveCredentialKeyState({ status: "weekly_blocked", enabled: true }).label).toBe("weekly_blocked");
    expect(deriveCredentialKeyState({ status: "invalid", enabled: true }).tone).toBe("danger");
    expect(deriveCredentialKeyState({ status: "available", enabled: false }).category).toBe("disabled");
  });

  test("preserves recovery time for cooldown and quota states", () => {
    const recoveryAt = "2026-07-28T16:30:00.000Z";
    expect(deriveCredentialKeyState({ status: "cooling_down", cooldownUntil: recoveryAt }).recoveryAt).toBe(recoveryAt);
    expect(deriveCredentialKeyState({ status: "weekly_blocked", nextEligibleAt: recoveryAt }).recoveryAt).toBe(recoveryAt);
  });

  test("treats a missing or failed Usage Cookie as usage-only state", () => {
    expect(deriveUsageCookieState({ hasCookie: false }).label).toBe("no_cookie");
    expect(deriveUsageCookieState({ hasCookie: true }).label).toBe("usage_pending");
    expect(deriveUsageCookieState({ hasCookie: true, lastError: "expired" }).label).toBe("usage_error");
    expect(deriveCredentialKeyState({ status: "available", hasCookie: false }).category).toBe("available");
  });

  test("filters cards without changing their underlying status", () => {
    const available = { status: "available", enabled: true, hasCookie: false };
    const invalid = { status: "invalid", enabled: true, hasCookie: true };
    expect(matchesCredentialFilter(available, "available")).toBe(true);
    expect(matchesCredentialFilter(available, "no-cookie")).toBe(true);
    expect(matchesCredentialFilter(invalid, "attention")).toBe(true);
    expect(matchesCredentialFilter(invalid, "available")).toBe(false);
  });

  test("summarizes all three credential types", () => {
    const summary = summarizeCredentials({
      keyCards: [
        { status: "available", enabled: true, hasCookie: true, fetchedAt: "2026-07-28T00:00:00Z" },
        { status: "invalid", enabled: true, hasCookie: false },
      ],
      clientKeys: [{ enabled: true }, { enabled: false }],
    });
    expect(summary).toEqual({
      upstreamTotal: 2,
      upstreamAvailable: 1,
      upstreamAttention: 1,
      usageCookies: 1,
      clientKeysEnabled: 1,
    });
  });
});

describe("credential management assets", () => {
  test("injects credential guide, key filters, styles, and browser module", async () => {
    const response = await routerForStaticAdmin().handle(new Request("http://localhost/admin"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('id="credentialGuideRoot"');
    expect(html).toContain('id="keyFilterRoot"');
    expect(html).toContain('/admin/credential-ux.css?v=1.4.0-credentials');
    expect(html).toContain('/admin/credential-ux.js?v=1.4.0-credentials');
  });

  test("serves credential modules without admin authentication", async () => {
    const router = routerForStaticAdmin();
    const assets = [
      ["/admin/credential-ux.css", "text/css"],
      ["/admin/credential-ux.js", "text/javascript"],
      ["/admin/credential-status.js", "text/javascript"],
    ];

    for (const [path, contentType] of assets) {
      const response = await router.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect((await response.text()).length).toBeGreaterThan(20);
    }
  });

  test("builds credential UX for browsers", async () => {
    const result = await Bun.build({
      entrypoints: ["public/admin/credential-ux.js"],
      target: "browser",
      write: false,
    });

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  test("uses one-time token display and automatic upstream verification", async () => {
    const source = await Bun.file("public/admin/credential-ux.js").text();

    expect(source).toContain("showOneTimeToken");
    expect(source).toContain("clearTokenDialog");
    expect(source).toContain("data-client-action='copy'");
    expect(source).toContain("stopImmediatePropagation");
    expect(source).toContain("tryAutoVerifyNewKey");
    expect(source).toContain("/test`");
  });
});
