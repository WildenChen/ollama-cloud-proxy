from pathlib import Path

path = Path("tests/proxy-client-key-upgrade.test.ts")
text = path.read_text()
old = '    const app = createApp(config({ upstreamBaseUrl }));\n    app.keyPool.create({ name: "upstream", apiKey: "upstream-key" });\n\n    const createResponse = await fetch(`${app.baseUrl}/admin/client-keys`, {'
new = '    const app = createApp(config({ upstreamBaseUrl, ollamaCompatDiscoveryPublic: false }));\n    app.keyPool.create({ name: "upstream", apiKey: "upstream-key" });\n\n    const createResponse = await fetch(`${app.baseUrl}/admin/client-keys`, {'
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one creation-test match, found {count}")
path.write_text(text.replace(old, new, 1))
