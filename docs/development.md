# 開發與測試

這份文件給要改程式碼的人。一般安裝請看主 [README](../README.md)。

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
public/admin/                  # HTML Admin UI
tests/                         # Bun tests
```

## 本機開發

需要 Bun。

```bash
bun install
bun run dev
```

測試：

```bash
bun test
```

如果主機沒有 Bun，可用 Docker 跑測試：

```bash
docker run --rm -v "$PWD":/app -w /app oven/bun:1.1.42-slim bun test
```

## Docker build

本機 source build：

```bash
docker compose up -d --build
```

Release image：

```bash
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

## 測試覆蓋

目前測試包含：

- weekly reset 時間推算
- Admin key 建立與 API key 不外洩
- Admin password setup/change
- client API key 驗證
- YAML 匯入匯出
- soft delete
- mock upstream 轉送
- upstream `401` 使 key 變成 invalid
- model alias rewrite
- `/v1/*` OpenAI-compatible 路徑
- `/api/version`、`/api/ps`、`/api/tags`、`/api/chat`、`/api/generate`
- native streaming 與 tool call payload 保持不變

## Release checklist

1. 更新 `package.json` version。
2. 更新 `src/config/version.ts`。
3. 更新 Admin UI cache-busting query。
4. 更新 `docs/changelog.md`。
5. 跑測試。
6. Build Docker image。
7. Commit、tag、push。
8. Push GHCR image。
9. 用 release compose 拉新 image 並驗證 `/health`。
