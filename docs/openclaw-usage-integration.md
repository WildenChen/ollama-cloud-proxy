# OpenClaw 用量整合

Ollama Cloud Proxy 提供公開、唯讀的 provider usage snapshot，讓 OpenClaw provider plugin 查詢整個 key pool 的 5 小時與每週額度。這一階段只提供 JSON API，不修改或安裝 OpenClaw core/plugin。

## Endpoint 與認證

```text
GET /api/usage
GET /api/usage/accounts
```

兩個 GET endpoint 不需要認證。回應只使用穩定的匿名 `account_id`，不回傳 key 名稱、API key preview、Cookie、token 或備註。

若 proxy 可從 Internet 存取，應在反向代理限制來源或只允許內網/VPN，因為 usage metadata 雖不含憑證，仍可能揭露帳號數量與可用狀態。

強制刷新不是公開 API。沿用既有管理員認證：

```text
POST /admin/keys/:accountId/usage-refresh
POST /admin/usage-overview/refresh
```

## 快速驗證

```bash
curl -fsS http://localhost:11435/api/usage | jq .
curl -fsS http://localhost:11435/api/usage/accounts | jq .
```

停用公開 API 與自動 ledger/刷新 hooks：

```env
USAGE_API_ENABLED=false
```

停用不會刪除已保存的 snapshot 或 ledger，也不會停用管理頁原有的官方用量與手動刷新。

## Overview schema

`GET /api/usage` 回傳：

```json
{
  "provider": "ollama-cloud-proxy",
  "updated_at": "2026-07-19T00:00:00.000Z",
  "accounts_total": 15,
  "accounts_available": 11,
  "accounts_official": 14,
  "accounts_estimated": 1,
  "sources": {
    "official": 14,
    "estimated": 1,
    "local_only": 0,
    "unknown": 0
  },
  "windows": [
    {
      "label": "5h",
      "used": 419.4,
      "limit": 1500,
      "used_percent": 27.96,
      "remaining": 1080.6,
      "remaining_percent": 72.04,
      "source": "mixed",
      "next_reset_at": "2026-07-19T01:00:00.000Z",
      "latest_reset_at": "2026-07-19T04:00:00.000Z",
      "reset_buckets": [
        { "reset_at": "2026-07-19T01:00:00.000Z", "accounts_count": 8 }
      ]
    }
  ]
}
```

聚合只計算 enabled accounts。任一 enabled account 缺少可計算資料時，該 window 的 `source` 是 `unknown`，數值欄位為 `null`，不回傳不完整的假總額。

## Accounts schema

`GET /api/usage/accounts` 回傳 `provider`、`updated_at` 與 `accounts[]`。每個 account 至少包含：

```json
{
  "account_id": "stable-uuid",
  "enabled": true,
  "available": true,
  "official": {
    "five_hour": {},
    "weekly": {},
    "fetched_at": "2026-07-19T00:00:00.000Z",
    "checked_at": "2026-07-19T00:05:00.000Z",
    "changed_at": "2026-07-19T00:00:00.000Z",
    "source": "ollama_cloud_settings"
  },
  "estimate": {
    "five_hour": {},
    "weekly": {}
  },
  "effective": {
    "five_hour": {},
    "weekly": {},
    "five_hour_source": "estimated",
    "weekly_source": "estimated",
    "source": "estimated"
  },
  "stale": false,
  "last_error_code": null,
  "last_error_at": null
}
```

每個 window 包含 `used`、`limit`、`used_percent`、`remaining`、`remaining_percent`、`reset_at`。Estimate 另含 `local_units` 與已知的 `local_tokens`。

## 數值與來源定義

- 每個 account 的 5h/weekly limit 預設為 100 個標準化額度點，可分別設定；官方百分比按該 limit 換算。
- 每次成功上游請求預設記 1 點，可用 `USAGE_ESTIMATE_UNITS_PER_SUCCESS` 調整。Token 只作佐證，不用來宣稱官方額度。
- `official`：最近一次官方確認後沒有新的本地消耗。
- `official_adjusted`：保留的相容值；第一版不輸出。
- `estimated`：最近官方 snapshot 加上後續本地額度點，或最近官方查詢失敗而沿用 snapshot。
- `local_only`：沒有仍適用的官方 window，但有本地 ledger。
- `unknown`：沒有足夠的官方或本地資料。
- Aggregate `official` 代表全部 account 都是 official；`mixed` 代表 official 與估算混合；`estimated` 代表全部可計算資料都不是純 official；`unknown` 代表無法計算完整總額。

`stale=true` 表示最近成功的官方 `checked_at` 超過 `USAGE_OFFICIAL_STALE_SECONDS`（預設 15 分鐘）或從未成功確認。官方失敗不會清空最後 snapshot；錯誤只以安全代碼與時間公開。

`next_reset_at` 與 `latest_reset_at` 是 enabled accounts 中最早與最晚的 reset。不同 reset 不會被偽裝為同一時間，完整分布在 `reset_buckets`。

## 刷新策略

- 模型請求不等待官方 Cookie 查詢。
- 成功流量在預設 5 分鐘 debounce 後刷新該 account；同 account 使用 single-flight。
- 15 分鐘未確認且即將使用、收到 429、或 Cookie 新增/替換時，非同步刷新該 account。
- 沒有第一版全池定時輪詢。管理員手動全刷使用有限並行與 jitter。

## 未來 OpenClaw plugin

Provider plugin 可在 `fetchUsageSnapshot` 讀取 `/api/usage`，把 `windows[]` 映射到 OpenClaw usage window。因 GET 公開，`resolveUsageAuth` 可回傳無憑證設定；如果部署端在反向代理加認證，再由該函式提供對應 header。

Plugin manifest 必須宣告：

```json
{
  "contracts": {
    "usageProviders": ["ollama-cloud-proxy"]
  }
}
```

OpenClaw plugin 是獨立第二階段；不要為此修改 OpenClaw core。
