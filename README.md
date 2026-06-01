# Ollama Cloud Proxy

這是一個給 OpenClaw / Kilo Code 使用的 Ollama Cloud Proxy + Key Pool Manager + Admin Backend。它提供 OpenAI-compatible `/v1/*` gateway，並用 SQLite 保存 key 狀態、cooldown、usage estimate、client stats 與 events。

目前已完成後端穩定版與簡單 HTML Admin UI。Admin UI 走既有 Admin JSON API，不會回傳完整 API key。

## 架構

- `/v1/models`
- `/v1/chat/completions`
- `/v1/completions`
- `Key Pool Manager`：weighted healthy rotation、per-key concurrency、cooldown/block state
- `Concurrency Manager`：全域最多 5 個 upstream request，第 6 個進 queue
- `Client Token`：多 client token，events/stats 會記錄 clientName
- `Admin JSON API`：keys、stats、events、test、rotate、enable/disable
- `SQLite`：預設 `/data/ollama-cloud-proxy.sqlite`
- `Events`：不記完整 prompt、response、完整 API key
- `HTML Admin UI`：`GET /admin`

## 建立 .env

```bash
cp .env.example .env
```

請至少修改：

```env
ADMIN_TOKEN=請換成很長的管理 token
KEY_ENCRYPTION_SECRET=請換成很長的隨機 secret
CLIENT_API_KEYS=openclaw:openclaw-token,kilo-company:kilo-token
```

`KEY_ENCRYPTION_SECRET` 必須備份。若遺失，SQLite 裡的 encrypted key 將無法解密。

## 啟動 Docker

```bash
docker compose up -d --build
docker compose logs -f
```

Health check：

```bash
curl http://localhost:11435/health
```

Admin UI：

```text
http://localhost:11435/admin
```

打開後輸入 `.env` 裡的 `ADMIN_TOKEN`。Token 只存在瀏覽器 localStorage，所有資料操作仍會帶 Bearer token 呼叫 `/admin/*` JSON API。

## 新增第一把 Ollama key

```bash
curl -X POST http://localhost:11435/admin/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "free-01",
    "accountLabel": "account-a",
    "apiKey": "ollama_xxxxxxxxx",
    "notes": "optional"
  }'
```

Admin API 永遠不會回傳完整 `apiKey`，只會回 `apiKeyPreview`。

## 常用 Admin API

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:11435/admin/keys
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:11435/admin/stats
curl -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:11435/admin/events?limit=100"
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:11435/admin/keys/<id>/test
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:11435/admin/keys/<id>/reset-cooldown
```

Rotate key：

```bash
curl -X POST http://localhost:11435/admin/keys/<id>/rotate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"ollama_new_xxxxx"}'
```

## OpenClaw 設定

Base URL：

```text
http://<mac-mini-lan-ip>:11435/v1
```

若有設定 `CLIENT_API_KEYS`，OpenClaw 的 API Key 請填對應的 client token，例如 `openclaw-token`。

建議內網使用固定 LAN IP，不要只依賴 `.local`。

## Kilo Code 設定

- Provider: OpenAI Compatible
- Base URL: `https://your-domain.example.com/v1`
- API Key: `CLIENT_API_KEYS` 裡對應 `kilo-company` 的 token
- Model: 真實 model name 或 alias，例如 `kilo-default`

不要把 Base URL 填成 `/v1/chat/completions`。

## 外網反向代理注意事項

- 不要直接把 Docker port `11435` 裸露到 Internet。
- 外網使用必須放在 HTTPS 反向代理後面。
- 反向代理到外網時，必須設定 `CLIENT_API_KEYS`。
- `/admin/*` 不建議暴露到外網；若要暴露，必須設定 `ADMIN_TOKEN`，並建議再加 VPN / Tailscale / IP allowlist / Cloudflare Access。
- streaming/SSE 需要關閉 response buffering、延長 read timeout、支援長連線。
- client abort 時，本服務會釋放 activeRequests。

## Session / Weekly Usage 限制

Ollama Cloud usage 有 session limit 與 weekly limit。session limit 約每 5 小時重置，weekly limit 約每 7 天重置。

本專案依使用者觀察，預設 weekly reset 為 `Asia/Taipei` 每週一 `08:30`。若 Ollama 官方未提供 usage API，後台顯示的 session/weekly usage 只能是 `estimated` 或 `inferred`，不是官方精準數值；請看 `usageSource` 與 `resetSource`。

本專案用途是穩定管理 key 狀態，避免 OpenClaw/Kilo Code 持續打到 invalid、cooldown、session_blocked、weekly_blocked 的 key，不是用於無限制繞過服務限制。

## 常見錯誤

- `no_available_key`：所有 key 都 disabled、invalid、cooldown、session/weekly blocked，或達到 per-key concurrency。
- `queue_full`：全域 active 已滿且 queue 已達 `REQUEST_QUEUE_MAX`。
- `queue_timeout`：request 在 queue 等超過 `REQUEST_QUEUE_TIMEOUT_MS`。
- `weekly_blocked`：推斷 weekly usage limit，預設等到下一個台灣時間週一 08:30 加 grace/jitter。
- `session_blocked`：推斷 session usage limit，預設 cooldown 5 小時。
- `invalid key`：401/403，需 rotate 或手動處理，不會自動恢復。
- Kilo Code 連不上：確認 Base URL 是 `/v1`，不是 `/v1/chat/completions`。
- streaming 斷線：檢查反向代理 buffering/read timeout/長連線設定。

## 測試

```bash
bun test
```

若主機沒有安裝 Bun，可用 Docker 跑：

```bash
docker build -t ollama-cloud-proxy:test .
docker run --rm -v "$PWD:/work" -w /work ollama-cloud-proxy:test bun test
```

目前包含 weekly reset function、Admin key 建立、client token、mock upstream 轉送、401 invalid key、model alias rewrite 測試。

## 不要 commit secrets

`.env`、SQLite DB、任何含完整 API key 的檔案都不可 commit。本 repo 已加入 `.gitignore` / `.dockerignore`。
