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

  test("keeps an operational anonymous deployment available while recommending protection", () => {
    const result = deriveServiceReadiness({
      initialized: true,
      authenticated: true,
      totalKeys: 1,
      availableKeys: 1,
      modelCount: 3,
      anonymousMode: true,
    });

    expect(result.status).toBe("partial");
    expect(result.nextAction).toBe("create-client-key");
    expect(result.requiredComplete).toBe(true);
    expect(result.securityComplete).toBe(false);
    expect(result.anonymousMode).toBe(true);
  });

  test("counts an environment-managed key as completed access protection", () => {
    const result = deriveServiceReadiness({
      initialized: true,
      authenticated: true,
      totalKeys: 1,
      availableKeys: 1,
      enabledClientKeys: 1,
      protectionEnabled: true,
      modelCount: 3,
    });

    expect(result.status).toBe("ready");
    expect(result.nextAction).toBe("none");
    expect(result.securityComplete).toBe(true);
    expect(result.anonymousMode).toBe(false);
  });

  test("does not call a configured but unusable key anonymous mode", () => {
    const result = deriveServiceReadiness({
      initialized: true,
      authenticated: true,
      totalKeys: 1,
      availableKeys: 1,
      enabledClientKeys: 0,
      protectionEnabled: true,
      anonymousMode: false,
      modelCount: 3,
    });

    expect(result.status).toBe("partial");
    expect(result.nextAction).toBe("create-client-key");
    expect(result.protectionEnabled).toBe(true);
    expect(result.anonymousMode).toBe(false);
  });

  test("distinguishes no available upstream key from incomplete setup", () => {
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

  test("reports partial availability when only some upstream keys are usable", () => {
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

  test("reports ready when operational and security checks pass", () => {
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
    expect(result.securityComplete).toBe(true);
    expect(result.steps.usageCookieReady).toBe(false);
  });
});

describe("admin onboarding and proxy key assets", () => {
  test("injects service status, Proxy key roots, and enhancement assets", async () => {
    const response = await routerForStaticAdmin().handle(new Request("http://localhost/admin"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('id="serviceReadinessRoot"');
    expect(html).toContain('id="onboardingRoot"');
    expect(html).toContain('id="proxyKeyRoot"');
    expect(html).toContain('/admin/onboarding.css?v=1.4.0-onboarding');
    expect(html).toContain('/admin/accessibility.css?v=1.4.0-accessibility');
    expect(html).toContain('/admin/proxy-key-ux.css?v=1.6.0-proxy-keys');
    expect(html).toContain('/admin/onboarding.js?v=1.4.0-onboarding');
    expect(html).toContain('/admin/proxy-key-ux.js?v=1.6.0-proxy-keys');
  });

  test("serves every onboarding and Proxy key asset without admin authentication", async () => {
    const router = routerForStaticAdmin();
    const assets = [
      ["/admin/onboarding.css", "text/css"],
      ["/admin/accessibility.css", "text/css"],
      ["/admin/onboarding.js", "text/javascript"],
      ["/admin/readiness.js", "text/javascript"],
      ["/admin/proxy-key-ux.css", "text/css"],
      ["/admin/proxy-key-ux.js", "text/javascript"],
    ];

    for (const [path, contentType] of assets) {
      const response = await router.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect((await response.text()).length).toBeGreaterThan(20);
    }
  });

  test("builds onboarding and Proxy key entrypoints for browsers", async () => {
    for (const entrypoint of ["public/admin/onboarding.js", "public/admin/proxy-key-ux.js"]) {
      const result = await Bun.build({
        entrypoints: [entrypoint],
        target: "browser",
        write: false,
      });

      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(0);
      expect(result.outputs.length).toBeGreaterThan(0);
    }
  });

  test("keeps mobile controls readable and never restores persistent token reveal", async () => {
    const accessibilityCss = await Bun.file("public/admin/accessibility.css").text();
    const proxyCss = await Bun.file("public/admin/proxy-key-ux.css").text();
    const proxyJs = await Bun.file("public/admin/proxy-key-ux.js").text();

    expect(accessibilityCss).toContain("button:focus-visible");
    expect(accessibilityCss).toContain("min-height: 44px");
    expect(accessibilityCss).toContain("@media (max-width: 560px)");
    expect(accessibilityCss).toContain("@media (max-width: 360px)");
    expect(accessibilityCss).toContain("overflow-x: auto");
    expect(accessibilityCss).toContain("prefers-reduced-motion: reduce");
    expect(accessibilityCss).toContain(".status.unknown");
    expect(accessibilityCss).not.toContain(".status.available,\n.status.unknown");
    expect(proxyCss).toContain("@media (max-width: 560px)");
    expect(proxyCss).toContain("min-height: 44px");
    expect(proxyJs).not.toContain("/reveal");
    expect(proxyJs).not.toContain('localStorage.setItem("token"');
    expect(proxyJs).not.toContain("sessionStorage");
  });

  test("distinguishes an existing signed-out admin from first-time password setup", async () => {
    const onboarding = await Bun.file("public/admin/onboarding.js").text();

    expect(onboarding).toContain('adminLoginStep: "登入管理台"');
    expect(onboarding).toContain('adminLoginHint: "管理密碼已設定，請使用既有密碼登入。"');
    expect(onboarding).toContain("snapshot.initialized = authStatus.initialized === true");
    expect(onboarding).toContain('snapshot.initialized ? "adminLoginStep" : "adminStep"');
  });

  test("keeps the one-time token dialog inside the viewport without horizontal scrolling", async () => {
    const script = await Bun.file("public/admin/proxy-key-ux.js").text();
    const css = await Bun.file("public/admin/proxy-key-ux.css").text();

    expect(script.match(/className = "proxyKeyModal"/g)?.length).toBe(2);
    expect(css).toContain(".proxyKeyModal {");
    expect(css).toContain("max-width: calc(100vw - 24px)");
    expect(css).toContain("overflow: hidden");
    expect(css).toContain("word-break: break-all");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
  });

});
