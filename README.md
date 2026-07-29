# Ollama Cloud Proxy

Ollama Cloud Proxy 是一個「放在你的工具和 Ollama Cloud 中間」的小服務。

它幫你做三件事：

- 把多把 Ollama Cloud API key 集中管理。
- 讓 OpenClaw、Kilo Code、VS Code、自製工具共用同一個入口。
- 在管理頁面看每把 key 的狀態、用量、錯誤紀錄，並建立不同服務使用的 client token。

目前版本：`1.6.0`

如果你只是想把服務裝起來，照下面步驟做就好。進階設定、API、開發文件都拆到 [docs](./docs/)。

## 1.6.0 Proxy 專屬金鑰改善

- 首頁明確區分「Ollama Cloud 上游金鑰」與提供給工具使用的「Proxy 專屬金鑰」。
- 使用者可在首頁建立、查看、編輯、停用及安全刪除管理台型 Proxy 專屬金鑰。
- `.env` 的 `CLIENT_API_KEYS` 會繼續有效，並以「環境變數管理｜唯讀」顯示，不會被自動遷移或改寫。
- 建立與進階更換操作直接回傳一次性 token；既有完整 token 不再能透過一般 reveal endpoint 重新顯示。
- 新金鑰可分別檢查驗證、上游可用性與模型狀態；安全切換流程允許新舊金鑰並存。
- 沒有 Client API Key 的既有部署仍維持匿名模式，不會因升級中斷，只顯示非阻擋式安全建議。

## 1.5.x 管理台改善

1.5 系列聚焦在讓一般使用者更容易完成設定與排除問題：

- 首次設定指南會依目前狀態告訴你下一步，不必自行在頁籤間尋找。
- 總覽會直接顯示服務是否可用、部分可用或目前沒有可用金鑰。
- 清楚區分 Ollama Cloud API Key、選填的 Usage Cookie 與工具使用的 Client API Key。
- 新增金鑰狀態篩選、不可用原因、預計恢復時間與建立後自動驗證。
- Client API Key 完整 token 只在建立或更換時顯示一次。
- 常見錯誤會顯示影響範圍、修復步驟與直接操作，並可複製已遮蔽敏感資料的診斷資訊。
- 改善手機、小螢幕、鍵盤操作、文字對比與狀態辨識。
- 1.5.1 修正手機版 Key 卡片的方案標籤／開關重疊，並將操作按鈕改為緊湊的兩欄配置。

## 適合誰

你可能需要這個服務，如果你有以下狀況：

- 你有一把或多把 Ollama Cloud API key。
- 你想讓多個工具共用同一組 Ollama Cloud key。
- 你不想把真正的 Ollama Cloud API key 填進每個工具。
- 你想知道哪個工具在連線、哪把 key 壞了、哪把 key 額度快用完。

你不需要懂程式碼。只要會複製指令、啟動 Docker、打開瀏覽器即可。

## 你需要準備

安裝前請先確認有這些東西：

- 一台可以跑 Docker 的電腦、NAS 或小主機。
- 已安裝 Docker Desktop 或 Docker Engine。
- 至少一把 Ollama Cloud API key。
- 這個專案資料夾。

如果你不知道 Docker 是否已安裝，打開終端機輸入：

```bash
docker --version
```

有看到版本號就可以繼續。

## 最簡單安裝方式

這個方式使用已經建好的 Docker image，不需要自己編譯。

### 1. 下載或進入專案資料夾

如果你已經有這個資料夾，直接進入：

```bash
cd ollama-cloud-proxy
```

如果你還沒有，請先從 GitHub 下載或 clone：

```bash
git clone https://github.com/WildenChen/ollama-cloud-proxy.git
cd ollama-cloud-proxy
```

### 2. 安全初始化設定

```bash
sh scripts/init-env.sh
```

這個指令會：

- 從 `.env.example` 建立 `.env`。
- 自動產生安全的 `KEY_ENCRYPTION_SECRET`。
- 再次執行時保留既有設定，不會重設密鑰。

正常安裝不需要在 `.env` 預先填入 Client API key；稍後直接在管理頁建立即可。

如果系統沒有 `openssl`，也可以手動執行：

```bash
cp .env.example .env
openssl rand -hex 32
```

把輸出的字串填入 `.env`：

```env
KEY_ENCRYPTION_SECRET=剛才產生的字串
```

服務會拒絕空白、太短或已知範例密鑰，並顯示可直接採用的修正方式。

### 3. 啟動服務

```bash
docker compose -f docker-compose.release.yml up -d
```

### 4. 確認服務有起來

```bash
curl http://localhost:11435/health
```

如果看到類似下面內容，就代表服務活著：

```json
{"status":"ok","version":"1.6.0"}
```

### 5. 打開管理頁面

在瀏覽器打開：

```text
http://localhost:11435/admin
```

第一次使用時：

1. 建立日後登入使用的管理密碼。
2. 依首次設定指南新增第一把 Ollama Cloud API key。
3. 建立一個 Client API key，給 OpenClaw、Kilo Code 或其他工具使用。
4. 複製管理台顯示的 Base URL 與一次性 Client API key 到工具。

## 第一次進管理頁要做什麼

打開 `/admin` 後，管理台會依目前狀態顯示待完成步驟。基本順序是：

1. 設定或變更管理密碼。
2. 新增 Ollama Cloud API key；建立後管理台會自動驗證。
3. 如果你想看官方用量，替 key 填入 Ollama Cloud usage cookie。
4. 建立 Client API key，例如 `openclaw`、`kilo`、`vscode`。
5. 立即複製並保存完整 Client API key；關閉後只會保留前綴預覽。
6. 把 Client API key 與管理台顯示的 Base URL 填到工具裡。

Usage cookie 是選填項目；沒有設定仍可正常代理模型請求，只是不會顯示官方用量資料。

## 金鑰選取模式

預設是 `ordered`：固定從第一把可用金鑰開始使用；當該金鑰的 5hr 或每週額度受限時，請求會改用下一把可用金鑰。也可以在管理頁面的「設定」切換成 `balanced`，讓請求依可用狀態與近期負載分散到多把金鑰。設定會保存在資料庫，不需要重新啟動服務。

請注意：

- Ollama Cloud API key 是 proxy 連上游用的。
- Client API key 是你的工具連 proxy 用的。
- Usage Cookie 只用來讀取官方用量，是選填項目。
- 工具不要直接拿 Ollama Cloud API key，這樣比較好管理，也比較安全。
- `.env` 裡的 `CLIENT_API_KEYS` 只是進階部署的 fallback，一般使用者留空即可。

## 工具要怎麼填

大多數工具只需要兩個值：

| 工具類型 | Base URL | API Key |
| --- | --- | --- |
| OpenAI-compatible 工具 | `http://你的主機:11435/v1` | 管理頁建立的 Client API key |
| Ollama native 工具 | `http://你的主機:11435` | 管理頁建立的 Client API key |

如果你是在同一台電腦測試，可以先用：

```text
http://localhost:11435/v1
```

如果工具在另一台電腦，請把 `localhost` 換成跑 Docker 那台機器的 IP 或網域。

更多工具範例看 [工具接入指南](./docs/tool-integrations.md)。

## 更新方式

如果你使用 `docker-compose.release.yml`，更新很簡單：

```bash
git pull
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

確認更新成功：

```bash
curl http://localhost:11435/health
```

應看到版本 `1.6.0`。資料會保存在本機 `data/`，更新 container 不會清掉它。

## 備份方式

最重要的是這兩個：

- `.env`
- `data/`

其中 `KEY_ENCRYPTION_SECRET` 一定要保存好。沒有它，資料庫裡加密保存的 key 會無法解密。

你也可以在管理頁使用 YAML 匯出功能，把 key、cookie、client token 和用量設定匯成單一 YAML 檔案。

提醒：YAML 匯出檔包含明文密鑰，請把它當成密碼檔保存。

## 常見問題

### 啟動時顯示 KEY_ENCRYPTION_SECRET 錯誤

執行下列指令即可安全建立或補齊設定：

```bash
sh scripts/init-env.sh
```

不要使用 README 或 `.env.example` 中的說明文字作為真正密鑰。

### 打不開管理頁

先檢查 container 是否有跑：

```bash
docker ps
```

再檢查健康狀態：

```bash
curl http://localhost:11435/health
```

如果你不是在同一台電腦開瀏覽器，`localhost` 要換成 Docker 主機的 IP。

### 工具顯示 unauthorized

通常是 API key 填錯。

- 連 `/admin` 只使用管理密碼。
- 工具連 `/v1` 或 `/api/chat` 要用 Client API key。
- 不要把 Ollama Cloud API key 直接填到工具裡。
- 若剛更換 Client API key，所有使用舊 token 的工具都必須同步更新。

### 顯示 no_available_key

代表目前沒有可用的 Ollama Cloud key。可能原因：

- 還沒新增 key。
- key 無效。
- key 被手動停用。
- key 正在冷卻。
- 5hr 或 weekly 額度用完。

管理台會顯示每把金鑰的人類可讀原因與預計恢復時間，也可使用「需要注意」篩選快速定位。

### 官方用量讀取失敗

這通常是 Usage Cookie 缺失或過期。它只影響官方用量顯示，不影響模型代理；可以更新 Cookie，也可以暫時忽略。

### 更新後版本沒有變

如果你使用 release image，請確認有跑：

```bash
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

再看：

```bash
curl http://localhost:11435/api/version
```

## 文件入口

- [進階設定](./docs/advanced-configuration.md)
- [工具接入指南](./docs/tool-integrations.md)
- [Admin API 與路徑參考](./docs/api-reference.md)
- [OpenClaw 用量整合](./docs/openclaw-usage-integration.md)
- [開發與測試](./docs/development.md)
- [版本更新紀錄](./docs/changelog.md)

## 安全提醒

- 不要把 `.env`、`data/`、API key、Client API key、Cookie 貼到公開地方。
- 不要使用範例 secret 或固定 token；程式會拒絕已知不安全範例值。
- Client API key 完整 token 只在建立或更換時顯示一次，請立即保存。
- 複製診斷資訊時，管理台會遮蔽常見敏感資料；分享前仍應快速確認內容。
- 不建議直接把 `/admin` 暴露到 Internet。
- 外網使用請放在 HTTPS、VPN、Tailscale、Cloudflare Access 或反向代理保護後面。
- 匯出的 YAML 包含明文 secret，請妥善保存。

## License

MIT License. See [LICENSE](./LICENSE).
