# Ollama Cloud Proxy

Ollama Cloud Proxy 是一個把 Ollama Cloud 包成穩定代理服務的 key pool gateway。它可以集中管理多把 Ollama Cloud API key，並讓 OpenClaw、Kilo Code、自製腳本或其他 AI 工具共用同一個入口。

這個專案最重要的三個用途：

- **可使用多把 Ollama Cloud key**：proxy 會從 key pool 挑選目前可用的 key，避開 invalid、cooldown、session blocked、weekly blocked 的 key。
- **同時支援 Ollama 格式與 OpenAI-compatible 格式**：Ollama native client 可以走 `/api/version`、`/api/ps`、`/api/tags`、`/api/chat`、`/api/generate`；OpenAI-compatible client 可以走 `/v1/chat/completions`、`/v1/models`。
- **適合 OpenClaw / Kilo Code 這類工具集中接入**：client 只需要設定 proxy base URL 和 client token，不需要直接持有 Ollama Cloud key。

目前版本：`1.1.10`

可以把它想成一個放在工具與 Ollama Cloud 中間的流量管理層：

1. client 只連到這個 proxy。
2. proxy 從 SQLite 保存的 key pool 挑一把可用 key。
3. proxy 依 client 使用的 API 格式，轉送到 Ollama Cloud。
4. 如果某把 key 失效、冷卻、達到 session limit 或 weekly limit，proxy 會暫時避開它。
5. Admin UI/API 可以管理 key、查看佇列、事件、client 統計與 model 統計。

本專案的目標是穩定管理多把 Ollama Cloud key，避免 client 一直打到已失效或正在冷卻的 key。它不是用來無限制繞過 Ollama Cloud 的服務限制。

## 主要功能

- 多把 Ollama Cloud key：加密保存、健康狀態輪替、per-key concurrency、cooldown、block state
- OpenAI-compatible gateway：`/v1/models`、`/v1/chat/completions`、`/v1/completions`
- Ollama native support：公開 discovery 的 `/api/version`、`/api/ps`、`/api/tags`，以及 pass-through 的 `/api/chat`、`/api/generate`
- Concurrency queue：全域 upstream request 數量限制，超過時排隊
- Client token：支援多個 client token，統計會依 clientName 分開記錄
- Model alias：讓 client 使用短名稱，proxy 轉成真正 upstream model name
- Admin UI：`GET /admin`
- Admin UI i18n：支援繁體中文與英文切換，語言偏好保存在瀏覽器 localStorage
- Admin JSON API：keys、stats、events、test、rotate、enable/disable
- SQLite：保存 keys、events、client stats、model stats、models cache
- 事件紀錄會過濾敏感資訊，不保存完整 prompt、response 或完整 API key

## Project Status

This is an early-stage open-source project extracted from a real personal AI coding workflow. It is actively maintained and currently focuses on reliability, compatibility, observability, and safe deployment practices for local/self-hosted AI agent tooling.

The README is primarily written in Traditional Chinese because the initial workflow and deployment notes are local-first. The project also includes English sections for open-source users who need a quick overview of purpose, safety boundaries, and future direction.

## Use Cases

`ollama-cloud-proxy` is designed for developers who use multiple AI coding or agent tools and want a stable, observable, and maintainable gateway in front of Ollama Cloud.

Typical use cases include:

- Sharing one stable endpoint across AI coding tools such as OpenClaw, Kilo Code, Codex-compatible clients, and custom scripts.
- Using an OpenAI-compatible `/v1/chat/completions` endpoint while still supporting Ollama-native APIs.
- Managing multiple upstream keys through a key pool instead of hardcoding credentials in every local tool.
- Isolating different clients with separate client API keys.
- Observing request status, key health, queue behavior, streaming behavior, and basic usage statistics.
- Running a personal or small-team AI coding gateway on a private server, NAS, or internal network.

This project is especially useful for local-first or self-hosted AI agent workflows where several tools need to access the same model service safely and consistently.


## Ollama Web Search / Web Fetch

`ollama-cloud-proxy` 也可以代理 Ollama 官方 Web Search / Web Fetch API，讓 Hermes Agent、自製工具或其他 client 只持有 proxy 的 client token，不直接接觸 Ollama API key。

上游呼叫固定使用官方 API：

- `POST https://ollama.com/api/web_search`
- `POST https://ollama.com/api/web_fetch`

可設定的 env：

```env
OLLAMA_WEB_BASE_URL=https://ollama.com
OLLAMA_WEB_SEARCH_PATH=/api/web_search
OLLAMA_WEB_FETCH_PATH=/api/web_fetch
OLLAMA_WEB_TIMEOUT_MS=30000
```

Proxy endpoints：

- OmniRoute-style search：`GET /v1/search`、`POST /v1/search`
- `POST /v1/web/search`
- `POST /v1/web/fetch`
- `POST /api/web_search`
- `POST /api/web_fetch`

`/v1/search` 是推薦給 agent / tool-facing 整合使用的搜尋介面：

```json
{
  "query": "Hermes Agent plugin web search",
  "provider": "ollama-search",
  "max_results": 3,
  "search_type": "web"
}
```

目前 provider 固定為 `ollama-search`，`search_type` 固定支援 `web`。回傳會使用 OmniRoute-style normalized schema，包含 `provider`、`query`、`results`、`usage`、`metrics` 與 `errors`。

`/v1/web/search` 和 `/api/web_search` 接受：

```json
{
  "query": "Hermes Agent plugin web search",
  "max_results": 3
}
```

也支援 `q` alias：

```json
{
  "q": "Hermes Agent plugin web search",
  "max_results": 3
}
```

`max_results` 預設為 `5`，最大值為 `10`；超過 `10` 會回 `400 invalid_request`，不會自動 clamp。

`/v1/web/fetch` 和 `/api/web_fetch` 接受：

```json
{
  "url": "https://ollama.com"
}
```

測 `/v1/web/search`：

```bash
curl -X POST http://127.0.0.1:11435/v1/web/search \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Hermes Agent plugin web search","max_results":3}'
```

測 `/v1/web/fetch`：

```bash
curl -X POST http://127.0.0.1:11435/v1/web/fetch \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://docs.ollama.com/capabilities/web-search"}'
```

測 Ollama-compatible aliases：

```bash
curl -X POST http://127.0.0.1:11435/api/web_search \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Apple Developer news","max_results":3}'

curl -X POST http://127.0.0.1:11435/api/web_fetch \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://ollama.com"}'
```

Hermes plugin 安裝範例：

詳細安裝、設定、工具 schema、除錯與安全注意事項請看 [Hermes Web Search Proxy Plugin 使用說明](plugins/hermes-web-search-proxy/README.md)。

```bash
mkdir -p ~/.hermes/plugins
cp -R plugins/hermes-web-search-proxy ~/.hermes/plugins/
cp ~/.hermes/plugins/hermes-web-search-proxy/config.example.json ~/.hermes/plugins/hermes-web-search-proxy/config.json
# 編輯 config.json，填入 base_url 與 client_token
# 依 Hermes CLI 實際支援方式啟用 plugin
hermes plugins list
```

如果 Hermes 支援從 GitHub repo 的子目錄安裝，可以依本機版本改用等效指令；不要把 Ollama API key 寫進 Hermes plugin config。

## Security Notes

This project handles API keys and routing for AI coding tools, so it should be deployed carefully.

Recommended practices:

- Do not commit `.env`, API keys, admin tokens, client tokens, or SQLite runtime data to Git.
- Use strong and different values for `ADMIN_TOKEN` and client API keys.
- Back up `KEY_ENCRYPTION_SECRET`; encrypted upstream keys cannot be recovered without it.
- Do not expose the admin interface directly to the public internet.
- If deploying behind a reverse proxy, always use HTTPS.
- Prefer private network access, VPN, Tailscale, Cloudflare Access, or another access-control layer for remote usage.
- Rotate keys immediately if they may have been exposed.
- Avoid logging full request bodies when they may contain secrets, source code, credentials, or private data.
- Treat this proxy as infrastructure: back up configuration, monitor failures, and review updates before deploying.

This project is intended to improve maintainability, observability, and safer routing for AI development workflows. It is not intended to bypass provider limits, access controls, or terms of service.

## Roadmap

Planned improvements:

- Add automated tests for OpenAI-compatible and Ollama-native endpoints.
- Improve streaming compatibility and error handling for AI coding clients.
- Add safer default configuration examples for reverse proxy deployments.
- Improve key health checks, cooldown behavior, and queue diagnostics.
- Add clearer admin dashboard indicators for active requests, failed requests, and key status.
- Add structured error classification for upstream failures, authentication failures, and client-side request issues.
- Provide example configurations for common tools such as OpenClaw, Kilo Code, and custom OpenAI-compatible clients.
- Improve documentation for Docker, Synology NAS, and private-network deployment.
- Add CI checks for linting, tests, and accidental secret detection.
- Extend Admin UI localization if the project gains users who need languages beyond Traditional Chinese and English.

## 專案結構

```text
src/
  index.ts                    # Bun server 入口
  server/router.ts             # /health、/admin、/v1/*、/api/* 路由
  proxy/                       # 請求轉送、body limit、streaming
  keyPool/                     # key 選擇、狀態更新、錯誤分類
  concurrency/                 # 全域併發與等待佇列
  admin/                       # Admin JSON API
  storage/database.ts          # SQLite schema 與資料操作
  models/modelManager.ts       # model alias 與 /v1/models cache
  security/                    # client/admin auth 與 key 加密
public/admin/                  # 簡易 HTML Admin UI
tests/                         # Bun tests
```

## Prebuilt Docker Image

This project publishes prebuilt Docker images to GitHub Container Registry:

```text
ghcr.io/wildenchen/ollama-cloud-proxy
```

Available tags:

- `latest`：latest build from the `main` branch
- `main`：latest build from the `main` branch
- `1.1.7` or other version tags：release builds
- `sha-<commit>`：commit-specific builds

Version tags are published when the matching Git tag is pushed after the Docker publish workflow is available.

For normal deployment, you can use the prebuilt image without cloning or building the source code:

```bash
docker pull ghcr.io/wildenchen/ollama-cloud-proxy:latest
```

Or run it with the release compose file:

```bash
cp .env.example .env
docker compose -f docker-compose.release.yml up -d
docker compose -f docker-compose.release.yml logs -f
```

The release compose file uses:

```yaml
image: ghcr.io/wildenchen/ollama-cloud-proxy:latest
```

If you want to build from local source instead, use the default `docker-compose.yml`, which keeps `build: .`.

After the first GitHub Actions publish, make sure the package visibility in GitHub Packages is set to public if you want unauthenticated users to pull the image.

## 版本更新紀錄

### 1.2.3 - 2026-07-03

- 手機版首頁用量卡片調整為更細緻的字級、間距、燈號與按鈕高度，避免卡片在小螢幕上顯得過大。
- 官方用量 footer 拆分「用量已同步 / 用量讀取失敗」與 key runtime 狀態，避免 invalid 或 weekly blocked 被誤解成 Cookie 讀取失敗。
- 保留 weekly/session 受限金鑰不列入總額度池的邏輯，實際不可用額度不再被算入可用剩餘。

### 1.2.2 - 2026-07-03

- 總額度池改成只合計目前可用金鑰，不再把 weekly/session 已受限的 key 算進 5hr 或 weekly 可用額度。
- weekly 額度已用完或整把 key 目前不可用時，單卡 5hr / weekly 用量條改成灰階並標示「目前不可用」，避免 5hr 顯示 100% 綠條造成誤解。
- 調整首頁 key card 字體、間距、meter 與按鈕尺寸，讓版面更接近 OmniRoute 的可讀密度。

### 1.2.1 - 2026-07-03

- Admin 首頁新增「總額度池」合體卡片，合計所有已接入官方用量的 5hr / weekly 額度。
- 首頁 Key 卡片恢復用量燈號與左側狀態色條，啟用開關移到右上角，普通短暫冷卻不再用醒目黃色狀態誤導額度判讀。
- 模型測試頁新增模型啟用開關；停用模型會從公開 `/v1/models` / `/api/tags` discovery 隱藏，推理請求也會回 `model_disabled`。
- 未帶 token 的公開 `/v1/models` 會使用已保存的模型清單列出可用模型，方便無密碼 discovery；帶合法 token 的 `/v1/models` 仍可刷新上游清單。

### 1.1.10 - 2026-07-03

- Admin 首頁第一屏整合 OmniRoute 風格的每 Key Ollama Cloud 用量卡片。
- 新增 per-key 剩餘量截止值設定，官方用量低於該 Key 門檻時才封鎖輪替。
- 新增單 Key 官方用量刷新，以及 Key 設定視窗，可編輯名稱、帳號標籤、備註與用量 Cookie。

### 1.1.9 - 2026-07-03

- Admin 用量頁第一屏改成 Ollama Cloud 帳號卡片網格，直接顯示 5hr / weekly 剩餘量、已用量、重置時間、方案、Cookie 狀態與更新時間。
- 修正官方用量百分比顯示，支援 `34` 與 `0.34` 兩種百分比資料格式，避免前端重複乘以 100。
- 版本號同步更新到 `1.1.9`，並更新 Admin 靜態資源 cache-busting 參數。

### 1.1.8 - 2026-06-07

- Admin UI 用量頁新增全部帳號用量總覽。
- 新增 `GET /admin/usage-overview`，彙總全部金鑰、依 `accountLabel` 合併帳號並顯示 5hr / weekly 代理估算用量。
- 用量總覽新增帳號分組、今日模型分布、受限 key 數與 duration 指標。
- 新增 integration test，驗證全部金鑰加總與帳號分組合併。

### 1.1.7 - 2026-06-07

- 新增全域 5hr session reset anchor，預設為台北時間 `2026-06-07 04:00`。
- Admin UI 總覽新增下一次 5hr 重置時間。
- Admin UI 用量頁新增可調整的 5hr session reset 與 weekly reset 設定。
- 新增 `GET /admin/usage-settings` 與 `PATCH /admin/usage-settings`，設定會保存在 SQLite。
- session limit 與 weekly limit 的冷卻推算改用同一份可調設定。

### 1.1.6 - 2026-06-04

- `/admin/stats` 的 `adminUi` 改成 `{ enabled: true, path: "/admin" }`，不再顯示未實作。
- 新增 smart key retry 設定：`KEY_RETRY_POLICY=smart`、`MAX_KEY_ATTEMPTS_PER_REQUEST=all`、`MAX_NETWORK_RETRY_ATTEMPTS=3`。
- quota/key-level 錯誤會繼續嘗試下一把 selectable key；network/provider 暫時錯誤最多嘗試 3 把；request/payload/model 類錯誤不換 key。
- key attempt event 會記錄 attempt index、key、錯誤類型、是否繼續換 key 與停止原因；耗盡可嘗試 key 時回 `no_available_key_after_attempts`。
- estimated session/weekly usage window 會 rollover，lifetime counters 不重置。
- 新增 `OLLAMA_NATIVE_APPLY_ALIASES=true`，讓 `/api/chat`、`/api/generate` 預設也套用 model alias；關閉時 `/api/tags` 不列 proxy alias。
- 補強 stream helper、queue、restart stale activeRequests、retry、native alias 與 usage rollover 測試。
- GitHub Actions Docker publish 會先執行 `bun install` 與 `bun test`，測試通過才 build/push image。

### 1.1.5 - 2026-06-03

- Retry 上限改成當下可用 key 數量，不再使用固定 `MAX_UPSTREAM_RETRIES_PER_REQUEST`。
- 同一請求不會重複使用同一把 key；key 失效、session/weekly limit、rate limit、network error 或暫時性上游錯誤時，會繼續嘗試下一把可用 key。
- 新增整合測試，確認 key 全部失敗時會試完所有可用 key，且後面的 key 成功時請求會成功返回。

### 1.1.4 - 2026-06-03

- 修正 `1.1.3` 後續變更造成的 `/api/tags` 相容性問題。
- 未帶 token 的 `/api/tags` 可回 compatibility model list，供 Ollama provider discovery 使用。
- 帶合法 Bearer token 的 `/api/tags` 恢復原樣 pass-through 到上游 Ollama Cloud，避免 native client 拿到 proxy 自造模型清單。
- `/api/version` 保留 Ollama-compatible `version`，並新增 `proxy_version` 供檢查 proxy 自身版本。

### 1.1.3 - 2026-06-03

- 新增 Ollama native `/api/version` endpoint，供 client 做服務版本檢查。
- 新增 Ollama native `/api/generate` pass-through。
- 更新 README 與測試，補齊 `/api/version`、`/api/generate` 的使用與驗證。

### 1.1.2 - 2026-06-03

- Admin key list 會把已過期 cooldown 的 key 顯示成 available。
- 修正 stats 中 expired cooldown key 仍被算成 cooling down 的問題。

### 1.1.1 - 2026-06-03

- Admin metrics 顯示 app version，方便確認目前容器實際跑的版本。
- README 補充 Docker image 更新流程。
- Docker image 增加 OCI source label。

### 1.1.0 - 2026-06-02

- 新增 GHCR prebuilt Docker image 發布流程與 release compose 用法。
- Admin UI 加入繁體中文/英文切換。
- README 補強 project status、use cases、roadmap、安全提醒與 OpenClaw 設定範例。

### 1.0.0 - 2026-06-02

- 首個 tagged release。
- 建立 app version 顯示。
- 支援 OpenAI-compatible `/v1/*` 與 Ollama native `/api/*` 基礎相容路徑。
- 修正 Ollama native tool call stream 與 native API pass-through，相容 OpenClaw 等 Ollama client。
- 建立 Admin UI/API、key pool、SQLite persistence、client token、model alias 與併發管理基礎。

## 更新方式

如果你是用 `docker-compose.release.yml` 和 GHCR prebuilt image 部署，更新時通常不需要重新 build，只要在專案目錄執行：

```bash
git pull
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
docker compose -f docker-compose.release.yml logs -f
```

這會拉下最新的 README / compose 設定，再拉取 `ghcr.io/wildenchen/ollama-cloud-proxy:latest`，最後用新的 image 重新啟動服務。`./data` volume 和 `.env` 會保留，不會因為 container 重建而消失。

如果你使用指定版本，請把 `docker-compose.release.yml` 裡的 image tag 從 `latest` 改成固定版本，例如：

```yaml
image: ghcr.io/wildenchen/ollama-cloud-proxy:1.1.10
```

固定版本適合穩定部署；`latest` 適合跟著 `main` 最新版走。

如果 GHCR package 尚未公開，或你使用 private package，請先登入：

```bash
echo "$CR_PAT" | docker login ghcr.io -u WildenChen --password-stdin
```

`CR_PAT` 請只放在 shell 環境變數或機器 secret，不要寫進 repo、README、Dockerfile 或 compose file。權限至少需要 `read:packages`；如果要從本機 push image，還需要 `write:packages`。

如果你是用預設 `docker-compose.yml` 從本機 source build，更新方式是：

```bash
git pull
docker compose up -d --build
docker compose logs -f
```

更新後可以確認服務版本和健康狀態：

```bash
curl http://localhost:11435/health
docker ps --filter name=ollama-cloud-proxy
```

建議更新前備份 `.env` 和 `data/`。尤其 `KEY_ENCRYPTION_SECRET` 必須保存好；如果遺失，SQLite 裡既有的 encrypted key 將無法解密。

## 快速啟動

先建立設定檔：

```bash
cp .env.example .env
```

至少要修改這三個值：

```env
ADMIN_TOKEN=請換成很長的管理 token
KEY_ENCRYPTION_SECRET=請換成很長的隨機 secret
CLIENT_API_KEYS=openclaw:openclaw-token,kilo-company:kilo-token
```

接著用 Docker 啟動：

```bash
docker compose up -d --build
docker compose logs -f
```

確認服務狀態：

```bash
curl http://localhost:11435/health
```

打開 Admin UI：

```text
http://localhost:11435/admin
```

Admin UI 會要求輸入 `.env` 裡的 `ADMIN_TOKEN`。Token 只存在瀏覽器 localStorage，後續操作會用 Bearer token 呼叫 `/admin/*` API。

## 重要設定

`KEY_ENCRYPTION_SECRET` 必須備份。SQLite 裡保存的是加密後的 key；如果這個 secret 遺失，既有 encrypted key 將無法解密，只能重新新增或 rotate。

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `PORT` | `11435` | proxy 監聽 port |
| `ADMIN_TOKEN` | 必填 | 管理台與 `/admin/*` API 的 Bearer token |
| `KEY_ENCRYPTION_SECRET` | 必填 | 加密 Ollama Cloud API key 的 secret |
| `CLIENT_API_KEYS` | 空 | client token 清單，格式是 `clientName:token,client2:token2` |
| `OLLAMA_UPSTREAM_BASE_URL` | `https://ollama.com` | 上游 Ollama Cloud base URL |
| `OLLAMA_WEB_BASE_URL` | `https://ollama.com` | Ollama 官方 Web Search / Web Fetch base URL |
| `OLLAMA_WEB_SEARCH_PATH` | `/api/web_search` | Ollama 官方 Web Search path |
| `OLLAMA_WEB_FETCH_PATH` | `/api/web_fetch` | Ollama 官方 Web Fetch path |
| `OLLAMA_WEB_TIMEOUT_MS` | `30000` | Web Search / Web Fetch 上游請求總逾時 |
| `OLLAMA_CLOUD_USAGE_URL` | `https://ollama.com/settings` | Ollama Cloud settings page，用於官方用量擷取 |
| `OLLAMA_USAGE_COOKIE` | 空 | 單帳號 fallback 用量 cookie，可填 `__Secure-session=...` 或純 cookie value |
| `OLLAMA_CLOUD_USAGE_COOKIE` | 空 | `OLLAMA_USAGE_COOKIE` 的替代名稱 |
| `OLLAMA_USAGE_REFRESH_TTL_SECONDS` | `300` | 官方用量 snapshot 快取秒數 |
| `MAX_CONCURRENT_REQUESTS` | `5` | 全域同時送往上游的 request 數量 |
| `MAX_CONCURRENT_REQUESTS_PER_KEY` | `1` | 單把 key 同時處理的 request 數量 |
| `REQUEST_QUEUE_MAX` | `30` | 全域額度滿時最多排隊 request 數 |
| `REQUEST_QUEUE_TIMEOUT_MS` | `120000` | request 在 queue 裡最多等待多久 |
| `UPSTREAM_TOTAL_TIMEOUT_MS` | `900000` | 單次上游請求總逾時 |
| `UPSTREAM_IDLE_TIMEOUT_MS` | `180000` | streaming 沒有新資料時的 idle 逾時 |
| `MAX_REQUEST_BODY_SIZE_MB` | `20` | request body 大小上限 |
| `KEY_RETRY_POLICY` | `smart` | key retry 策略；目前支援 smart |
| `MAX_KEY_ATTEMPTS_PER_REQUEST` | `all` | quota/key-level 錯誤最多嘗試幾把 key；`all` 代表當下所有 selectable key |
| `MAX_NETWORK_RETRY_ATTEMPTS` | `3` | network/provider 暫時錯誤最多嘗試幾把 key，避免掃完整個 key pool |
| `MODELS_CACHE_TTL_SECONDS` | `3600` | `/v1/models` cache 時間 |
| `MODEL_ALIASES_JSON` | `{}` | model alias JSON，例如 `{"kilo-default":"actual-model"}` |
| `OLLAMA_COMPAT_DISCOVERY_PUBLIC` | `true` | 是否公開 `/api/tags` 與未帶 token 的 `/v1/models` 供 provider 做 discovery |
| `OLLAMA_NATIVE_APPLY_ALIASES` | `true` | 是否讓 `/api/chat`、`/api/generate` 套用 model alias |
| `USAGE_TIMEZONE` | `Asia/Taipei` | weekly reset 顯示與推算時區 |
| `WEEKLY_RESET_DAY_OF_WEEK` | `1` | weekly reset 星期，`1` 是星期一 |
| `WEEKLY_RESET_TIME` | `08:30` | weekly reset 時間 |
| `EVENT_RETENTION_DAYS` | `14` | event 保留天數 |
| `MAX_EVENTS` | `100000` | event 最大保留筆數 |
| `DB_PATH` | `/data/ollama-cloud-proxy.sqlite` | SQLite DB 路徑 |

如果 `CLIENT_API_KEYS` 有設定，`/v1/chat/completions`、`/v1/completions`、`POST /api/chat` 與 `POST /api/generate` 都必須帶合法 Bearer token。`GET /api/version` 與 `GET /api/ps` 會公開回應，供 Ollama-compatible client 驗證服務；未帶 token 的 `GET /api/tags` 與 `GET /v1/models` 預設也公開，可用 `OLLAMA_COMPAT_DISCOVERY_PUBLIC=false` 改成需要 client token。若沒有設定 `CLIENT_API_KEYS`，proxy 會允許未驗證推理請求，clientName 會使用 `x-client-name` header，沒有 header 時是 `anonymous`。外網使用時務必設定 `CLIENT_API_KEYS`。

smart retry 會依錯誤類型決定是否換 key。同一請求不會重複使用同一把 key；如果某把 key 回 `401`、`403`、session limit、weekly limit 或 key-specific rate limit，proxy 會標記該 key 狀態並繼續嘗試下一把 selectable key，直到成功或 key pool 都試完。network timeout、`502`、`503` 等 network/provider 暫時錯誤最多嘗試 `MAX_NETWORK_RETRY_ATTEMPTS` 把 key。client payload、model、tool schema 或 unsupported parameter 類型的 `4xx` 錯誤不會被當成 key 失效，也不會盲目 retry。

Admin 用量頁會優先使用 Ollama Cloud usage cookie 擷取官方 settings 頁面中的 5hr / weekly quota track。多帳號建議在 Admin UI 每把 key 或同帳號 key 填入對應 usage cookie；env cookie 只適合單帳號 fallback。若沒有 cookie 或擷取失敗，畫面會退回 proxy activity / estimated counters，並明確標示不是官方 quota。

## 新增第一把 Ollama Cloud key

可以在 Admin UI 新增，也可以用 Admin API：

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

API 回應不會包含完整 `apiKey`，只會回傳 `apiKeyPreview`。

## Proxy 路徑怎麼選

這個服務同時支援 OpenAI-compatible 與 Ollama native 兩種路徑，差別很重要。

| Client 需要 | 使用路徑 | 行為 |
| --- | --- | --- |
| OpenAI-compatible chat | `/v1/chat/completions` | 會套用 model alias，回應維持 OpenAI 格式 |
| OpenAI-compatible completion | `/v1/completions` | 會套用 model alias，回應維持 OpenAI 格式 |
| OpenAI-compatible model list | `/v1/models` | 未帶 token 時回已保存且啟用的模型清單；帶合法 token 時可刷新/cache 上游 model list，並把 alias 加進列表 |
| Ollama native version | `/api/version` | 公開回傳 Ollama-compatible 版本，供 client 偵測服務 |
| Ollama native running models | `/api/ps` | 公開回傳空執行中模型清單 |
| Ollama native model list | `/api/tags` | 未帶 token 時可回 compatibility model list；帶合法 token 時原樣 pass-through 到上游 |
| Ollama native chat | `/api/chat` | 預設套用 model alias，其他 native 欄位與 tool call payload 不改 |
| Ollama native generate | `/api/generate` | 預設套用 model alias，其他 native 欄位不改 |

`/api/version`、`/api/ps`、未帶 token 時預設公開的 `/api/tags` 與 `/v1/models` 是 discovery endpoint，不會消耗 Ollama Cloud key。若 `/api/tags` 帶合法 Bearer token，proxy 會改走上游 pass-through，保留 Ollama native model list 原樣回應。`/api/chat` 和 `/api/generate` 會保持 Ollama native payload 結構；預設只改寫 `body.model` 的 alias，避免工具呼叫、streaming chunk 或其他 Ollama 原生欄位被改寫。它們在設定 `CLIENT_API_KEYS` 時仍一定要帶合法 Bearer token。如果你的 client 走 Ollama native protocol，請設定到 proxy root 或 `/api` 類路徑；如果 client 是 OpenAI-compatible provider，請設定 base URL 到 `/v1`。

## 應用範例：同時支援兩種 client 格式

同一個 Ollama Cloud Proxy 可以同時被不同工具使用。有些工具只認 OpenAI-compatible API，有些工具則使用 Ollama native API；它們可以共用同一組 proxy、同一個 key pool、同一套佇列與狀態管理。

例如：

| 使用者或工具 | API 格式 | Base URL / endpoint | 說明 |
| --- | --- | --- | --- |
| Kilo Code | OpenAI-compatible | `http://<proxy-host>:11435/v1` | 走 `/v1/chat/completions`，可以使用 model alias |
| OpenClaw | OpenAI-compatible | `http://<proxy-host>:11435/v1` | 走 OpenAI 格式，適合 OpenAI-compatible provider 設定 |
| Ollama native client | Ollama native | `http://<proxy-host>:11435` | 走 `/api/version`、`/api/tags`、`/api/chat`、`/api/generate` |
| 自製工具或腳本 | 任一種 | `/v1/*` 或 `/api/*` | 依工具需要選擇格式 |

### OpenAI-compatible 請求範例

適合 Kilo Code、OpenClaw 或其他 OpenAI-compatible SDK：

```bash
curl http://localhost:11435/v1/chat/completions \
  -H "Authorization: Bearer openclaw-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kilo-default",
    "messages": [
      { "role": "user", "content": "請用三句話說明這個 proxy 的用途" }
    ],
    "stream": false
  }'
```

如果 `MODEL_ALIASES_JSON={"kilo-default":"actual-upstream-model"}`，proxy 會把 `kilo-default` 改成真正的 upstream model name 再送出。

### Ollama native 請求範例

適合使用 Ollama 原生 `/api/chat` 格式的工具：

```bash
curl http://localhost:11435/api/chat \
  -H "Authorization: Bearer openclaw-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "actual-upstream-model",
    "messages": [
      { "role": "user", "content": "請用三句話說明這個 proxy 的用途" }
    ],
    "stream": false
  }'
```

這條路徑不會套用 model alias，也不會改寫 tools、tool calls 或 streaming chunks。也就是說，client 送什麼 Ollama native payload，proxy 就盡量原樣轉給 Ollama Cloud。

使用 Ollama native `/api/generate`：

```bash
curl http://localhost:11435/api/generate \
  -H "Authorization: Bearer openclaw-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "actual-upstream-model",
    "prompt": "請用三句話說明這個 proxy 的用途",
    "stream": false
  }'
```

查詢 Ollama native model list：

```bash
curl http://localhost:11435/api/tags
```

查詢 Ollama native version：

```bash
curl http://localhost:11435/api/version
```

查詢 Ollama native running models：

```bash
curl http://localhost:11435/api/ps
```

### 同時混用時的注意事項

- `/v1/*` 和 `/api/*` 會共用同一個 key pool，所以任一格式造成 key 冷卻或封鎖，都會影響另一種格式的可用 key 數。
- `/v1/*` 會套用 model alias；`/api/chat` 和 `/api/generate` 預設也會套用 `body.model` alias，可用 `OLLAMA_NATIVE_APPLY_ALIASES=false` 關閉。
- 兩種格式都會受到 `MAX_CONCURRENT_REQUESTS`、`REQUEST_QUEUE_MAX` 與 per-key concurrency 限制。
- 兩種格式都會記錄 client stats、model stats 與 events。
- 如果設定了 `CLIENT_API_KEYS`，`/v1/*`、`POST /api/chat` 與 `POST /api/generate` 都必須帶合法 Bearer token；discovery endpoint 依上方規則處理。

## OpenClaw 設定

OpenClaw 可以用兩種方式接這個 proxy。

### OpenClaw 使用 Ollama 格式

如果 OpenClaw 設定裡使用 `api: "ollama"`，請把 `baseUrl` 指到 proxy root，不要加 `/api`。OpenClaw 會自己呼叫 Ollama native endpoint，例如 `/api/version`、`/api/chat`、`/api/tags`。

```json
{
  "olla": {
    "api": "ollama",
    "apiKey": "openclaw-token",
    "baseUrl": "http://<proxy-host>:11435",
    "models": [
      {
        "name": "minimax-m2.5",
        "id": "minimax-m2.5",
        "contextWindow": 196608,
        "maxTokens": 8192,
        "input": ["text"],
        "reasoning": true,
        "compat": {
          "requiresStringContent": true,
          "strictMessageKeys": true,
          "supportsTools": true,
          "supportsUsageInStreaming": true
        },
        "params": {
          "num_ctx": 196608
        }
      },
      {
        "name": "gemma4:31b",
        "id": "gemma4:31b",
        "contextWindow": 262144,
        "maxTokens": 16384,
        "input": ["text", "image"],
        "reasoning": true,
        "compat": {
          "requiresStringContent": true,
          "strictMessageKeys": true,
          "supportsTools": true,
          "supportsUsageInStreaming": true
        },
        "params": {
          "num_ctx": 262144
        }
      },
      {
        "name": "minimax-m3",
        "id": "minimax-m3",
        "contextWindow": 1048576,
        "maxTokens": 32768,
        "input": ["text", "image"],
        "reasoning": true,
        "compat": {
          "requiresStringContent": true,
          "strictMessageKeys": true,
          "supportsTools": true,
          "supportsUsageInStreaming": true
        },
        "params": {
          "num_ctx": 1048576
        }
      }
    ]
  }
}
```

上面的 `apiKey` 要填 `CLIENT_API_KEYS` 裡對應 OpenClaw 的 client token，例如：

```env
CLIENT_API_KEYS=openclaw:openclaw-token
```

### OpenClaw 使用 OpenAI-compatible 格式

如果 OpenClaw 使用 OpenAI-compatible provider，Base URL 請填：

```text
http://<proxy-host>:11435/v1
```

API Key 一樣填 `CLIENT_API_KEYS` 裡對應的 token，例如：

```text
openclaw-token
```

建議內網使用固定 LAN IP，不要只依賴 `.local`。

## VS Code Copilot 設定

VS Code Copilot 的 `chatLanguageModels.json` 如果使用 Ollama provider，URL 要填 proxy root，不要加 `/v1`：

```json
{
  "name": "Olla",
  "vendor": "ollama",
  "url": "https://olla.wilden.myds.me"
}
```

這個模式會呼叫 Ollama discovery endpoint，例如 `GET /api/version`、`GET /api/tags`、`GET /api/ps`。proxy 會公開 `/api/version` 與 `/api/ps`，並預設公開 `/api/tags`，讓 VS Code 可以通過 Ollama server version 與模型清單驗證。

但 VS Code 的 Ollama provider 可能不會把 Authorization header 送到 `POST /api/chat` 或 `POST /api/generate`。因此它可能可以通過 discovery，但實際推理因為沒有 `CLIENT_API_KEYS` token 而失敗。若需要帶 API key，請改用 `vendor: "customendpoint"` / Custom Endpoint，走 OpenAI-compatible `/v1/chat/completions`。

OpenAI-compatible / Custom Endpoint 的 URL 才填：

```text
https://olla.wilden.myds.me/v1
```

或依工具要求填完整 chat completions URL：

```text
https://olla.wilden.myds.me/v1/chat/completions
```

## Kilo Code 設定

- Provider: OpenAI Compatible
- Base URL: `http://<proxy-host>:11435/v1` 或你的 HTTPS domain `/v1`
- API Key: `CLIENT_API_KEYS` 裡對應 `kilo-company` 的 token
- Model: 真實 model name，或 `MODEL_ALIASES_JSON` 裡設定的 alias

Base URL 請填到 `/v1`，不要填成 `/v1/chat/completions`。

## Model alias

如果 client 端不好填長 model name，可以在 `.env` 設定 alias：

```env
MODEL_ALIASES_JSON={"kilo-default":"actual-upstream-model","fast":"another-model"}
```

效果：

- client 對 `/v1/chat/completions` 或 `/v1/completions` 送 `model: "kilo-default"`
- proxy 轉送上游時改成 `model: "actual-upstream-model"`
- `/v1/models` 會額外列出 `kilo-default`
- `/api/chat` 和 `/api/generate` 預設也會把 `body.model` 改成 `actual-upstream-model`
- 如果設定 `OLLAMA_NATIVE_APPLY_ALIASES=false`，`/api/chat` 和 `/api/generate` 不改寫 model，且公開 `/api/tags` 不列出 proxy alias，避免 Ollama native client 選到上游不認得的 model

也可以不設環境變數，改在專案根目錄放 `model-aliases.json`：

```json
{
  "kilo-default": "actual-upstream-model"
}
```

## 常用 Admin API

```bash
# key list
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:11435/admin/keys

# stats
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:11435/admin/stats

# recent events
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:11435/admin/events?limit=100"
```

管理單一 key：

```bash
# test key against upstream /v1/models
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:11435/admin/keys/<id>/test

# temporarily disable key
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:11435/admin/keys/<id>/disable

# enable key
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:11435/admin/keys/<id>/enable

# clear cooldown
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:11435/admin/keys/<id>/reset-cooldown
```

Rotate key：

```bash
curl -X POST http://localhost:11435/admin/keys/<id>/rotate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"ollama_new_xxxxx"}'
```

更新 metadata：

```bash
curl -X PATCH http://localhost:11435/admin/keys/<id> \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"free-01-renamed","notes":"new note","enabled":true}'
```

刪除 key 是 soft delete：列表不再顯示，但資料庫仍保留事件紀錄。

```bash
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:11435/admin/keys/<id>
```

## Key 狀態與錯誤判斷

proxy 會根據上游回應更新 key 狀態：

| 上游狀況 | proxy 判斷 | 後續行為 |
| --- | --- | --- |
| `401` | `invalid` / `auth_failed` | key 不再自動使用，需要 rotate 或手動處理 |
| `403` | `invalid` / `invalid_api_key` | key 不再自動使用，需要 rotate 或手動處理 |
| `429` 且內容像 session limit | `session_blocked` | 預設冷卻約 5 小時 |
| `429` 且內容像 weekly limit | `weekly_blocked` | 等到推算的 weekly reset 後再嘗試 |
| 其他 `429` | `cooling_down` / `rate_limited` | 指數退避，約 15 分鐘到 1 小時 |
| `500` / `502` / `503` | `cooling_down` / `provider_error` | 短暫冷卻，約 1 到 5 分鐘 |
| network / timeout | `cooling_down` / `network_error` | 短暫冷卻，可 retry |

session 與 weekly usage 沒有官方 usage API 可查時，只能靠 proxy 估算或從錯誤文字推斷。Admin UI/API 裡的 `usageSource` 與 `resetSource` 會標示來源。

## 外網與反向代理

不建議直接把 Docker port `11435` 裸露到 Internet。外網使用時建議：

- 放在 HTTPS 反向代理後面
- 一定要設定 `CLIENT_API_KEYS`
- `/admin/*` 儘量只允許內網、VPN、Tailscale、IP allowlist 或 Cloudflare Access 存取
- 設定足夠長的 read timeout
- streaming/SSE 或 NDJSON 場景要關閉 response buffering
- 不要把 `ADMIN_TOKEN` 和 client token 寫進公開文件或前端程式碼

如果 client 中止請求，proxy 會中止上游 request，並釋放全域 concurrency slot 與 key active count。

## 常見錯誤

- `unauthorized`：缺少合法 Bearer token。`/admin/*` 要用 `ADMIN_TOKEN`；`/v1/*`、`POST /api/chat` 與 `POST /api/generate` 要用 `CLIENT_API_KEYS` 裡的 client token。
- `no_available_key`：所有 key 都 disabled、invalid、cooldown、session blocked、weekly blocked，或已達 per-key concurrency。
- `queue_full`：全域 active request 已滿，且等待佇列達到 `REQUEST_QUEUE_MAX`。
- `queue_timeout`：request 在 queue 等超過 `REQUEST_QUEUE_TIMEOUT_MS`。
- `request_body_too_large`：request body 超過 `MAX_REQUEST_BODY_SIZE_MB`。
- `weekly_blocked`：推斷達到 weekly usage limit，預設等到下一個台灣時間星期一 08:30，加上 grace/jitter 後再嘗試。
- `session_blocked`：推斷達到 session usage limit，預設冷卻約 5 小時。
- `invalid`：上游回 `401` 或 `403`，通常要 rotate key。
- Kilo Code 連不上：確認 Base URL 是 `/v1`，不是 `/v1/chat/completions`。
- VS Code Copilot 顯示 `Unable to verify Ollama server version`：確認 Ollama provider 的 URL 是 proxy root，例如 `https://olla.wilden.myds.me`，不要加 `/v1`。
- streaming 斷線：檢查反向代理 buffering、read timeout 與長連線設定。

## 本機開發

需要 Bun。

```bash
bun run dev
```

測試：

```bash
bun test
```

如果主機沒有 Bun，可用 Docker 跑測試：

```bash
docker build -t ollama-cloud-proxy:test .
docker run --rm -v "$PWD:/work" -w /work ollama-cloud-proxy:test bun test
```

目前測試涵蓋：

- weekly reset 時間推算
- Admin key 建立與 API key 不外洩
- soft delete
- client token 驗證
- mock upstream 轉送
- upstream `401` 使 key 變成 invalid
- model alias rewrite
- `/v1/*` OpenAI-compatible 路徑
- `/api/version`、`/api/ps`、`/api/tags`、`/api/chat`、`/api/generate` Ollama native support
- native streaming 與 tool call payload 保持不變

## 資料與 secret

不要 commit 這些內容：

- `.env`
- `data/`
- SQLite DB
- 任何完整 Ollama Cloud API key
- `ADMIN_TOKEN`
- client token
- `KEY_ENCRYPTION_SECRET`

Docker compose 預設把 SQLite 放在本機 `./data`，容器內路徑是 `/data/ollama-cloud-proxy.sqlite`。備份 DB 時也要一起保存 `KEY_ENCRYPTION_SECRET`，否則備份回來的 encrypted key 無法使用。

## License

MIT License. See [LICENSE](./LICENSE).
