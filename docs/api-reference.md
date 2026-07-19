# Admin API 與路徑參考

一般使用者建議用 Admin UI。這份文件給需要 curl、腳本或自動化的人。

## 健康與版本

```bash
curl http://localhost:11435/health
curl http://localhost:11435/api/version
```

## 公開用量 API

```bash
curl http://localhost:11435/api/usage | jq .
curl http://localhost:11435/api/usage/accounts | jq .
```

兩個 endpoint 都是公開唯讀，僅回傳匿名 account ID 與額度資料。完整 schema、來源與 stale/reset 定義見 [OpenClaw 用量整合](./openclaw-usage-integration.md)。強制刷新仍需要下方的 Admin 認證。

## Admin 認證

查詢狀態：

```bash
curl http://localhost:11435/admin/auth/status
```

首次設定管理密碼：

```bash
curl -X POST http://localhost:11435/admin/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"password":"new-admin-password"}'
```

變更管理密碼：

```bash
curl -X POST http://localhost:11435/admin/auth/change-password \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"old-password","newPassword":"new-password"}'
```

## Ollama Cloud upstream keys

列出 keys：

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/keys
```

新增 key：

```bash
curl -X POST http://localhost:11435/admin/keys \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "free-01",
    "apiKey": "ollama_xxxxxxxxx",
    "ollamaUsageCookie": "__Secure-session=...",
    "notes": "optional"
  }'
```

常用操作：

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/keys/<id>/test

curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/keys/<id>/disable

curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/keys/<id>/enable

curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/keys/<id>/reset-cooldown

curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/keys/<id>/usage-refresh
```

輪替 upstream key：

```bash
curl -X POST http://localhost:11435/admin/keys/<id>/rotate \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"ollama_new_xxxxx"}'
```

刪除 key 是 soft delete：列表不再顯示，但事件紀錄保留。

```bash
curl -X DELETE -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/keys/<id>
```

## Client API keys

列出：

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/client-keys
```

建立：

```bash
curl -X POST http://localhost:11435/admin/client-keys \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"name":"openclaw","token":"new-client-token","notes":"optional"}'
```

啟停、輪替、刪除：

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/client-keys/<id>/disable

curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/client-keys/<id>/enable

curl -X POST http://localhost:11435/admin/client-keys/<id>/rotate \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"token":"rotated-client-token"}'

curl -X DELETE -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:11435/admin/client-keys/<id>
```

## YAML 匯入匯出

匯出：

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -o ollama-cloud-proxy-export.yaml \
  http://localhost:11435/admin/export.yaml
```

匯入：

```bash
curl -X POST http://localhost:11435/admin/import.yaml \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/yaml" \
  --data-binary @ollama-cloud-proxy-export.yaml
```

匯入採合併覆蓋：同名項目更新，不存在則建立，不會刪除 YAML 沒列出的既有資料。

## Events

近期事件：

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" \
  "http://localhost:11435/admin/events?limit=100"
```

常用 filters：

- `level=debug|info|warn|error`
- `type=request_finished`
- `clientName=openclaw`
- `keyId=<id>`
- `model=<model>`
- `category=success|failure|quota|auth|network|provider|client`
- `hasUsage=1`

範例：

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" \
  "http://localhost:11435/admin/events?category=failure&limit=100"
```

## Proxy 路徑

| 路徑 | 說明 |
| --- | --- |
| `/v1/models` | OpenAI-compatible model list |
| `/v1/chat/completions` | OpenAI-compatible chat |
| `/v1/completions` | OpenAI-compatible completions |
| `/api/version` | Ollama native version |
| `/api/ps` | Ollama native running models |
| `/api/tags` | Ollama native model list |
| `/api/chat` | Ollama native chat |
| `/api/generate` | Ollama native generate |
| `/v1/search` | normalized web search |
| `/v1/web/search` | Ollama Web Search proxy |
| `/v1/web/fetch` | Ollama Web Fetch proxy |
