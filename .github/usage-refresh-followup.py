from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}\n--- OLD ---\n{old[:800]}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "src/web/webService.ts",
    '        if (upstream.status === 429) this.keyPool.notifyUsageRateLimit(key.id);\n',
    '',
)

replace_once(
    "src/usage/usageService.ts",
    '''        if (queue.length && this.config.usageRefreshJitterSeconds > 0) {
await new Promise((resolve) => setTimeout(resolve, this.jitterMs()));
        }''',
    '''        if (queue.length && this.config.usageRefreshJitterSeconds > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.jitterMs()));
        }''',
)

replace_once(
    "src/admin/adminRoutes.ts",
    '''    const refreshSummary = forceRefresh
      ? await this.usageService.refreshMany(
keys
  .filter((key) => key.enabled && Boolean(key.encryptedOllamaUsageCookie || this.config.ollamaUsageCookie))
  .map((key) => key.id)
        )
      : null;''',
    '''    const refreshSummary = forceRefresh
      ? await this.usageService.refreshMany(
          keys
            .filter((key) => key.enabled && Boolean(key.encryptedOllamaUsageCookie || this.config.ollamaUsageCookie))
            .map((key) => key.id)
        )
      : null;''',
)

replace_once(
    "tests/integration.test.ts",
    '''  test("Per-key usage refresh probes and restores an invalid key when the key works", async () => {
    const seen: string[] = [];
    const upstreamBaseUrl = createMockUpstream((req) => {
      const url = new URL(req.url);
      seen.push(`${url.pathname}:${req.headers.get("authorization") || req.headers.get("cookie") || ""}`);
      if (url.pathname === "/settings") {
        return new Response(
          [
            '<div data-usage-track aria-label="10% used"></div>',
            '<div data-usage-track aria-label="20% used"></div>',
          ].join(""),
          { headers: { "content-type": "text/html" } }
        );
      }
      if (url.pathname === "/v1/models") {
        return Response.json({ object: "list", data: [{ id: "llama", object: "model" }] });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    });
    const app = createApp(config({ upstreamBaseUrl, ollamaCloudUsageUrl: `${upstreamBaseUrl}/settings` }));
    const key = app.keyPool.create({ name: "stored-invalid", apiKey: "good-key", ollamaUsageCookie: "cookie-value" });
    app.store.patchKey(key.id, {
      status: "invalid",
      blockReason: "invalid_api_key",
      consecutiveFailures: 2,
    });

    const refresh = await fetch(`${app.baseUrl}/admin/keys/${key.id}/usage-refresh`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token" },
    });
    const body = await refresh.json();
    const updated = app.store.getKey(key.id, true)!;

    expect(refresh.status).toBe(200);
    expect(seen).toContain("/settings:__Secure-session=cookie-value");
    expect(seen).toContain("/v1/models:Bearer good-key");
    expect(body.key.status).toBe("available");
    expect(body.probe.ok).toBe(true);
    expect(updated.status).toBe("available");
    expect(updated.blockReason).toBe("none");
    expect(updated.consecutiveFailures).toBe(0);
  });''',
    '''  test("Per-key usage refresh only refreshes Cookie usage and never changes API-key validation state", async () => {
    const seen: string[] = [];
    const upstreamBaseUrl = createMockUpstream((req) => {
      const url = new URL(req.url);
      seen.push(`${url.pathname}:${req.headers.get("authorization") || req.headers.get("cookie") || ""}`);
      if (url.pathname === "/settings") {
        return new Response(
          [
            '<div data-usage-track aria-label="10% used"></div>',
            '<div data-usage-track aria-label="20% used"></div>',
          ].join(""),
          { headers: { "content-type": "text/html" } }
        );
      }
      if (url.pathname === "/v1/models") {
        return Response.json({ object: "list", data: [{ id: "llama", object: "model" }] });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    });
    const app = createApp(config({ upstreamBaseUrl, ollamaCloudUsageUrl: `${upstreamBaseUrl}/settings` }));
    const key = app.keyPool.create({ name: "stored-invalid", apiKey: "good-key", ollamaUsageCookie: "cookie-value" });
    app.store.patchKey(key.id, {
      status: "invalid",
      blockReason: "invalid_api_key",
      consecutiveFailures: 2,
    });

    const refresh = await fetch(`${app.baseUrl}/admin/keys/${key.id}/usage-refresh`, {
      method: "POST",
      headers: { authorization: "Bearer admin-token" },
    });
    const body = await refresh.json();
    const updated = app.store.getKey(key.id, true)!;

    expect(refresh.status).toBe(200);
    expect(seen).toEqual(["/settings:__Secure-session=cookie-value"]);
    expect(body.key.status).toBe("invalid");
    expect(body.probe).toBeUndefined();
    expect(updated.status).toBe("invalid");
    expect(updated.blockReason).toBe("invalid_api_key");
    expect(updated.consecutiveFailures).toBe(2);
  });''',
)

replace_once(
    "tests/integration.test.ts",
    '''  test("debounce coalesces traffic refreshes and a rate limit accelerates the same key only", async () => {
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const cookies: string[] = [];
    const settingsBaseUrl = createMockUpstream((req) => {
      cookies.push(req.headers.get("cookie") || "");
      return new Response(
        `<div data-usage-track aria-label="10% used"><span class="local-time" data-time="${resetAt}"></span></div>` +
        `<div data-usage-track aria-label="20% used"><span class="local-time" data-time="${resetAt}"></span></div>`
      );
    });
    const app = createApp(config({
      ollamaCloudUsageUrl: `${settingsBaseUrl}/settings`,
      usageRefreshDebounceSeconds: 0.2,
      usageRefreshJitterSeconds: 0,
    }));
    const first = app.keyPool.create({ name: "first", apiKey: "first-key", ollamaUsageCookie: "first-cookie" });
    app.keyPool.create({ name: "second", apiKey: "second-key", ollamaUsageCookie: "second-cookie" });

    app.usageService.recordSuccess(first.id);
    app.usageService.recordSuccess(first.id);
    app.usageService.recordSuccess(first.id);
    app.usageService.notifyRateLimit(first.id);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(cookies).toEqual(["__Secure-session=first-cookie"]);
  });''',
    '''  test("successful traffic uses single-flight and the 10-minute TTL for only the successful key", async () => {
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const cookies: string[] = [];
    const settingsBaseUrl = createMockUpstream((req) => {
      cookies.push(req.headers.get("cookie") || "");
      return new Response(
        `<div data-usage-track aria-label="10% used"><span class="local-time" data-time="${resetAt}"></span></div>` +
        `<div data-usage-track aria-label="20% used"><span class="local-time" data-time="${resetAt}"></span></div>`
      );
    });
    const app = createApp(config({
      ollamaCloudUsageUrl: `${settingsBaseUrl}/settings`,
      ollamaUsageRefreshTtlSeconds: 600,
      usageRefreshJitterSeconds: 0,
    }));
    const first = app.keyPool.create({ name: "first", apiKey: "first-key", ollamaUsageCookie: "first-cookie" });
    app.keyPool.create({ name: "second", apiKey: "second-key", ollamaUsageCookie: "second-cookie" });

    app.usageService.recordSuccess(first.id);
    app.usageService.recordSuccess(first.id);
    app.usageService.recordSuccess(first.id);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(cookies).toEqual(["__Secure-session=first-cookie"]);
  });''',
)

replace_once(
    "tests/integration.test.ts",
    '''  test("cookie replacement schedules only that account and disabled usage API records no ledger", async () => {
    let requests = 0;
    const settingsBaseUrl = createMockUpstream(() => {
      requests += 1;
      return new Response('<div data-usage-track aria-label="10% used"></div>');
    });
    const enabled = createApp(config({ ollamaCloudUsageUrl: `${settingsBaseUrl}/settings`, usageRefreshJitterSeconds: 0 }));
    const created = enabled.keyPool.create({ name: "cookie", apiKey: "cookie-key" });
    const patch = await fetch(`${enabled.baseUrl}/admin/keys/${created.id}`, {
      method: "PATCH",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ ollamaUsageCookie: "replacement-cookie" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const disabled = createApp(config({ usageApiEnabled: false }));
    const disabledKey = disabled.keyPool.create({ name: "disabled", apiKey: "disabled-key" });
    disabled.usageService.recordSuccess(disabledKey.id, { totalTokens: 99 });
    const disabledResponse = await fetch(`${disabled.baseUrl}/api/usage`);

    expect(patch.status).toBe(200);
    expect(requests).toBe(1);
    expect(disabledResponse.status).toBe(404);
    expect(disabled.store.getUsageLedgerTotals(disabledKey.id).units).toBe(0);
  });''',
    '''  test("cookie replacement clears cached usage without fetching, and disabled usage API records no ledger", async () => {
    let requests = 0;
    const settingsBaseUrl = createMockUpstream(() => {
      requests += 1;
      return new Response('<div data-usage-track aria-label="10% used"></div>');
    });
    const enabled = createApp(config({ ollamaCloudUsageUrl: `${settingsBaseUrl}/settings`, usageRefreshJitterSeconds: 0 }));
    const created = enabled.keyPool.create({ name: "cookie", apiKey: "cookie-key" });
    const patch = await fetch(`${enabled.baseUrl}/admin/keys/${created.id}`, {
      method: "PATCH",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ ollamaUsageCookie: "replacement-cookie" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const disabled = createApp(config({ usageApiEnabled: false }));
    const disabledKey = disabled.keyPool.create({ name: "disabled", apiKey: "disabled-key" });
    disabled.usageService.recordSuccess(disabledKey.id, { totalTokens: 99 });
    const disabledResponse = await fetch(`${disabled.baseUrl}/api/usage`);

    expect(patch.status).toBe(200);
    expect(requests).toBe(0);
    expect(enabled.store.getUsageAccountState(created.id)?.officialCheckedAt).toBeNull();
    expect(disabledResponse.status).toBe(404);
    expect(disabled.store.getUsageLedgerTotals(disabledKey.id).units).toBe(0);
  });''',
)

replace_once(
    "tests/integration.test.ts",
    '''  test("an upstream 429 schedules official refresh for only the attempted key", async () => {
    const upstreamBaseUrl = createMockUpstream(() => Response.json({ error: "rate limit" }, { status: 429 }));
    const refreshedCookies: string[] = [];
    const usageBaseUrl = createMockUpstream((req) => {
      refreshedCookies.push(req.headers.get("cookie") || "");
      return new Response('<div data-usage-track aria-label="10% used"></div>');
    });
    const app = createApp(config({
      upstreamBaseUrl,
      ollamaCloudUsageUrl: `${usageBaseUrl}/settings`,
      maxKeyAttemptsPerRequest: 1,
      usageRefreshJitterSeconds: 0,
    }));
    app.keyPool.create({ name: "first", apiKey: "first-key", ollamaUsageCookie: "first-cookie" });
    app.keyPool.create({ name: "second", apiKey: "second-key", ollamaUsageCookie: "second-cookie" });

    const response = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer client-token", "content-type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(response.status).toBe(503);
    expect(refreshedCookies).toEqual(["__Secure-session=first-cookie"]);
  });''',
    '''  test("an upstream 429 changes key availability but does not call the Usage Cookie endpoint", async () => {
    const upstreamBaseUrl = createMockUpstream(() => Response.json({ error: "rate limit" }, { status: 429 }));
    const refreshedCookies: string[] = [];
    const usageBaseUrl = createMockUpstream((req) => {
      refreshedCookies.push(req.headers.get("cookie") || "");
      return new Response('<div data-usage-track aria-label="10% used"></div>');
    });
    const app = createApp(config({
      upstreamBaseUrl,
      ollamaCloudUsageUrl: `${usageBaseUrl}/settings`,
      maxKeyAttemptsPerRequest: 1,
      usageRefreshJitterSeconds: 0,
    }));
    app.keyPool.create({ name: "first", apiKey: "first-key", ollamaUsageCookie: "first-cookie" });
    app.keyPool.create({ name: "second", apiKey: "second-key", ollamaUsageCookie: "second-cookie" });

    const response = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer client-token", "content-type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(response.status).toBe(503);
    expect(refreshedCookies).toEqual([]);
  });''',
)

replace_once(
    "public/admin/app.js",
    '''    refreshOfficialUsageDone: (succeeded, failed) => `全部更新完成：${succeeded} 成功，${failed} 失敗`,''',
    '''    refreshOfficialUsageDone: (succeeded, failed, completedAt) => `全部更新完成：${succeeded} 成功，${failed} 失敗${completedAt ? `，完成時間 ${new Date(completedAt).toLocaleString()}` : ""}`,''',
)

replace_once(
    "public/admin/app.js",
    '''    refreshOfficialUsageDone: (succeeded, failed) => `Refresh complete: ${succeeded} succeeded, ${failed} failed`,''',
    '''    refreshOfficialUsageDone: (succeeded, failed, completedAt) => `Refresh complete: ${succeeded} succeeded, ${failed} failed${completedAt ? ` at ${new Date(completedAt).toLocaleString()}` : ""}`,''',
)

replace_once(
    "public/admin/app.js",
    '''    showNotice(t("refreshOfficialUsageDone")(summary.succeeded || 0, summary.failed || 0), summary.failed ? "warning" : "success");''',
    '''    showNotice(
      t("refreshOfficialUsageDone")(summary.succeeded || 0, summary.failed || 0, summary.completed_at || null),
      summary.failed ? "warning" : "success"
    );''',
)
