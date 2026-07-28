# 開發與測試

這份文件給要改程式碼的人。一般安裝請看主 [README](../README.md)。

## 專案結構

```text
src/
  index.ts                    # Bun server 入口
  server/router.ts            # /health、/admin、/v1/*、/api/* 路由
  proxy/                       # 請求轉送、body limit、streaming
  keyPool/                     # key 選擇、狀態更新、錯誤分類
  concurrency/                 # 全域併發與等待佇列
  admin/                       # Admin JSON API
  storage/database.ts          # SQLite schema 與資料操作
  models/modelManager.ts       # model alias 與 /v1/models cache
  security/                    # client/admin auth 與 key 加密
public/admin/                  # HTML Admin UI
scripts/init-env.sh            # 安全建立 .env 與加密 secret
tests/                         # Bun tests
```

## 本機開發

需要 Bun `1.2.19`，與 Dockerfile 及 CI 使用的版本一致。

```bash
bun install --frozen-lockfile
bun run dev
```

第一次啟動前可執行：

```bash
sh scripts/init-env.sh
```

測試：

```bash
bun test
```

如果主機沒有 Bun，可用 Docker 跑測試：

```bash
docker run --rm -v "$PWD":/app -w /app oven/bun:1.2.19-slim bun test
```

## Docker build

本機 source build：

```bash
docker compose up -d --build
```

Dockerfile 會複製 `bun.lockb` 並使用 `bun install --production --frozen-lockfile`，確保正式映像與測試使用相同依賴版本。

Release image：

```bash
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

## CI 品質閘門

`.github/workflows/quality.yml` 在每個 Pull Request 與 `main` push 執行：

1. 使用固定 Bun `1.2.19`。
2. `bun install --frozen-lockfile`。
3. 檢查初始化腳本語法。
4. 執行全部 Bun tests。
5. 執行單平台 Docker build 驗證，但不 push image。

PR 應先通過 `Quality` 才合併。建議在 GitHub branch protection 將 `Quality / test-and-build` 設為必要檢查。

正式多架構發布由 `.github/workflows/docker-publish.yml` 處理：

- `main` 的 Quality 成功後，才建立並推送 `latest` 與 SHA image。
- 版本 tag 會發布 tag 與 SHA image。
- 手動觸發仍可用於維運重建。

## 測試覆蓋

目前測試包含：

- 啟動設定拒絕不安全的範例 secret 與固定 client token
- `.env` 初始化腳本產生 secret 且可安全重複執行
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

1. 確認 PR 的 `Quality / test-and-build` 通過。
2. 更新 `package.json` version。
3. 更新 `src/config/version.ts`。
4. 更新 Admin UI cache-busting query。
5. 更新 `docs/changelog.md`。
6. 合併至 `main`，等待 Quality 成功與 GHCR 多架構 image 發布。
7. 建立並 push 版本 tag。
8. 用 release compose 拉新 image 並驗證 `/health`。
