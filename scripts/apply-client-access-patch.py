from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "src/admin/adminRoutes.ts",
    '''import {
  authenticateClient,
  adminAuthStatus,
  adminSessionCookie,
  clearAdminSessionCookie,
  generateClientToken,
  hashPassword,
  isAdminInitialized,
  publicTokenPreview,
  setAdminPassword,
  verifyPassword,
} from "../security/auth";''',
    '''import {
  adminAuthStatus,
  adminSessionCookie,
  clearAdminSessionCookie,
  generateClientToken,
  hashPassword,
  initializeClientAccessProtection,
  isAdminInitialized,
  isClientAccessProtectionEnabled,
  matchClientToken,
  publicTokenPreview,
  setAdminPassword,
  setClientAccessProtection,
  verifyPassword,
} from "../security/auth";''',
)
replace_once(
    "src/admin/adminRoutes.ts",
    '''    private readonly cipher: KeyCipher,
    private readonly usageService: UsageService
  ) {}''',
    '''    private readonly cipher: KeyCipher,
    private readonly usageService: UsageService
  ) {
    initializeClientAccessProtection(this.config, this.store);
  }''',
)
replace_once(
    "src/admin/adminRoutes.ts",
    '''    if (path === "/admin/client-key-summary" && req.method === "GET") return json(this.clientKeySummary());
    if (path === "/admin/client-key-test" && req.method === "POST") return this.testClientApiKey(req);
''',
    '''    if (path === "/admin/client-key-summary" && req.method === "GET") return json(this.clientKeySummary());
    if (path === "/admin/client-access" && req.method === "GET") return json(this.clientKeyPublicAccessSummary());
    if (path === "/admin/client-access" && req.method === "PATCH") return this.patchClientAccess(req);
    if (path === "/admin/client-key-test" && req.method === "POST") return this.testClientApiKey(req);
''',
)
replace_once(
    "src/admin/adminRoutes.ts",
    '''  private clientKeySummary() {
    return buildClientKeySummary({
      databaseKeys: this.store.listClientApiKeys(false),
      environmentKeys: this.config.clientApiKeys,
      clientActivity: this.store.getTodayClientStats().map((row) => ({
        clientName: String(row.clientName),
        lastRequestAt: row.lastRequestAt ? String(row.lastRequestAt) : null,
      })),
      decryptDatabaseToken: (key) => this.cipher.decrypt(key.encryptedToken),
    });
  }

  private clientKeyPublicAccessSummary() {
    const { items: _items, ...safe } = this.clientKeySummary();
    return safe;
  }

  private async testClientApiKey(req: Request) {
''',
    '''  private clientKeySummary() {
    const activity = this.store.db
      .query(
        `SELECT clientName, MAX(lastRequestAt) AS lastRequestAt
         FROM client_stats
         GROUP BY clientName
         ORDER BY clientName ASC`
      )
      .all() as Array<Record<string, unknown>>;
    return buildClientKeySummary({
      databaseKeys: this.store.listClientApiKeys(false),
      environmentKeys: this.config.clientApiKeys,
      protectionEnabled: isClientAccessProtectionEnabled(this.config, this.store),
      clientActivity: activity.map((row) => ({
        clientName: String(row.clientName),
        lastRequestAt: row.lastRequestAt ? String(row.lastRequestAt) : null,
      })),
      decryptDatabaseToken: (key) => this.cipher.decrypt(key.encryptedToken),
    });
  }

  private clientKeyPublicAccessSummary() {
    const { items: _items, ...safe } = this.clientKeySummary();
    return safe;
  }

  private async patchClientAccess(req: Request) {
    try {
      const body = await readJson(req);
      if (typeof body.enabled !== "boolean") throw new Error("enabled must be a boolean");
      const summary = this.clientKeySummary();
      if (body.enabled && summary.effectiveTotal < 1) {
        return openAiError(
          409,
          "client_key_required",
          "Create and test at least one Proxy access key before enabling protection"
        );
      }
      setClientAccessProtection(this.store, body.enabled);
      return json(this.clientKeyPublicAccessSummary());
    } catch (error) {
      return openAiError(400, "invalid_client_access_setting", (error as Error).message);
    }
  }

  private async testClientApiKey(req: Request) {
''',
)
replace_once(
    "src/admin/adminRoutes.ts",
    '''      const authentication = authenticateClient(
        new Request("http://localhost/v1/models", {
headers: { authorization: `Bearer ${token}` },
        }),
        this.config,
        this.store,
        this.cipher,
      );
      const authenticationOk = !("response" in authentication);''',
    '''      const authentication = matchClientToken(token, this.config, this.store, this.cipher);
      const authenticationOk = authentication !== null;''',
)

replace_once(
    "public/admin/proxy-key-ux.js",
    '''    protected: "已啟用",
    anonymous: "尚未啟用",
    create: "建立 Proxy 專屬金鑰",''',
    '''    protected: "已啟用",
    anonymous: "尚未啟用",
    enableProtection: "啟用存取保護",
    pauseProtection: "暫停存取保護",
    confirmEnableProtection: "啟用後，沒有有效 Proxy 專屬金鑰的工具會立即無法連線。請先確認新金鑰已測試成功且所有必要工具都已更新。確定啟用嗎？",
    confirmPauseProtection: "暫停後，未帶金鑰的匿名工具也能連線。這會降低存取保護，確定暫停嗎？",
    protectionUpdateFailed: "存取保護設定失敗",
    create: "建立 Proxy 專屬金鑰",''',
)
replace_once(
    "public/admin/proxy-key-ux.js",
    '''    protected: "Enabled",
    anonymous: "Not enabled",
    create: "Create proxy access key",''',
    '''    protected: "Enabled",
    anonymous: "Not enabled",
    enableProtection: "Enable access protection",
    pauseProtection: "Pause access protection",
    confirmEnableProtection: "After enabling protection, clients without a valid Proxy access key immediately lose access. Confirm the new key was tested and required clients were updated. Enable protection?",
    confirmPauseProtection: "Pausing allows anonymous clients without a key to connect and reduces access protection. Pause protection?",
    protectionUpdateFailed: "Access protection update failed",
    create: "Create proxy access key",''',
)
replace_once(
    "public/admin/proxy-key-ux.js",
    '''        <div class="proxyKeyHeaderActions">
          <button class="button primary" type="button" data-proxy-action="${snapshot.authenticated ? "create" : "sign-in"}">${escapeHtml(snapshot.authenticated ? w("create") : w("signIn"))}</button>
          <button class="button" type="button" data-proxy-action="settings">${escapeHtml(w("manage"))}</button>
        </div>''',
    '''        <div class="proxyKeyHeaderActions">
          <button class="button primary" type="button" data-proxy-action="${snapshot.authenticated ? "create" : "sign-in"}">${escapeHtml(snapshot.authenticated ? w("create") : w("signIn"))}</button>
          ${snapshot.authenticated && Number(summary.effectiveTotal || 0) > 0 ? `<button class="button" type="button" data-proxy-action="toggle-protection">${escapeHtml(summary.protectionEnabled ? w("pauseProtection") : w("enableProtection"))}</button>` : ""}
          <button class="button" type="button" data-proxy-action="settings">${escapeHtml(w("manage"))}</button>
        </div>''',
)
replace_once(
    "public/admin/proxy-key-ux.js",
    '''      ${showAnonymousNotice ? `<div class="proxyKeyUpgradeNotice"><strong>${escapeHtml(w("anonymousTitle"))}</strong><p>${escapeHtml(w("anonymousDescription"))}</p><div class="proxyKeyHeaderActions"><button class="button primary" type="button" data-proxy-action="create">${escapeHtml(w("create"))}</button><button class="button" type="button" data-proxy-action="dismiss-security">${escapeHtml(w("later"))}</button></div></div>` : ""}''',
    '''      ${showAnonymousNotice ? `<div class="proxyKeyUpgradeNotice"><strong>${escapeHtml(w("anonymousTitle"))}</strong><p>${escapeHtml(w("anonymousDescription"))}</p><div class="proxyKeyHeaderActions"><button class="button primary" type="button" data-proxy-action="${Number(summary.effectiveTotal || 0) > 0 ? "toggle-protection" : "create"}">${escapeHtml(Number(summary.effectiveTotal || 0) > 0 ? w("enableProtection") : w("create"))}</button><button class="button" type="button" data-proxy-action="dismiss-security">${escapeHtml(w("later"))}</button></div></div>` : ""}''',
)
replace_once(
    "public/admin/proxy-key-ux.js",
    '''  const item = findItem(id);
  if (action === "create") {''',
    '''  const item = findItem(id);
  if (action === "toggle-protection") {
    const next = snapshot.summary?.protectionEnabled !== true;
    const confirmation = next ? w("confirmEnableProtection") : w("confirmPauseProtection");
    if (!window.confirm(confirmation)) return;
    try {
      await request("/admin/client-access", {
        method: "PATCH",
        body: JSON.stringify({ enabled: next }),
      });
      localStorage.removeItem(securityNoticeKey);
      scheduleLoad(100);
    } catch (error) {
      window.alert(`${w("protectionUpdateFailed")}：${error.message}`);
    }
    return;
  }
  if (action === "create") {''',
)

replace_once(
    "tests/integration.test.ts",
    '''    const denied = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-oss", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(denied.status).toBe(401);

    const completion = await fetch(`${app.baseUrl}/v1/chat/completions`, {''',
    '''    const transitionAnonymous = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-oss", messages: [{ role: "user", content: "transition" }] }),
    });
    expect(transitionAnonymous.status).toBe(200);

    const enableProtection = await fetch(`${app.baseUrl}/admin/client-access`, {
      method: "PATCH",
      headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableProtection.status).toBe(200);
    expect((await enableProtection.json()).protectionEnabled).toBe(true);

    const denied = await fetch(`${app.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-oss", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(denied.status).toBe(401);

    const completion = await fetch(`${app.baseUrl}/v1/chat/completions`, {''',
)

replace_once(
    "tests/proxy-client-key-upgrade.test.ts",
    '''    expect(summary.items[0].tokenPreview).toBe(created.clientKey.tokenPreview);
    expect(JSON.stringify(summary)).not.toContain(token);

    const revealResponse = await fetch(`${app.baseUrl}/admin/client-keys/${created.clientKey.id}/reveal`, {''',
    '''    expect(summary.items[0].tokenPreview).toBe(created.clientKey.tokenPreview);
    expect(summary).toMatchObject({
      protectionEnabled: false,
      anonymousMode: true,
      effectiveTotal: 1,
    });
    expect(JSON.stringify(summary)).not.toContain(token);

    const transitionAnonymous = await fetch(`${app.baseUrl}/v1/models`);
    expect(transitionAnonymous.status).toBe(200);

    const enableProtection = await fetch(`${app.baseUrl}/admin/client-access`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableProtection.status).toBe(200);
    expect(await enableProtection.json()).toMatchObject({
      protectionEnabled: true,
      anonymousMode: false,
      effectiveTotal: 1,
    });

    const missingTokenDenied = await fetch(`${app.baseUrl}/v1/models`);
    expect(missingTokenDenied.status).toBe(401);

    const revealResponse = await fetch(`${app.baseUrl}/admin/client-keys/${created.clientKey.id}/reveal`, {''',
)
replace_once(
    "tests/proxy-client-key-upgrade.test.ts",
    '''    expect(invalid.authentication.ok).toBe(false);
    expect(invalid.upstream.ok).toBe(true);
    expect(invalid.models.ok).toBe(true);
  });
});''',
    '''    expect(invalid.authentication.ok).toBe(false);
    expect(invalid.upstream.ok).toBe(true);
    expect(invalid.models.ok).toBe(true);
  });

  test("cannot enable protection before at least one usable key exists", async () => {
    const app = createApp(config());

    const response = await fetch(`${app.baseUrl}/admin/client-access`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.type).toBe("client_key_required");
    const stats = await (await fetch(`${app.baseUrl}/admin/stats`)).json();
    expect(stats.clientAccess.anonymousMode).toBe(true);
  });
});''',
)

replace_once(
    "docs/proxy-key-upgrade.md",
    '''4. 逐一更新 OpenClaw、Kilo Code、VS Code 或其他工具。
5. 回到管理台確認新金鑰已有最近使用紀錄。
6. 保留舊金鑰一段時間，確認沒有遺漏的工具。
7. 再停用舊金鑰；確認服務正常後才刪除。''',
    '''4. 逐一更新 OpenClaw、Kilo Code、VS Code 或其他工具。
5. 回到管理台確認新金鑰已有最近使用紀錄。
6. 若原本是匿名部署，按下「啟用存取保護」並再次確認；在此之前，建立新金鑰不會讓既有匿名工具中斷。
7. 保留舊金鑰一段時間，確認沒有遺漏的工具。
8. 再停用舊金鑰；確認服務正常後才刪除。''',
)
replace_once(
    "docs/proxy-key-upgrade.md",
    '''管理台不會直接編輯環境變數金鑰，也不會顯示完整 token。''',
    '''管理台不會直接編輯環境變數金鑰，也不會顯示完整 token。

## 存取保護開關

- 從舊版升級且原本已有資料庫或環境變數 Client API Key：首次啟動會維持既有的強制驗證行為。
- 從舊版升級且原本沒有 Client API Key：維持匿名模式。
- 在匿名模式建立第一把新金鑰：只建立與測試，不會自動啟用強制驗證。
- 使用者確認工具已更新後，才在首頁按「啟用存取保護」。
- 「暫停存取保護」會重新允許匿名連線，屬降低安全性的操作，管理台會再次確認。''',
)
replace_once(
    "docs/changelog.md",
    '''- readiness 區分「服務可用」與「已啟用存取保護」，既有匿名部署升級後不中斷。
- 新增新舊金鑰並存的安全替換與環境變數遷移引導。''',
    '''- readiness 區分「服務可用」與「已啟用存取保護」，既有匿名部署升級後不中斷。
- 新增明確的存取保護開關；匿名部署建立第一把金鑰後不會立即阻斷舊工具，需由使用者確認才啟用強制驗證。
- 新增新舊金鑰並存的安全替換與環境變數遷移引導。''',
)
