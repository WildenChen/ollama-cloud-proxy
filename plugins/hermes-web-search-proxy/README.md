# Hermes Web Search Proxy Plugin 使用說明

`hermes-web-search-proxy` 是給 Hermes Agent 使用的自訂工具 plugin，透過 `ollama-cloud-proxy` 呼叫 Ollama 官方 Web Search / Web Fetch API。

這個 plugin 的重點是：Hermes 只需要知道 proxy 的 `client_token`，不需要、也不應該知道任何 Ollama API key。

## 架構

```text
Hermes Agent
  -> hermes-web-search-proxy plugin
  -> ollama-cloud-proxy /v1/web/search 或 /v1/web/fetch
  -> Ollama 官方 /api/web_search 或 /api/web_fetch
```

憑證分工：

- Hermes plugin -> proxy：使用 `CLIENT_API_KEYS` 裡的 client token。
- proxy -> ollama.com：由 proxy 從 key pool 選取 Ollama API key。
- plugin 不讀取 `OLLAMA_API_KEY`，也不直接呼叫 `ollama.com`。

## 提供的工具

### proxy_web_search

透過 proxy 執行 Web Search。

Input：

```json
{
  "query": "string",
  "max_results": 5
}
```

欄位：

- `query`：必填，搜尋字串。
- `max_results`：選填，預設使用 `config.json` 裡的 `max_results`；proxy 端最大值是 `10`。

回傳格式由 proxy 正規化：

```json
{
  "results": [
    {
      "title": "...",
      "url": "...",
      "content": "..."
    }
  ],
  "backend": "ollama-web-search",
  "duration_ms": 1234
}
```

### proxy_web_fetch

透過 proxy fetch 指定網頁內容。

Input：

```json
{
  "url": "https://ollama.com"
}
```

回傳格式由 proxy 正規化：

```json
{
  "title": "...",
  "content": "...",
  "links": ["..."],
  "backend": "ollama-web-fetch",
  "duration_ms": 1234
}
```

## 前置需求

1. `ollama-cloud-proxy` 已啟動。
2. proxy 已在 Admin UI 或 Admin API 新增至少一把可用的 Ollama API key。
3. proxy `.env` 已設定 `CLIENT_API_KEYS`，例如：

```env
CLIENT_API_KEYS=hermes:your-hermes-client-token
```

4. proxy 可以呼叫 Ollama 官方 Web API，預設設定如下：

```env
OLLAMA_WEB_BASE_URL=https://ollama.com
OLLAMA_WEB_SEARCH_PATH=/api/web_search
OLLAMA_WEB_FETCH_PATH=/api/web_fetch
OLLAMA_WEB_TIMEOUT_MS=30000
```

## 安裝

從 repo 根目錄複製 plugin 到 Hermes plugin 目錄：

```bash
mkdir -p ~/.hermes/plugins
cp -R plugins/hermes-web-search-proxy ~/.hermes/plugins/
cp ~/.hermes/plugins/hermes-web-search-proxy/config.example.json ~/.hermes/plugins/hermes-web-search-proxy/config.json
```

接著編輯：

```text
~/.hermes/plugins/hermes-web-search-proxy/config.json
```

如果你的 Hermes 版本支援 plugin install / enable / list，請依本機實際支援的指令啟用。不同 Hermes 版本的 CLI 參數可能不同；請依 `hermes plugins list/install/enable` 實際支援指令調整，不要照抄未確認的 `--path` 或 `--enable` 參數。

## config.json

範例：

```json
{
  "base_url": "http://127.0.0.1:11435",
  "client_token": "change-me",
  "search_path": "/v1/web/search",
  "fetch_path": "/v1/web/fetch",
  "timeout_seconds": 30,
  "max_results": 5
}
```

欄位說明：

| 欄位 | 必填 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `base_url` | 是 | `http://127.0.0.1:11435` | `ollama-cloud-proxy` 的 base URL。 |
| `client_token` | 是 | 無 | proxy `CLIENT_API_KEYS` 裡設定的 client token。不要填 Ollama API key。 |
| `search_path` | 否 | `/v1/web/search` | proxy web search endpoint。 |
| `fetch_path` | 否 | `/v1/web/fetch` | proxy web fetch endpoint。 |
| `timeout_seconds` | 否 | `30` | plugin 呼叫 proxy 的 HTTP timeout。 |
| `max_results` | 否 | `5` | `proxy_web_search` 未指定 `max_results` 時使用的預設值。 |

## 快速測試 proxy

在測 Hermes plugin 前，建議先確認 proxy endpoint 正常。

Web Search：

```bash
curl -X POST http://127.0.0.1:11435/v1/web/search \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Hermes Agent plugin web search","max_results":3}'
```

Web Fetch：

```bash
curl -X POST http://127.0.0.1:11435/v1/web/fetch \
  -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://ollama.com"}'
```

如果 curl 失敗，請先修 proxy、client token、key pool 或網路連線，再測 Hermes plugin。

## Python module 使用方式

Hermes 的 plugin loader 可能會呼叫 `get_tools()` 與 `call_tool()`；這個 plugin 也保留可直接呼叫的 Python function，方便本機除錯。

可用 entrypoints：

- `get_tools()`：回傳工具 schema。
- `call_tool(name, arguments)`：依工具名稱呼叫。
- `proxy_web_search(query, max_results=None)`：直接搜尋。
- `proxy_web_fetch(url)`：直接 fetch。

範例：

```python
from plugins.hermes_web_search_proxy import call_tool

result = call_tool("proxy_web_search", {
    "query": "Ollama Web Search API",
    "max_results": 3,
})
print(result)
```

實際在 Hermes 裡的載入方式仍以你的 Hermes 版本為準。

## 錯誤處理

plugin 會以可讀 JSON 回傳錯誤，不會把 token 印到錯誤訊息中。常見錯誤：

| 錯誤 | 可能原因 | 處理方式 |
| --- | --- | --- |
| `Missing config` | 尚未建立 `config.json` | 從 `config.example.json` 複製一份。 |
| `client_token is required` | `client_token` 未填或仍是 `change-me` | 填入 proxy `CLIENT_API_KEYS` 裡的 token。 |
| `Proxy returned HTTP 401` | client token 錯誤 | 檢查 proxy `.env` 的 `CLIENT_API_KEYS`。 |
| `Proxy returned HTTP 503` | proxy 沒有可用 Ollama key 或上游暫時失敗 | 檢查 Admin UI key 狀態、cooldown、quota 與事件。 |
| `Proxy request failed` | proxy 未啟動、base URL 錯誤或 timeout | 檢查 `base_url` 與 proxy server 狀態。 |

## 安全注意

- 不要把 Ollama API key 放進 `config.json`。
- 不要把 `client_token` commit 到 git。
- 如果需要分享 plugin 目錄，請只分享 `config.example.json`，不要分享本機 `config.json`。
- plugin 不會主動記錄完整搜尋結果、HTTP headers 或 token。
- proxy 端也不應記錄完整 API key、client token 或 fetched page content。

## 限制

- `plugin.yaml` 與 `__init__.py` 是保守的最小可用實作；Hermes CLI 或 plugin loader 若有版本差異，請依本機 Hermes 文件調整。
- plugin 不直接實作 retry；retry、key rotation、upstream error classification 由 `ollama-cloud-proxy` 負責。
- `max_results > 10` 會由 proxy 回 `400 invalid_request`。

## 建議工作流

1. 先用 curl 確認 `/v1/web/search` 與 `/v1/web/fetch` 正常。
2. 複製 plugin 並建立 `config.json`。
3. 用 Hermes 實際支援的 plugin 指令啟用。
4. 在 Hermes 裡測 `proxy_web_search`。
5. 若失敗，先看 plugin 回傳錯誤，再看 proxy Admin UI events。
