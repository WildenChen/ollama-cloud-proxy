# Ollama Cloud Proxy

把多把 Ollama Cloud API Key 集中管理，讓 OpenMinis、OpenClaw、Hermes、Kilo Code、VS Code 與自製工具共用同一個安全入口。

目前版本：`1.7.0`

## 主要功能

```text
OpenMinis / OpenClaw / Hermes / IDE / 自製工具
                         ↓
                  Proxy 專屬金鑰
                         ↓
                  Ollama Cloud Proxy
                         ↓
                 Ollama Cloud Key Pool
```

- 集中管理一把或多把 Ollama Cloud 上游 API Key。
- 自動避開失效、冷卻中或額度受限的上游金鑰。
- 支援 `ordered` 與 `balanced` 兩種金鑰選取模式。
- 為不同工具建立可獨立停用、更換的 Proxy 專屬金鑰。
- 支援 OpenAI Chat Completions、OpenAI Responses API 與 Ollama native API。
- 支援 Responses API 非串流、SSE 串流、tools/function calling、reasoning 與模型別名。
- 提供 Ollama Web Search、Web Fetch 與搜尋供應商相容介面。
- 顯示每把金鑰的 5hr、每週用量、重置時間與狀態。
- 顯示請求、模型、錯誤與客戶端活動紀錄。
- 對上游 4xx 錯誤保留安全化後的具體原因，不洩漏憑證。
- 支援手機與桌面管理介面、YAML 匯入匯出與 Docker 持久化更新。

## 五分鐘快速安裝

### 1. 下載專案

```bash
git clone https://github.com/WildenChen/ollama-cloud-proxy.git
cd ollama-cloud-proxy
```

### 2. 建立安全設定

```bash
sh scripts/init-env.sh
```

這個指令會從 `.env.example` 建立 `.env`，並自動產生 `KEY_ENCRYPTION_SECRET`。再次執行不會覆蓋既有密鑰。

### 3. 啟動服務

```bash
docker compose -f docker-compose.release.yml up -d
```

### 4. 確認服務正常

```bash
curl http://localhost:11435/health
```

應看到類似：

```json
{"status":"ok","version":"1.7.0"}
```

### 5. 開啟管理頁

```text
http://localhost:11435/admin
```

## 第一次設定

建議依序完成：

1. 建立管理密碼。
2. 新增至少一把 Ollama Cloud 上游 API Key。
3. 等待管理台驗證上游金鑰。
4. 為 OpenMinis、OpenClaw 或其他工具建立獨立的 Proxy 專屬金鑰。
5. 立即複製並保存完整 Proxy 專屬金鑰。
6. 把 Base URL 與 Proxy 專屬金鑰填入工具。
7. 測試模型請求。
8. 確認所有工具完成切換後，再啟用存取保護。

完整 Proxy 專屬金鑰只會在建立或更換當下顯示一次。管理台之後只保留安全前綴。

## 三種憑證不要混用

| 名稱 | 用途 | 必要性 |
| --- | --- | --- |
| Ollama Cloud 上游金鑰 | Proxy 連線到 Ollama Cloud | 至少一把 |
| Proxy 專屬金鑰 | OpenMinis、OpenClaw 等工具連線到 Proxy | 建議啟用 |
| Usage Cookie | 讀取 Ollama Cloud 官方用量 | 選填 |

外部工具只能填 **Proxy 專屬金鑰**，不要把真正的 Ollama Cloud 上游金鑰散落在各個工具中。

沒有 Usage Cookie 時，模型代理仍可正常運作，只是管理台無法顯示官方 5hr 與每週剩餘用量。

## API 支援矩陣

| 用途 | 方法與路徑 | 支援狀態 | 適合情境 |
| --- | --- | --- | --- |
| OpenAI Responses API | `POST /v1/responses` | 支援非串流與串流 | OpenMinis、新版 OpenAI SDK、Agent Framework |
| Chat Completions | `POST /v1/chat/completions` | 支援 | 傳統 OpenAI-compatible 工具 |
| Legacy Completions | `POST /v1/completions` | 支援 | 舊版文字補全客戶端 |
| Model List | `GET /v1/models` | 支援 | 模型探索與連線測試 |
| Ollama Chat | `POST /api/chat` | 支援 | Ollama native 客戶端 |
| Ollama Generate | `POST /api/generate` | 支援 | Ollama native 文字生成 |
| Ollama Tags | `GET /api/tags` | 支援 | Ollama 模型清單 |
| Web Search | `POST /v1/web/search` | 支援 | 搜尋公開網路 |
| Web Fetch | `POST /v1/web/fetch` | 支援 | 讀取指定網頁 |
| Search Provider | `GET/POST /v1/search` | 支援 | Omni Search 相容客戶端 |

OpenAI-compatible 工具的 Base URL：

```text
http://你的主機:11435/v1
```

Ollama native 工具的 Base URL：

```text
http://你的主機:11435
```

工具在其他裝置時，請把 `localhost` 改成 Docker 主機的 LAN IP 或 HTTPS 網域。

## OpenAI Responses API

### 非串流請求

```bash
curl -X POST http://localhost:11435/v1/responses \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "minimax-m3",
    "instructions": "請使用繁體中文回答。",
    "input": "說明這個服務的用途",
    "max_output_tokens": 300
  }'
```

Proxy 會原樣保留 Responses API 的輸出結構，並套用既有的模型別名、Key Pool、Concurrency、重試與錯誤分類。

### 串流請求

```bash
curl -N -X POST http://localhost:11435/v1/responses \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "minimax-m3",
    "input": "用三點說明 AI Agent",
    "stream": true
  }'
```

串流事件會以 Ollama Cloud 回傳的 SSE 格式直接轉送。

### Function calling

```bash
curl -X POST http://localhost:11435/v1/responses \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "minimax-m3",
    "input": "台北現在天氣如何？",
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "查詢指定城市天氣",
        "parameters": {
          "type": "object",
          "properties": {
            "city": { "type": "string" }
          },
          "required": ["city"]
        }
      }
    ]
  }'
```

`tools`、`input`、`instructions`、`reasoning`、`temperature`、`top_p` 與 `max_output_tokens` 都會保留並送往上游。

### Non-stateful 限制

Ollama Cloud 目前提供的是非狀態 Responses API。Proxy 會在本地明確拒絕以下欄位，不會把不支援的請求送往上游：

- `previous_response_id`
- `conversation`

收到這類請求時會回傳：

```json
{
  "error": {
    "message": "Ollama Cloud Responses API is non-stateful; previous_response_id is not supported",
    "type": "unsupported_responses_state",
    "details": {
      "field": "previous_response_id",
      "mode": "non-stateful"
    }
  }
}
```

需要多輪對話時，請由客戶端把必要的歷史內容重新放入 `input`，不要依賴伺服器保存前一個 response。

## Chat Completions

```bash
curl -X POST http://localhost:11435/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "minimax-m3",
    "messages": [
      { "role": "user", "content": "你好" }
    ]
  }'
```

既有客戶端不需要改用 Responses API；`/v1/chat/completions` 會繼續支援。

## Web Search 與 Web Fetch

### 搜尋網路

```bash
curl -X POST http://localhost:11435/v1/web/search \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Ollama Responses API","max_results":5}'
```

### 讀取網頁

```bash
curl -X POST http://localhost:11435/v1/web/fetch \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://ollama.com"}'
```

## 金鑰管理

### Ollama Cloud 上游金鑰

管理頁可：

- 新增、測試、停用及刪除金鑰。
- 設定名稱、備註與 Usage Cookie。
- 查看可用、冷卻、失效與額度受限狀態。
- 設定 5hr 與每週最低剩餘百分比。
- 手動刷新官方用量。

### Proxy 專屬金鑰

管理頁可：

- 為每個工具建立獨立金鑰。
- 查看來源、狀態、前綴與最近使用時間。
- 停用、重新啟用或刪除資料庫型金鑰。
- 建立替代金鑰，讓新舊金鑰並存後再逐步切換。
- 分別測試金鑰驗證、上游可用性與模型狀態。

`.env` 中既有的 `CLIENT_API_KEYS` 仍可使用，但在管理頁只會顯示為唯讀來源，不會顯示完整 token，也不會自動遷移。

## 存取保護與升級相容性

既有部署沒有 Proxy 專屬金鑰時，升級後會維持匿名模式，不會突然中斷現有工具。

建立第一把 Proxy 專屬金鑰後，也不會立刻強制驗證。建議先更新並測試所有客戶端，再從管理頁明確啟用存取保護。

## 金鑰選取模式

管理頁「設定」可選擇：

- `ordered`：固定從第一把可用金鑰開始，受限後切換下一把。
- `balanced`：依可用狀態與近期負載分散請求。

設定保存在資料庫中，不需要重啟服務。

## 更新方式

```bash
git pull
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

確認版本：

```bash
curl http://localhost:11435/health
```

目前應顯示版本 `1.7.0`。資料保存在本機 `data/`，更新容器不會刪除既有設定。

## 備份與還原

更新前至少備份：

- `.env`
- `data/`

`KEY_ENCRYPTION_SECRET` 必須妥善保存。若遺失，資料庫內加密保存的上游金鑰、Cookie 與 Proxy 專屬金鑰將無法解密。

管理頁也提供 YAML 匯出與匯入。匯出檔含有敏感憑證，請將它視為密碼檔保存。

## 常見問題

### 工具回傳 401

確認：

- 工具填的是 Proxy 專屬金鑰，不是 Ollama Cloud 上游金鑰。
- Base URL 是否正確。
- Proxy 專屬金鑰是否啟用。
- 管理頁的存取保護狀態是否符合預期。

### Responses API 回傳 unsupported_responses_state

客戶端送出了 `previous_response_id` 或 `conversation`。請停用客戶端的 stateful Responses 模式，並由客戶端自行帶入對話歷史。

### 上游回傳 400

Proxy 會保留安全化後的上游 `message`、`type`、`code` 與 validation details。請依回傳內容修正 `input`、`tools`、message 格式或模型專屬參數；換 Key 通常無法解決 payload 錯誤。

### 沒有官方用量資料

確認該上游金鑰是否設定有效的 Usage Cookie。Cookie 只影響官方用量顯示，不影響模型請求。

### 打不開管理頁

```bash
docker ps
docker compose -f docker-compose.release.yml logs --tail=100
```

## 進階文件

- [文件索引](./docs/README.md)
- [工具接入指南](./docs/tool-integrations.md)
- [API 與路徑參考](./docs/api-reference.md)
- [環境變數參考](./docs/configuration.md)
- [Proxy 金鑰升級指南](./docs/proxy-key-upgrade.md)
- [OpenClaw 用量整合](./docs/openclaw-usage-integration.md)
- [開發與發布](./docs/development.md)
- [版本更新紀錄](./docs/changelog.md)

## 開發方式

```bash
bun install
bun test
docker build -t ollama-cloud-proxy:local .
```

## 授權

MIT
