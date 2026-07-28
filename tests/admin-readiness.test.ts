import { describe, expect, test } from "bun:test";
import { deriveServiceReadiness } from "../public/admin/readiness.js";
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

describe("service readiness", () => {
  test("guides a signed-in empty installation to add its first upstream key", () => {
    const result = deriveServiceReadiness({
      initialized: true,
      authenticated: true,
    });

    expect(result.status).toBe("setup");
    expect(result.nextAction).toBe("add-key");
    expect(result.requiredComplete).toBe(false);
  });

  test("requires a Client API key after an upstream key is available", () => {
    const result = deriveServiceReadiness({
      initialized: true,
      authenticated: true,
      totalKeys: 1,
      availableKeys: 1,
      modelCount: 3,
    });

    expect(result.status).toBe("setup");
    expect(result.nextAction).toBe("create-client-key");
  });

  test("distinguishes no available key from incomplete setup", () => {
    const result = deriveServiceReadiness({
      initialized: true,
      authenticated: true,
      totalKeys: 2,
      availableKeys: 0,
      enabledClientKeys: 1,
      modelCount: 3,
    });

    expect(result.status).toBe("unavailable");
    expect(result.nextAction).toBe("refresh");
  });

  test("reports partial availability when only some keys are usable", () => {
    const result = deriveServiceReadiness({
      initialized: true,
      authenticated: true,
      totalKeys: 3,
      availableKeys: 2,
      enabledClientKeys: 1,
      modelCount: 5,
    });

    expect(result.status).toBe("partial");
    expect(result.nextAction).toBe("review-keys");
    expect(result.requiredComplete).toBe(true);
  });

  test("reports ready when all required checks pass", () => {
    const result = deriveServiceReadiness({
      initialized: true,
      authenticated: true,
      totalKeys: 2,
      availableKeys: 2,
      enabledClientKeys: 1,
      modelCount: 5,
    });

    expect(result.status).toBe("ready");
    expect(result.requiredComplete).toBe(true);
    expect(result.steps.usageCookieReady).toBe(false);
  });
});

describe("admin onboarding assets", () => {
  test("injects the service status roots and admin enhancement styles", async () => {
    const response = await routerForStaticAdmin().handle(new Request("http://localhost/admin"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('id="serviceReadinessRoot"');
    expect(html).toContain('id="onboardingRoot"');
    expect(html).toContain('/admin/onboarding.css?v=1.4.0-onboarding');
    expect(html).toContain('/admin/accessibility.css?v=1.4.0-accessibility');
    expect(html).toContain('/admin/onboarding.js?v=1.4.0-onboarding');
  });

  test("serves every admin enhancement asset without admin authentication", async () => {
    const router = routerForStaticAdmin();
    const assets = [
      ["/admin/onboarding.css", "text/css"],
      ["/admin/accessibility.css", "text/css"],
      ["/admin/onboarding.js", "text/javascript"],
      ["/admin/readiness.js", "text/javascript"],
    ];

    for (const [path, contentType] of assets) {
      const response = await router.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect((await response.text()).length).toBeGreaterThan(20);
    }
  });

  test("builds the onboarding entrypoint for browsers", async () => {
    const result = await Bun.build({
      entrypoints: ["public/admin/onboarding.js"],
      target: "browser",
      write: false,
    });

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  test("keeps mobile controls readable and keyboard focus visible", async () => {
    const css = await Bun.file("public/admin/accessibility.css").text();

    expect(css).toContain("button:focus-visible");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("@media (max-width: 560px)");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(".status.unknown");
    expect(css).not.toContain(".status.available,\n.status.unknown");
  });
});
