from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file.write_text(text.replace(old, new, 1))


# Do not describe an existing password as missing while the user is merely signed out.
replace_once(
    "public/admin/onboarding.js",
    '    adminStep: "建立管理密碼並登入",\n    adminHint: "保護管理設定與測試操作。",\n',
    '    adminStep: "建立管理密碼並登入",\n    adminHint: "保護管理設定與測試操作。",\n    adminLoginStep: "登入管理台",\n    adminLoginHint: "管理密碼已設定，請使用既有密碼登入。",\n',
)
replace_once(
    "public/admin/onboarding.js",
    '    adminStep: "Create an admin password and sign in",\n    adminHint: "Protects settings and test actions.",\n',
    '    adminStep: "Create an admin password and sign in",\n    adminHint: "Protects settings and test actions.",\n    adminLoginStep: "Sign in to Admin",\n    adminLoginHint: "An admin password already exists. Sign in with the existing password.",\n',
)
replace_once(
    "public/admin/onboarding.js",
    '    snapshot = deriveServiceReadiness({\n      initialized: authStatus.initialized,\n',
    '    snapshot = deriveServiceReadiness({\n      initialized: authStatus.initialized,\n',
)
replace_once(
    "public/admin/onboarding.js",
    '      usageCookieCount: totals?.official?.available ?? 0,\n    });\n',
    '      usageCookieCount: totals?.official?.available ?? 0,\n    });\n    snapshot.initialized = authStatus.initialized === true;\n',
)
replace_once(
    "public/admin/onboarding.js",
    '    ["adminReady", "adminStep", "adminHint", "sign-in"],\n',
    '    ["adminReady", snapshot.initialized ? "adminLoginStep" : "adminStep", snapshot.initialized ? "adminLoginHint" : "adminHint", "sign-in"],\n',
)

# Give the dialog element an explicit responsive class instead of sizing only its form.
replace_once(
    "public/admin/proxy-key-ux.js",
    '  createDialog = document.createElement("dialog");\n  createDialog.innerHTML = `\n',
    '  createDialog = document.createElement("dialog");\n  createDialog.className = "proxyKeyModal";\n  createDialog.innerHTML = `\n',
)
replace_once(
    "public/admin/proxy-key-ux.js",
    '  tokenDialog = document.createElement("dialog");\n  tokenDialog.innerHTML = `\n',
    '  tokenDialog = document.createElement("dialog");\n  tokenDialog.className = "proxyKeyModal";\n  tokenDialog.innerHTML = `\n',
)

css_path = Path("public/admin/proxy-key-ux.css")
css = css_path.read_text()
anchor = '.proxyKeyDialog {\n  width: min(620px, calc(100vw - 24px));\n}\n'
replacement = '''.proxyKeyModal {
  width: min(660px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  padding: 0;
  overflow: hidden;
}

.proxyKeyDialog {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}

.proxyKeyDialog > *,
.proxyKeyDialog footer,
.proxyKeyTokenValue,
.proxyKeyConnection,
.proxyKeyConnectionValue {
  min-width: 0;
  max-width: 100%;
}
'''
if css.count(anchor) != 1:
    raise SystemExit("proxy-key-ux.css: dialog anchor mismatch")
css = css.replace(anchor, replacement, 1)
css = css.replace(
    '  overflow-wrap: anywhere;\n  user-select: all;\n',
    '  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  word-break: break-all;\n  user-select: all;\n',
    1,
)
css += '''

@media (max-width: 560px) {
  .proxyKeyModal {
    width: calc(100vw - 16px);
    max-width: calc(100vw - 16px);
  }

  .proxyKeyTokenActions {
    grid-template-columns: minmax(0, 1fr);
  }

  .proxyKeyTokenActions .primary,
  .proxyKeyTokenActions .button {
    grid-column: 1;
  }
}
'''
css_path.write_text(css)

# Regression tests for both user-visible failures.
test_path = Path("tests/admin-readiness.test.ts")
test = test_path.read_text()
insert = '''

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
'''
needle = '\n});\n'
position = test.rfind(needle)
if position < 0:
    raise SystemExit("tests/admin-readiness.test.ts: describe ending not found")
test = test[:position] + insert + test[position:]
test_path.write_text(test)

# Release metadata.
replace_once("package.json", '"version": "1.6.0"', '"version": "1.6.1"')
replace_once("src/config/version.ts", 'export const APP_VERSION = "1.6.0";', 'export const APP_VERSION = "1.6.1";')
replace_once("README.md", '目前版本：`1.6.0`', '目前版本：`1.6.1`')
replace_once(
    "README.md",
    '## 1.6.0 Proxy 專屬金鑰改善\n',
    '## 1.6.1 管理台修正\n\n- 已設定管理密碼但尚未登入時，設定指南改為正確顯示「登入管理台」，不再誤稱首次設定。\n- 修正一次性 Client API Key 對話框水平溢位、右側按鈕裁切與長 token 撐寬版面。\n\n## 1.6.0 Proxy 專屬金鑰改善\n',
)
replace_once(
    "docs/changelog.md",
    '# 版本更新紀錄\n\n',
    '# 版本更新紀錄\n\n## 1.6.1 - 2026-07-29\n\n- 修正管理密碼已存在但使用者尚未登入時，首次設定指南誤顯示為尚未建立密碼。\n- 修正一次性 Client API Key 對話框在桌面與小螢幕出現水平捲軸、長 token 撐寬及操作按鈕被裁切。\n\n',
)

Path("scripts/apply-1.6.1-hotfix.py").unlink()
