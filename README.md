# Ollama Cloud Proxy

把多把 Ollama Cloud API Key 集中管理，讓 OpenClaw、Kilo Code、VS Code 或其他工具共用同一個安全入口。

目前版本：`1.6.3`

## 這個服務能做什麼

Ollama Cloud Proxy 會放在你的工具和 Ollama Cloud 之間：

```text
OpenClaw / Kilo Code / VS Code / 自製工具
                  ↓
          Proxy 專屬金鑰
                  ↓
          Ollama Cloud Proxy
                  ↓
       Ollama Cloud 上游金鑰池
```

主要功能：

- 集中管理一把或多把 Ollama Cloud 上游 API Key。
- 自動避開失效、冷卻中或額度受限的上游金鑰。
- 支援 `ordered` 與 `balanced` 兩種金鑰選取模式。
- 為不同工具建立獨立的 Proxy 專屬金鑰。
- 提供 OpenAI-compatible 與 Ollama native 兩種連線方式。
- 顯示每把金鑰的 5hr、每週用量、重置時間與可用狀態。
- 顯示請求、模型、錯誤與客戶端活動紀錄。
- 提供首次設定指南、錯誤修復指引與安全診斷資訊。
- 支援手機與桌面管理介面。
- 支援 YAML 匯入、匯出與 Docker 持久化更新。

## 三種憑證不要混用

| 名稱 | 用途 | 必要性 |
| --- | --- | --- |
| Ollama Cloud 上游金鑰 | Proxy 連線到 Ollama Cloud | 至少一把 |
| Proxy 專屬金鑰 | OpenClaw、Kilo Code 等工具連線到 Proxy | 建議啟用 |
| Usage Cookie | 讀取 Ollama Cloud 官方用量 | 選填 |

外部工具應使用 **Proxy 專屬金鑰**，不要直接填入真正的 Ollama Cloud 上游金鑰。

## 適合誰

這個服務適合以下情境：

- 有多把 Ollama Cloud API Key，希望集中管理。
- 多個工具需要共用同一組 Ollama Cloud 額度。
- 不想把真正的上游金鑰分散填進每個工具。
- 想知道哪把金鑰失效、冷卻或即將用完。
- 想為不同工具建立可獨立停用的專屬金鑰。

不需要具備程式開發經驗，只要能使用 Docker、複製指令並打開瀏覽器即可。

## 安裝前準備

你需要：

- 一台可執行 Docker 的電腦、NAS 或小主機。
- Docker Desktop 或 Docker Engine。
- 至少一把 Ollama Cloud API Key。

確認 Docker 是否可用：

```bash
docker --version
```

## 五分鐘快速安裝

### 1. 下載專案

```bash
git clone https://github.com/WildenChen/ollama-cloud-proxy.git
cd ollama-cloud-proxy
```

已經有專案資料夾時，只需進入該資料夾。

### 2. 安全初始化設定

```bash
sh scripts/init-env.sh
```

這個指令會：

- 從 `.env.example` 建立 `.env`。
- 自動產生安全的 `KEY_ENCRYPTION_SECRET`。
- 再次執行時保留既有設定，不會重設密鑰。

一般使用者不需要手動設定 `CLIENT_API_KEYS`，稍後可直接從管理頁建立 Proxy 專屬金鑰。

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
{"status":"ok","version":"1.6.3"}
```

### 5. 開啟管理頁

```text
http://localhost:11435/admin
```

## 第一次設定

管理頁會依目前狀態提示下一步。建議依序完成：

1. 建立管理密碼。
2. 新增第一把 Ollama Cloud 上游 API Key。
3. 等待管理台自動驗證上游金鑰。
4. 建立 Proxy 專屬金鑰，例如 `openclaw`、`kilo` 或 `vscode`。
5. 立即複製並保存完整 Proxy 專屬金鑰。
6. 把 Base URL 與 Proxy 專屬金鑰填入外部工具。
7. 測試連線。
8. 確認所有工具完成切換後，再啟用存取保護。

完整 Proxy 專屬金鑰只會在建立或進階更換時顯示一次。關閉視窗後，管理台只保留安全前綴，無法重新顯示完整 token。

### Usage Cookie 是選填

沒有 Usage Cookie 時，模型代理仍可正常運作；只是管理台無法顯示 Ollama Cloud 官方 5hr 與每週剩餘用量。

## 外部工具怎麼設定

大多數工具只需要 Base URL 和 Proxy 專屬金鑰。

| 工具類型 | Base URL | API Key |
| --- | --- | --- |
| OpenAI-compatible | `http://你的主機:11435/v1` | 管理頁建立的 Proxy 專屬金鑰 |
| Ollama native | `http://你的主機:11435` | 管理頁建立的 Proxy 專屬金鑰 |

同一台電腦測試可先使用：

```text
http://localhost:11435/v1
```

工具在其他裝置時，請把 `localhost` 改成 Docker 主機的 LAN IP 或網域。

更多設定範例請看 [工具接入指南](./docs/tool-integrations.md)。

## 金鑰管理方式

### Ollama Cloud 上游金鑰

上游金鑰由 Proxy 用來呼叫 Ollama Cloud。管理頁可：

- 新增、測試、停用及刪除金鑰。
- 設定名稱、備註與 Usage Cookie。
- 查看可用、冷卻、失效與額度受限狀態。
- 設定 5hr 與每週最低剩餘百分比。
- 手動刷新官方用量。

### Proxy 專屬金鑰

Proxy 專屬金鑰提供給外部工具使用。管理頁可：

- 為不同工具建立獨立金鑰。
- 查看來源、狀態、前綴與最近使用時間。
- 停用、重新啟用或刪除資料庫型金鑰。
- 建立替代金鑰，讓新舊金鑰並存後再逐步切換。
- 分別測試金鑰驗證、上游可用性與模型狀態。

`.env` 中既有的 `CLIENT_API_KEYS` 仍可使用，但在管理頁只會顯示為「環境變數管理｜唯讀」，不會顯示完整 token，也不會自動遷移。

## 存取保護與升級相容性

若既有部署原本沒有任何 Proxy 專屬金鑰，升級後仍會維持匿名模式，不會突然中斷已連線工具。

建立第一把 Proxy 專屬金鑰後，也不會立即強制驗證。建議流程：

1. 建立新金鑰。
2. 複製並測試。
3. 更新所有外部工具。
4. 確認新金鑰已有成功使用紀錄。
5. 在管理頁明確啟用存取保護。
6. 確認服務正常後，再停用舊金鑰。

## 金鑰選取模式

在管理頁「設定」可選擇：

- `ordered`：固定從第一把可用金鑰開始；額度受限後才切換下一把。
- `balanced`：依可用狀態與近期負載分散到多把金鑰。

設定保存在資料庫中，不需要重啟服務。

## 更新方式

使用 release compose 時：

```bash
git pull
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

確認版本：

```bash
curl http://localhost:11435/health
```

目前應顯示版本 `1.6.3`。資料保存在本機 `data/`，更新容器不會刪除既有設定。

## 備份與還原

更新前至少備份：

- `.env`
- `data/`

`KEY_ENCRYPTION_SECRET` 必須妥善保存。若遺失，資料庫內加密保存的上游金鑰、Cookie 與 Proxy 專屬金鑰將無法解密。

管理頁也提供 YAML 匯出與匯入。匯出檔含有敏感憑證，請將它視為密碼檔保存。

## 常見問題

### 啟動時出現 KEY_ENCRYPTION_SECRET 錯誤

重新執行：

```bash
sh scripts/init-env.sh
```

不要把 README 或 `.env.example` 中的範例文字直接當成正式密鑰。

### 打不開管理頁

先確認容器：

```bash
docker ps
```

再確認健康狀態：

```bash
curl http://localhost:11435/health
```

查看服務紀錄：

```bash
docker compose -f docker-compose.release.yml logs --tail=100
```

### 管理頁要求重新登入

管理密碼不會因容器更新而消失。若登入 Cookie 過期或更換瀏覽器，直接使用原本的管理密碼登入即可。

### 金鑰建立後找不到完整 token

這是正常的安全設計。完整 token 只顯示一次；請建立替代金鑰、更新工具後，再停用舊金鑰。

### 沒有官方用量資料

確認該上游金鑰是否設定有效的 Usage Cookie。Cookie 只影響官方用量，不影響模型請求。

### 工具回傳 401

確認：

- 工具填的是 Proxy 專屬金鑰，而不是 Ollama Cloud 上游金鑰。
- Base URL 是否正確。
- 該 Proxy 專屬金鑰是否啟用。
- 是否已啟用存取保護。

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

本機開發：

```bash
bun install
bun run dev
```

執行測試：

```bash
bun test
```

建立 Docker image：

```bash
docker build -t ollama-cloud-proxy:local .
```

## 授權

MIT
