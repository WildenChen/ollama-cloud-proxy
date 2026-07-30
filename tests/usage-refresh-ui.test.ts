import { describe, expect, test } from "bun:test";

describe("usage refresh UI contract", () => {
  test("uses a 10-minute default and reports manual refresh completion", async () => {
    const envSource = await Bun.file("src/config/env.ts").text();
    const adminSource = await Bun.file("public/admin/app.js").text();

    expect(envSource).toContain('OLLAMA_USAGE_REFRESH_TTL_SECONDS", 600');
    expect(adminSource).toContain('summary.completed_at || null');
    expect(adminSource).toContain('refreshingOfficialUsage');
    expect(adminSource).toContain('全部更新完成');
  });
});
