# 工具接入指南

這份文件說明 OpenClaw、Kilo Code、VS Code 或自製工具要怎麼連 Ollama Cloud Proxy。

## 路徑怎麼選

| Client 需要 | 使用路徑 | 說明 |
| --- | --- | --- |
| OpenAI-compatible chat | `/v1/chat/completions` | 適合 Kilo Code、OpenAI-compatible provider |
| OpenAI-compatible base URL | `/v1` | 多數工具只要填到 `/v1` |
| Ollama native root | `/` | 適合使用 Ollama provider 的工具 |
| Ollama native chat | `/api/chat` | 保留 Ollama native payload |
| Ollama native generate | `/api/generate` | 保留 Ollama native payload |

如果不確定，通常先用 OpenAI-compatible：

```text
http://你的主機:11435/v1
```

API key 填 Admin UI 裡建立的 client API key。

## OpenClaw

### OpenAI-compatible 模式

Base URL：

```text
http://你的主機:11435/v1
```

API Key：

```text
管理頁建立的 client API key
```

這是比較容易成功的方式。

### Ollama native 模式

如果 OpenClaw 設定使用 `api: "ollama"`，Base URL 請填 proxy root，不要加 `/api`：

```text
http://你的主機:11435
```

OpenClaw 會自己呼叫：

- `/api/version`
- `/api/tags`
- `/api/chat`

## Kilo Code

建議使用 OpenAI Compatible provider：

- Provider: OpenAI Compatible
- Base URL: `http://你的主機:11435/v1`
- API Key: 管理頁建立的 client API key
- Model: 真實 model name，或你設定的 model alias

Base URL 請填到 `/v1`，不要填成 `/v1/chat/completions`。

## VS Code Copilot

如果使用 Ollama provider，URL 填 proxy root：

```text
https://你的網域
```

這會用 `/api/version`、`/api/tags`、`/api/ps` 做 discovery。

如果 VS Code 沒有把 Authorization header 帶到 `/api/chat`，實際推理可能會失敗。這時建議改用 Custom Endpoint / OpenAI-compatible，URL 填：

```text
https://你的網域/v1
```

## 自製工具

OpenAI-compatible 範例：

```bash
curl http://localhost:11435/v1/chat/completions \
  -H "Authorization: Bearer your-client-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-oss:20b",
    "messages": [
      { "role": "user", "content": "hello" }
    ],
    "stream": false
  }'
```

Ollama native 範例：

```bash
curl http://localhost:11435/api/chat \
  -H "Authorization: Bearer your-client-token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-oss:20b",
    "messages": [
      { "role": "user", "content": "hello" }
    ],
    "stream": false
  }'
```

## Web Search / Web Fetch

Proxy endpoints：

- `POST /v1/search`
- `POST /v1/web/search`
- `POST /v1/web/fetch`
- `POST /api/web_search`
- `POST /api/web_fetch`

Search 範例：

```bash
curl -X POST http://localhost:11435/v1/search \
  -H "Authorization: Bearer your-client-token" \
  -H "Content-Type: application/json" \
  -d '{"query":"Ollama Cloud docs","provider":"ollama-search","max_results":3}'
```

Fetch 範例：

```bash
curl -X POST http://localhost:11435/v1/web/fetch \
  -H "Authorization: Bearer your-client-token" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://ollama.com"}'
```
