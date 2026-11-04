# 院內主機部署說明（給資訊室）

社區智慧健康站「分層管理與閉環追蹤後台」的多人共用版。社區護理師各自登入，資料集中存放在院內主機。

## 架構

```
護理師瀏覽器 ──HTTPS──> IIS／nginx（院內憑證，反向代理）──HTTP──> Node.js 服務（只聽 127.0.0.1:8080）
                                                                       │
                                                                       ├─ data/db.enc      資料（AES-256-GCM 加密）
                                                                       ├─ data/data.key    資料金鑰（請另行備份、分開保管）
                                                                       ├─ data/audit.log   稽核紀錄（只增不改，雜湊鏈）
                                                                       └─ data/backup/     每日加密備份（預設保留 30 天）
```

- **零第三方套件**：只用 Node.js 內建模組，不需要 `npm install`，沒有套件供應鏈風險。
- **規則在伺服器端執行**：紅橙黃綠分層、四步驟流程、健康處方都由伺服器判定；操作者身分取自登入帳號，無法冒名。
- **前端與單機版共用**：同一份 `health-tracking/` 網頁。偵測到伺服器時自動切換為登入模式。

## 需求

| 項目 | 規格 |
|---|---|
| 作業系統 | Windows Server 2019 以上，或任一 Linux |
| 執行環境 | Node.js 22 LTS 以上（https://nodejs.org） |
| 記憶體 | 約 100–200 MB |
| 磁碟 | 數百 MB（含 30 天備份） |
| 網路 | 只開放院內網段；院外使用須經院內 VPN |

## 安裝

1. 把 repo 中的 `health-tracking/` 與 `server/` 兩個資料夾，**以相同的相對位置**複製到主機，例如 `D:\chc\health-tracking`、`D:\chc\server`。
2. 建立專用的低權限服務帳號執行（不要用系統管理員）。資料夾權限只給該帳號讀寫 `server/data`。
3. 初始化：

   ```bash
   node server/server.js init
   ```

   會產生：
   - `server/data/data.key`：資料金鑰。**請立即另行備份到離線、與資料分開的位置**（例如密封交由資訊主管保管）。遺失即無法開啟資料。
   - 管理者帳號 `admin` 與一組臨時密碼（只顯示一次）。首次登入須變更密碼。

4. 啟動：

   ```bash
   node server/server.js
   ```

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `CHC_PORT` | `8080` | 服務埠 |
| `CHC_HOST` | `127.0.0.1` | 綁定位址。放在反向代理後面請維持 127.0.0.1 |
| `CHC_DATA_DIR` | `server/data` | 資料夾 |
| `CHC_KEY_FILE` | `<資料夾>/data.key` | 資料金鑰位置，建議放在與資料不同的磁碟或權限更嚴格的位置 |
| `CHC_TRUST_PROXY` | `false` | 在反向代理後面請設 `true`，稽核紀錄才會記到真實來源 IP |
| `CHC_SECURE_COOKIE` | `true` | 只有在純 HTTP 測試環境才設 `false`；正式環境一律 HTTPS |
| `CHC_TLS_CERT`、`CHC_TLS_KEY` | 無 | 不經反向代理、由 Node 直接提供 HTTPS 時使用（TLS 1.2 以上） |
| `CHC_IDLE_MIN` | `15` | 閒置自動登出（分鐘） |
| `CHC_SESSION_HOURS` | `8` | 單次登入最長時間（小時） |
| `CHC_BACKUP_DAYS` | `30` | 每日加密備份保留天數 |

## 常駐執行

**Linux（systemd）**：`/etc/systemd/system/chc.service`

```ini
[Unit]
Description=CHC community health tracking
After=network.target

[Service]
User=chc
WorkingDirectory=/opt/chc
ExecStart=/usr/bin/node /opt/chc/server/server.js
Environment=CHC_TRUST_PROXY=true
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/chc/server/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**Windows**：可用 NSSM（https://nssm.cc）或工作排程器，以專用服務帳號執行 `node D:\chc\server\server.js`，並設定 `CHC_TRUST_PROXY=true`。

## HTTPS 反向代理

**nginx**

```nginx
server {
  listen 443 ssl;
  server_name chc.hospital.local;
  ssl_certificate     /etc/ssl/hospital/chc.crt;
  ssl_certificate_key /etc/ssl/hospital/chc.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

**IIS**：安裝 Application Request Routing 與 URL Rewrite，建立反向代理規則指向 `http://127.0.0.1:8080`；繫結院內憑證；要求大小上限設為 25 MB（名冊匯入）。

若要放在子路徑（例如 `https://intranet/chc/`），代理時請去掉 `/chc` 前綴；前端使用相對路徑呼叫 API，不需修改程式。

## 帳號管理

- 管理者登入後，在「分層規則與設定 → 帳號與資訊安全」新增社區護理師帳號，指定可見據點。系統產生臨時密碼（只顯示一次），首次登入須自行變更。
- 停用帳號會立即登出該帳號所有裝置。
- 忘記密碼：管理者在畫面上「重設密碼」，或在主機執行 `node server/server.js reset-password <帳號>`。
- 規則：密碼至少 12 字元、scrypt 雜湊；同一帳號或來源 IP 連續 5 次失敗即暫停登入（15 分鐘起，逐次加倍，最長 60 分鐘）。

## 備份與還原

- 伺服器每天自動在 `data/backup/` 留一份加密備份，保留 30 天。
- 請納入院內既有的備份機制（整個 `data/` 資料夾），並**把 `data.key` 分開備份**。
- 還原：停止服務 → 以備份檔取代 `data/db.enc` → 啟動服務。

## 稽核

- `data/audit.log` 每行一筆 JSON：時間、帳號、來源 IP、動作、對象（民眾內部編號，不含姓名）、內容；以 SHA-256 雜湊鏈串接。
- 檢查完整性：`node server/server.js verify-audit`（被修改或刪除會指出第幾筆）。
- 可以將此檔匯入院內 SIEM／日誌系統。
- 會記錄：登入、登入失敗、登出、變更密碼、帳號異動、匯入名冊與量測、每一個追蹤步驟、新增量測、風險註記、調閱完整身分證號、匯出、設定變更、重新判定。

## 已做到的資安控制（皆有自動化測試）

| 控制 | 做法 | 測試 |
|---|---|---|
| 身分驗證 | 帳號密碼（scrypt）、首次登入強制改密碼、登入失敗鎖定、不透露帳號是否存在 | `server/test/server.test.js` |
| 工作階段 | 256 位元隨機 ID、HttpOnly、SameSite=Strict、Secure；閒置 15 分鐘與 8 小時強制登出 | 同上 |
| 授權 | 依據點分權（查不到他站民眾）、管理功能限管理者 | 同上 |
| 個資最小化 | 身分證號與電話預設遮蔽；調閱完整號碼須另外呼叫並留紀錄 | 同上 |
| CSRF | 每個工作階段的權杖 ＋ 來源檢查 ＋ SameSite | 同上 |
| 資料加密 | 資料檔與每日備份以 AES-256-GCM 加密；金鑰檔權限僅限擁有者 | 同上 |
| 稽核 | 只增不改、雜湊鏈、可驗證 | 同上 |
| 網頁安全 | CSP（禁止內嵌腳本與外部資源、禁止被嵌入框架）、X-Frame-Options、nosniff、HSTS、Referrer-Policy、Permissions-Policy | 同上，及 `health-tracking/tests/security.browser.js` |
| 輸入驗證 | 只收 JSON、大小上限、欄位白名單、量測合理範圍、路徑白名單（無路徑穿越） | 同上 |
| 檔案解析 | 自製 xlsx 讀取器，防壓縮炸彈、原型污染、XXE；不依賴第三方程式庫 | `security.browser.js` |

## 尚未包含、建議後續評估

- **院內 AD／SSO 單一登入與多因子驗證**：目前為獨立帳號密碼。可在反向代理層做 Windows 整合驗證或 SSO，再由服務信任代理傳入的身分；此功能需與資訊室共同設計，未內建。
- **資料庫**：目前以單一加密檔案存放，適合數千位民眾、每年數萬筆量測的規模。每次寫入都會重新加密整份資料，規模再擴大時，建議改用院內資料庫（例如 SQL Server、PostgreSQL）。
- **金鑰輪替**與**硬體安全模組（HSM）**保管金鑰。
- **重啟服務會登出所有使用者**：工作階段存在記憶體中，不寫入磁碟，這是刻意的設計。
- 上線前建議由第三方進行**弱點掃描與滲透測試**，並依院內 ISMS（ISO 27001）程序完成風險評鑑。

## 測試

```bash
node server/test/server.test.js            # 伺服器資安與功能（24 項）
node health-tracking/tests/engine.test.js  # 分層規則與流程
node health-tracking/tests/vault.test.js   # 加密
```
