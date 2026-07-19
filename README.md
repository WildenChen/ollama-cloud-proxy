# Ollama Cloud Proxy

Ollama Cloud Proxy 是一個「放在你的工具和 Ollama Cloud 中間」的小服務。

它幫你做三件事：

- 把多把 Ollama Cloud API key 集中管理。
- 讓 OpenClaw、Kilo Code、VS Code、自製工具共用同一個入口。
- 在管理頁面看每把 key 的狀態、用量、錯誤紀錄，並建立不同服務使用的 client token。

目前版本：`1.4.0`

如果你只是想把服務裝起來，照下面步驟做就好。進階設定、API、開發文件都拆到 [docs](./docs/)。

## 適合誰

你可能需要這個服務，如果你有以下狀況：

- 你有一把或多把 Ollama Cloud API key。
- 你想讓多個工具共用同一組 Ollama Cloud key。
- 你不想把真正的 Ollama Cloud API key 填進每個工具。
- 你想知道哪個工具在連線、哪把 key 壞了、哪把 key 額度快用完。

你不需要懂程式碼。只要會複製指令、編輯一個 `.env` 檔案、打開瀏覽器即可。

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

### 2. 建立設定檔

```bash
cp .env.example .env
```

### 3. 編輯 `.env`

用你熟悉的文字編輯器打開 `.env`。

最少一定要改這一行：

```env
KEY_ENCRYPTION_SECRET=請換成很長很難猜的文字
```

例如可以改成一串長密碼。這個值很重要，請保存好；它用來加密資料庫裡的 API key。

其他設定可以先不動。

### 4. 啟動服務

```bash
docker compose -f docker-compose.release.yml up -d
```

### 5. 確認服務有起來

```bash
curl http://localhost:11435/health
```

如果看到類似下面內容，就代表服務活著：

```json
{"status":"ok","version":"1.4.0"}
```

### 6. 打開管理頁面

在瀏覽器打開：

```text
http://localhost:11435/admin
```

第一次使用時：

1. 畫面會明確顯示首次設定狀態。
2. 立即建立日後登入使用的管理密碼。
3. 新增第一把 Ollama Cloud API key。
4. 建立一個 client API key，給 OpenClaw、Kilo Code 或其他工具使用。

## 第一次進管理頁要做什麼

打開 `/admin` 後，建議照這個順序：

1. 設定或變更管理密碼。
2. 新增 Ollama Cloud API key。
3. 如果你想看官方用量，替 key 填入 Ollama Cloud usage cookie。
4. 建立 client API key，例如 `openclaw`、`kilo`、`vscode`。
5. 把 client API key 填到你的工具裡。

## 金鑰選取模式

預設是 `ordered`：固定從第一把可用金鑰開始使用；當該金鑰的 5hr 或每週額度受限時，請求會改用下一把可用金鑰。也可以在管理頁面的「設定」切換成 `balanced`，讓請求依可用狀態與近期負載分散到多把金鑰。設定會保存在資料庫，不需要重新啟動服務。

請注意：

- Ollama Cloud API key 是 proxy 連上游用的。
- client API key 是你的工具連 proxy 用的。
- 工具不要直接拿 Ollama Cloud API key，這樣比較好管理，也比較安全。

## 工具要怎麼填

大多數工具只需要兩個值：

| 工具類型 | Base URL | API Key |
| --- | --- | --- |
| OpenAI-compatible 工具 | `http://你的主機:11435/v1` | 管理頁建立的 client API key |
| Ollama native 工具 | `http://你的主機:11435` | 管理頁建立的 client API key |

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

資料會保存在本機 `data/`，更新 container 不會清掉它。

## 備份方式

最重要的是這兩個：

- `.env`
- `data/`

其中 `KEY_ENCRYPTION_SECRET` 一定要保存好。沒有它，資料庫裡加密保存的 key 會無法解密。

你也可以在管理頁使用 YAML 匯出功能，把 key、cookie、client token 和用量設定匯成單一 YAML 檔案。

提醒：YAML 匯出檔包含明文密鑰，請把它當成密碼檔保存。

## 常見問題

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
- 工具連 `/v1` 或 `/api/chat` 要用 client API key。
- 不要把 Ollama Cloud API key 直接填到工具裡。

### 顯示 no_available_key

代表目前沒有可用的 Ollama Cloud key。可能原因：

- 還沒新增 key。
- key 無效。
- key 被手動停用。
- key 正在冷卻。
- session 或 weekly 額度用完。

請到管理頁看 key 狀態。

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
- [開發與測試](./docs/development.md)
- [版本更新紀錄](./docs/changelog.md)

## 安全提醒

- 不要把 `.env`、`data/`、API key、client token 貼到公開地方。
- 不建議直接把 `/admin` 暴露到 Internet。
- 外網使用請放在 HTTPS、VPN、Tailscale、Cloudflare Access 或反向代理保護後面。
- 匯出的 YAML 包含明文 secret，請妥善保存。

## License

MIT License. See [LICENSE](./LICENSE).
