# 版本更新紀錄

## 1.4.0 - 2026-07-19

- 新增公開唯讀 `/api/usage` 與 `/api/usage/accounts`，提供啟用帳號的 5hr/weekly 標準化總額、匿名 per-account snapshot、來源與 reset buckets。
- 新增持久化本地 usage ledger、官方 snapshot 的 fetched/checked/changed 時間，以及 Cookie 暫時失效時的估算 fallback。
- 新增 per-key 5hr/weekly quota limit、5 分鐘流量 debounce、15 分鐘 stale-on-use、single-flight，以及 429/Cookie 變更的定向非同步刷新。
- `USAGE_API_ENABLED=false` 可停用公開 API 與自動 hooks，不影響模型轉發、Admin 用量卡或手動刷新。

## 1.3.8 - 2026-07-16

- 管理登入改用 30 天、持續使用會續期的 HttpOnly Session Cookie，不再於 localStorage 保存明文管理密碼。
- 總覽與用量彙總改為免登入唯讀；設定、金鑰操作、事件明細與模型測試仍需管理登入。
- 變更管理密碼會使舊 Cookie 自動失效，登出會立即清除目前瀏覽器 Cookie。

## 1.3.7 - 2026-07-15

- 建立 Client API 金鑰時只需填寫名稱，token 改由後端以密碼學安全亂數自動產生。
- 更換 Client API 金鑰也改為自動產生新 token，不再要求管理者手動輸入。

## 1.3.6 - 2026-07-15

- Client API 金鑰新增受管理密碼保護的完整值複製操作，完整 token 不會常駐前端狀態。
- 將語意模糊的「輪替」改為「更換金鑰」，並明確提示儲存後舊 token 會立即失效。
- Client API 金鑰列改成緊湊的資訊與操作版型，避免操作按鈕被撐成整列寬度。

## 1.3.5 - 2026-07-15

- 完全移除 `ADMIN_TOKEN` 與管理權杖 fallback，管理頁及所有管理 API 僅接受管理密碼。
- 首次設定改為直接建立管理密碼，不再顯示或要求首次設定權杖。
- 尚未建立密碼時明確提醒應立即完成設定，避免管理入口維持未初始化狀態。

## 1.3.4 - 2026-07-15

- 管理頁拆分獨立的「用量」與「設定」頁籤，降低用量檢視與系統設定混雜。
- 金鑰選取模式可在設定頁切換並保存至資料庫；預設依序使用，5hr 或每週額度受限後再換下一把。
- 首次設定、管理密碼登入與憑證失效改為明確的入口提示，避免沒有快取憑證時停在不明狀態。
- `ADMIN_TOKEN` 明確限定為首次建立管理密碼的 bootstrap 權杖；設定完成後日常登入只接受管理密碼。
- 整理管理密碼介面為單一登入、單一改密碼流程，補上確認密碼與登出操作。

## 1.3.3 - 2026-07-13

- 新增 `KEY_SELECTION_MODE=ordered|balanced`；預設 `ordered` 會依建立順序固定使用第一把可用金鑰，5hr 或 weekly 額度受限後才切到下一把，`balanced` 可保留舊版分數排序與前三名隨機分散行為。

## 1.3.2 - 2026-07-05

- Admin 首頁 key 卡片將籠統的「冷卻中」改為「請求冷卻中」，避免和官方 5hr / weekly 額度狀態混淆。
- 用量卡片新增 cooldown 原因與冷卻到期時間，讓 5hr 顯示 100% 時也能看懂 key 只是因上游限流、暫時錯誤或網路錯誤短暫暫停。

## 1.3.1 - 2026-07-04

- Docker build 改用 `bun.lockb` 鎖定依賴版本，避免 `bun install` 在不同時間點拉入不同 transitive 套件，確保 image 可重現。

## 1.3.0 - 2026-07-04

- Admin 新增首次設定管理密碼與 Web 變更管理密碼，密碼以 PBKDF2-SHA256 hash 存於 SQLite；既有 `ADMIN_TOKEN` 保留為 bootstrap/fallback。
- 新增 Client API key 管理，可在 Web 建立、輪替、啟停與刪除命名 token，方便依服務追蹤連線紀錄。
- 新增單一 YAML 匯入/匯出，支援 Ollama upstream key、用量 Cookie、client token 與用量重置設定的合併覆蓋遷移。
- 事件紀錄新增分類篩選與單次非串流 token 用量細節，包含輸入、輸出、總 token 與 cache token。

## 1.2.5 - 2026-07-03

- 首頁管理權杖移到用量頁的管理存取區，首頁保留用量視覺本體。
- 桌面版官方用量卡片改為更緊湊的多欄版型，接近 OmniRoute 的卡片密度。
- 總額度池改為計入所有已啟用金鑰，只有手動停用的金鑰排除在總計之外；後續修正 weekly/session 受限金鑰被誤算進 5hr 可用剩餘的問題。
- 官方用量條新增橘黃狀態，標示已使用但仍可用的額度。
- 精簡首頁用量操作區、調整用量警示門檻與首頁操作按鈕、調整首頁用量版型。

## 1.2.4 - 2026-07-03

- 手動「重置冷卻」現在可清除已儲存的 invalid 狀態並讓金鑰回到可選池。
- 模型/金鑰測試維持真實上游驗證，只有 `/v1/models` 測試成功才會自動恢復金鑰狀態。

## 1.2.3 - 2026-07-03

- 手機版首頁用量卡片調整為更細緻的字級、間距、燈號與按鈕高度。
- 官方用量 footer 拆分「用量已同步 / 用量讀取失敗」與 key runtime 狀態。

## 1.2.2 - 2026-07-03

- 總額度池改成只合計目前可用金鑰。
- weekly 額度已用完或整把 key 目前不可用時，單卡 5hr / weekly 用量條改成灰階並標示「目前不可用」。

## 1.2.1 - 2026-07-03

- Admin 首頁新增「總額度池」合體卡片。
- 模型測試頁新增模型啟用開關。
- 未帶 token 的公開 `/v1/models` 會使用已保存的模型清單列出可用模型。

## 1.1.10 - 2026-07-03

- Admin 首頁第一屏整合 OmniRoute 風格的每 Key Ollama Cloud 用量卡片。
- 新增 per-key 剩餘量截止值設定。
- 新增單 Key 官方用量刷新，以及 Key 設定視窗。

## 1.1.9 - 2026-07-03

- Admin 用量頁第一屏改成 Ollama Cloud 帳號卡片網格。
- 修正官方用量百分比顯示。

## 1.1.8 - 2026-06-07

- Admin UI 用量頁新增全部帳號用量總覽。
- 新增 `GET /admin/usage-overview`。

## 1.1.7 - 2026-06-07

- 新增全域 5hr session reset anchor。
- Admin UI 用量頁新增可調整的 5hr session reset 與 weekly reset 設定。

## 1.1.6 - 2026-06-04

- 新增 smart key retry 設定。
- quota/key-level 錯誤會繼續嘗試下一把 selectable key。
- GitHub Actions Docker publish 會先執行測試。

## 1.1.5 - 2026-06-03

- Retry 上限改成當下可用 key 數量。
- 同一請求不會重複使用同一把 key。

## 1.1.4 - 2026-06-03

- 修正 `/api/tags` 相容性。
- `/api/version` 新增 `proxy_version`。

## 1.1.3 - 2026-06-03

- 新增 Ollama native `/api/version` endpoint。
- 新增 Ollama native `/api/generate` pass-through。

## 1.1.2 - 2026-06-03

- Admin key list 會把已過期 cooldown 的 key 顯示成 available。

## 1.1.1 - 2026-06-03

- Admin metrics 顯示 app version。
- README 補充 Docker image 更新流程。

## 1.1.0 - 2026-06-02

- 新增 GHCR prebuilt Docker image 發布流程與 release compose 用法。
- Admin UI 加入繁體中文/英文切換。

## 1.0.0 - 2026-06-02

- 首個 tagged release。
- 支援 OpenAI-compatible `/v1/*` 與 Ollama native `/api/*` 基礎相容路徑。
- 建立 Admin UI/API、key pool、SQLite persistence、client token、model alias 與併發管理基礎。
