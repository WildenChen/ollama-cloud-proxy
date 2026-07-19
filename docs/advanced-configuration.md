# 進階設定

這份文件放比較細的設定說明。第一次安裝只需要看主 [README](../README.md)。

## 重要觀念

Ollama Cloud Proxy 有兩種 key：

- **Ollama Cloud API key**：proxy 連到 Ollama Cloud 用。請在 Admin UI 的 key pool 新增。
- **Client API key**：OpenClaw、Kilo Code、VS Code 或其他工具連 proxy 用。請在 Admin UI 建立。

工具端建議只拿 client API key，不要直接拿真正的 Ollama Cloud API key。

## 必備設定

| 變數 | 說明 |
| --- | --- |
| `PORT` | proxy 監聽 port，預設 `11435` |
| `KEY_ENCRYPTION_SECRET` | 加密保存 key 的 secret，務必備份 |
| `DB_PATH` | SQLite DB 路徑，Docker 預設 `/data/ollama-cloud-proxy.sqlite` |

`KEY_ENCRYPTION_SECRET` 遺失時，資料庫裡已加密保存的 key 不能解密，只能重新新增或輪替。

## Client API key

建議在 Admin UI 建立 client API key。也可以用舊的 `.env` 格式作為 fallback：

```env
CLIENT_API_KEYS=openclaw:openclaw-token,kilo:kilo-token
```

如果 DB 或 env 裡有任何 client key，推理路徑就需要 Bearer token。

## 上游與 Web Search

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `OLLAMA_UPSTREAM_BASE_URL` | `https://ollama.com` | Ollama Cloud API base URL |
| `OLLAMA_WEB_BASE_URL` | `https://ollama.com` | Ollama Web Search / Fetch base URL |
| `OLLAMA_WEB_SEARCH_PATH` | `/api/web_search` | Web Search path |
| `OLLAMA_WEB_FETCH_PATH` | `/api/web_fetch` | Web Fetch path |
| `OLLAMA_WEB_TIMEOUT_MS` | `30000` | Web Search / Fetch timeout |

## 官方用量 Cookie

Admin UI 可以替每把 key 保存 Ollama Cloud usage cookie，用來讀取官方 5hr / weekly 用量。

也可以設定 env fallback：

```env
OLLAMA_USAGE_COOKIE=__Secure-session=...
```

多帳號時建議在 Admin UI 設定 per-key cookie，不要只用 env fallback。

公開用量 API 與刷新/估算設定：

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `USAGE_API_ENABLED` | `true` | 公開 `/api/usage*` 與自動 ledger/刷新 hooks；不影響 Admin 手動刷新 |
| `USAGE_OFFICIAL_STALE_SECONDS` | `900` | 最近成功官方確認超過多久標為 stale |
| `USAGE_REFRESH_DEBOUNCE_SECONDS` | `300` | 有流量 account 的刷新 debounce |
| `USAGE_REFRESH_JITTER_SECONDS` | `30` | 避免多帳號同時刷新的隨機延遲上限 |
| `USAGE_ESTIMATE_UNITS_PER_SUCCESS` | `1` | 每次成功上游請求增加的標準化估算點數 |

公開 schema 與 OpenClaw 串接方式見 [OpenClaw 用量整合](./openclaw-usage-integration.md)。

## 併發與排隊

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `MAX_CONCURRENT_REQUESTS` | `5` | 全域同時送往上游的 request 數 |
| `MAX_CONCURRENT_REQUESTS_PER_KEY` | `1` | 單把 key 同時處理的 request 數 |
| `REQUEST_QUEUE_MAX` | `30` | 最多排隊 request 數 |
| `REQUEST_QUEUE_TIMEOUT_MS` | `120000` | 排隊最多等待毫秒 |
| `UPSTREAM_TOTAL_TIMEOUT_MS` | `900000` | 單次上游請求總逾時 |
| `UPSTREAM_IDLE_TIMEOUT_MS` | `180000` | streaming idle 逾時 |
| `KEY_SELECTION_MODE` | `ordered` | `ordered` 依建立順序使用第一把可用 key，5hr / weekly 額度受限後才切下一把；`balanced` 使用舊版分數排序與前三名隨機，較偏向均衡分散 |
| `KEY_RETRY_POLICY` | `smart` | key/quota 類錯誤會在同一請求中嘗試下一把 selectable key |
| `MAX_KEY_ATTEMPTS_PER_REQUEST` | `all` | 單一請求最多嘗試幾把 key；`all` 代表當下所有可用 key |
| `MAX_NETWORK_RETRY_ATTEMPTS` | `3` | network/provider 類錯誤最多跨 key 重試次數 |

## Model alias

如果工具端不好填完整 model name，可以用 alias：

```env
MODEL_ALIASES_JSON={"kilo-default":"actual-upstream-model","fast":"another-model"}
```

效果：

- `/v1/chat/completions` 和 `/v1/completions` 會改寫 `model`。
- `/v1/models` 會額外列出 alias。
- `/api/chat` 和 `/api/generate` 預設也會改寫 `body.model`。

如要關閉 Ollama native 的 alias 改寫：

```env
OLLAMA_NATIVE_APPLY_ALIASES=false
```

也可以在專案根目錄放 `model-aliases.json`。

## 用量重置設定

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `USAGE_TIMEZONE` | `Asia/Taipei` | 用量時間顯示與推算時區 |
| `SESSION_RESET_MODE` | `fixed_anchor` | 5hr session reset 推算模式 |
| `SESSION_RESET_ANCHOR` | `2026-06-06T20:00:00.000Z` | 5hr session reset 錨點 |
| `SESSION_RESET_INTERVAL_HOURS` | `5` | session reset 間隔 |
| `WEEKLY_RESET_MODE` | `fixed_weekly` | weekly reset 推算模式 |
| `WEEKLY_RESET_DAY_OF_WEEK` | `1` | weekly reset 星期，`1` 是星期一 |
| `WEEKLY_RESET_TIME` | `08:30` | weekly reset 時間 |
| `WEEKLY_RESET_GRACE_MINUTES` | `5` | weekly reset 後寬限分鐘 |
| `WEEKLY_REACTIVATION_JITTER_SECONDS` | `180` | 解凍時隨機抖動秒數 |

這些也可以在 Admin UI 調整，會保存到 SQLite。

## 外網與反向代理

不建議直接把 Docker port `11435` 裸露到 Internet。

外網使用建議：

- 使用 HTTPS。
- `/admin` 放在 VPN、Tailscale、Cloudflare Access、IP allowlist 或內網後面。
- 一定要建立 client API key。
- 反向代理要設定足夠長的 read timeout。
- streaming/SSE 或 NDJSON 場景要關閉 response buffering。

## 資料與備份

請備份：

- `.env`
- `data/`
- YAML 匯出檔，如果你有匯出

不要 commit：

- `.env`
- `data/`
- SQLite DB
- 完整 Ollama Cloud API key
- Admin 密碼或 token
- Client API key
- `KEY_ENCRYPTION_SECRET`
