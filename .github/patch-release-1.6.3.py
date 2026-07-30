from pathlib import Path


def replace_all(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"{path}: missing expected value {old!r}")
    file.write_text(text.replace(old, new))


replace_all("src/config/version.ts", '"1.6.2"', '"1.6.3"')
replace_all("README.md", "1.6.2", "1.6.3")
replace_all("tests/integration.test.ts", 'proxy_version).toBe("1.6.2")', 'proxy_version).toBe("1.6.3")')

changelog = Path("docs/changelog.md")
text = changelog.read_text()
marker = "# 版本更新紀錄\n\n"
if marker not in text:
    raise SystemExit("docs/changelog.md: missing heading")
section = """## 1.6.3 - 2026-07-30

- OpenAI 相容路徑保留上游 400／409／415／422 等請求錯誤的安全化 message、type、code、request ID 與驗證細節。
- 純文字上游錯誤會轉為 OpenAI 相容 JSON，讓 Open Minis 等客戶端能直接定位不支援的訊息、工具或模型參數。
- 上游錯誤與事件紀錄會遞迴遮罩 Bearer token、API Key、Cookie、session、query secret 與本機使用者路徑。
- 請求 payload 的 4xx 不會誤判上游 Key 無效；429 與 5xx 維持既有冷卻、重試與分類行為。
- 新增 JSON、純文字、422 validation、敏感資料遮罩、事件摘要及 429／5xx 回歸測試。

"""
if "## 1.6.3 - 2026-07-30" in text:
    raise SystemExit("docs/changelog.md: 1.6.3 section already exists")
changelog.write_text(text.replace(marker, marker + section, 1))
