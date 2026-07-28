import { describe, expect, test } from "bun:test";
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

describe("mobile key card layout", () => {
  test("loads the mobile key card stylesheet after shared admin styles", async () => {
    const response = await routerForStaticAdmin().handle(new Request("http://localhost/admin"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('/admin/mobile-key-card.css?v=1.5.1-mobile-key-card');
    expect(html.indexOf("/admin/mobile-key-card.css")).toBeGreaterThan(html.indexOf("/admin/accessibility.css"));
    expect(html.indexOf("/admin/mobile-key-card.css")).toBeGreaterThan(html.indexOf("/admin/credential-ux.css"));
  });

  test("serves the mobile stylesheet without admin authentication", async () => {
    const response = await routerForStaticAdmin().handle(
      new Request("http://localhost/admin/mobile-key-card.css"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect((await response.text()).length).toBeGreaterThan(100);
  });

  test("uses separate mobile header areas and compact two-column actions", async () => {
    const css = await Bun.file("public/admin/mobile-key-card.css").text();

    expect(css).toContain('@media (max-width: 560px)');
    expect(css).toContain('"status identity toggle"');
    expect(css).toContain('"status badge badge"');
    expect(css).toContain("grid-area: badge");
    expect(css).toContain("grid-area: toggle");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toContain(".quotaActionsPrimary .button:nth-child(3)");
    expect(css).toContain(".quotaActionsSecondary .button.danger");
    expect(css).toContain("min-height: 44px");
  });
});
