import { describe, expect, test } from "bun:test";

describe("Responses API public contract", () => {
  test("keeps the route, non-stateful validation, and README examples visible", async () => {
    const proxySource = await Bun.file("src/proxy/proxyHandler.ts").text();
    const readme = await Bun.file("README.md").text();

    expect(proxySource).toContain('(path === "/v1/responses" && req.method === "POST")');
    expect(proxySource).toContain('"unsupported_responses_state"');
    expect(proxySource).toContain('previous_response_id');
    expect(proxySource).toContain('conversation');
    expect(readme).toContain("POST /v1/responses");
    expect(readme).toContain("OpenAI Responses API");
    expect(readme).toContain("Non-stateful 限制");
  });
});
