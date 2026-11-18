# 個人知識庫（Personal Knowledge Base, PKB）

> 目標：讓知識「屬於你、不屬於任何 AI 平台」。
> 原則：**純文字 Markdown + 資料夾 + Git**。任何 AI（Claude、ChatGPT、Gemini、本地模型）、任何編輯器、20 年後的任何工具都讀得懂。

本資料夾 `pkb/` 是一個可直接使用的 Obsidian Vault 範本。三階段對應如下：

| 階段 | 產出 | 位置 |
|---|---|---|
| 1. 建庫 | 資料夾分類、模板、frontmatter 規範、Git 備份、PHI 防護 | 各編號資料夾、`90-Templates/`、`.gitignore`、`.githooks/` |
| 2. AI 可讀 | Vault 層級 AI 規則、三種固定助理、檢索評測 | `CLAUDE.md`、`AGENTS.md`、`_ai/roles/`、`.claude/commands/`、`_ai/eval/` |
| 3. 自動化 | 錄音轉文字、手寫 OCR、自動分類、會議紀錄＋待辦 | `scripts/` |

---

## 第一階段：建立個人知識庫

### 1.1 安裝與開啟
1. 安裝 [Obsidian](https://obsidian.md)（免費）。
2. 把整個 `pkb/` 資料夾複製到電腦，建議路徑：`~/Documents/PKB`（**不要**放在 iCloud/OneDrive 同步資料夾內，再用 Git 同步，兩者會互相衝突）。
3. Obsidian →「Open folder as vault」→ 選 `PKB`。
4. 設定 → Core plugins → 開啟 **Templates**、**Daily notes**；本範本已在 `.obsidian/` 預設：新筆記進 `00-Inbox/`、附件進 `99-Attachments/`、模板資料夾 `90-Templates/`。
5. 建議社群外掛（Settings → Community plugins）：
   - **Dataview**：用 frontmatter 做查詢表（例如「所有進行中的計畫」）。
   - **Tasks**：彙整全庫待辦（會議腳本產生的 `- [ ]` 即此格式）。
   - **Obsidian Git**：自動 commit/push（桌機用）。

### 1.2 分類架構（數字前綴 = 固定排序）

```
00-Inbox/        未整理的新東西（腳本輸出也先落這裡）
10-Research/     研究：一個研究一個子資料夾（protocol、分析、論文草稿）
20-Grants/       計畫書：國科會、院內計畫、IRB 文件
30-Literature/   文獻筆記：一篇論文一則筆記
40-Clinical/     臨床知識、教學（僅限去識別化內容）
50-Meetings/     會議紀錄
60-Admin/        行政：公文、委員會、申請流程
70-Journal/      工作日誌、經驗與反思
80-Resources/    SOP、統計方法、常用程式碼、參考資料
90-Templates/    模板（不放內容）
99-Attachments/  原始檔：audio/ scans/ pdf/
_ai/             AI 角色指令、評測集（給人也給 AI 看）
scripts/         自動化腳本
```

**分類規則（只記三條）**
1. 「這是為了哪個產出？」→ 有明確產出放 10/20；純知識放 30/40/80。
2. 不確定就丟 `00-Inbox/`，每週清一次（或用 `scripts/classify.py`）。
3. 一則筆記只放一處；跨主題用 `[[雙向連結]]` 和 `tags`，不要複製。

### 1.3 Frontmatter 規範（讓 AI 與 Dataview 能精準篩選）

```yaml
---
title: 統一的人類可讀標題
type: research | grant | literature | clinical | meeting | admin | journal | resource
status: idea | active | submitted | done | archived
created: 2026-11-18
tags: [sepsis, RCT]
source: 原始檔路徑或 DOI（可引用的依據）
---
```

`source:` 是第二階段「AI 引用原始文件」的關鍵：AI 回答時必須能指回這個欄位或檔案路徑。

### 1.4 匯入過去資料（建議順序）

| 來源 | 轉換方法 |
|---|---|
| Word `.docx` | `pandoc 檔名.docx -t gfm -o 檔名.md --extract-media=99-Attachments/pdf` |
| PDF 論文/計畫書 | 原檔放 `99-Attachments/pdf/`，另建一則 `30-Literature` 筆記摘要並 `source:` 指回原檔 |
| Evernote / Notion | Obsidian 官方 **Importer** 外掛 |
| 舊 AI 對話 | 匯出（ChatGPT/Claude 皆有 Export data）→ 只挑「結論、決策、可重用 prompt」貼進 `70-Journal/` 或 `80-Resources/`，不要整包倒入 |

**實務建議**：先匯入「最近 2 年、仍會再用到」的 20–50 份文件，不要一次搬完。知識庫的價值來自持續使用，而不是一次性的完整度。

### 1.5 GitHub Private Repository 備份

```bash
cd ~/Documents/PKB
git init -b main
git config core.hooksPath .githooks   # 啟用 PHI 掃描（見 1.6）
git add . && git commit -m "Initial vault"
```

在 GitHub 建立 **Private** repository（例如 `pkb`，不要勾選 README），然後：

```bash
git remote add origin git@github.com:<你的帳號>/pkb.git
git push -u origin main
```

`.gitignore` 已排除：錄音檔、大型掃描、Obsidian 個人工作區狀態、`.env` 金鑰、`**/PHI/` 資料夾。

### 1.6 ⚠️ 醫療資料防護（務必閱讀）

- GitHub Private repo ≠ 符合個資法/HIPAA 的儲存空間。**可識別病人資料（姓名、身分證、病歷號、生日＋就診日組合）不得進入此 vault。**
- `.githooks/pre-commit` 會在 commit 前執行 `scripts/phi_scan.py`，偵測台灣身分證字號、病歷號樣式、手機號碼、姓名欄位等，命中即阻擋。它是**安全網，不是保證**：規則式偵測必有偽陰性。
- 研究原始資料（含 PHI 的 CSV、REDCap 匯出）留在院內儲存設備，vault 只放「分析程式碼、去識別化摘要、結果」。
- 送到雲端 AI（第二、三階段）的內容同樣適用此原則。

---

## 第二階段：讓 AI 能讀取資料

### 2.1 Claude 存取指定資料（由簡到深三種方式）

| 方式 | 適用 | 作法 |
|---|---|---|
| **A. Claude Code（推薦）** | 全庫搜尋、引用、整理、執行腳本 | 在 vault 目錄執行 `claude`。它會自動讀 `CLAUDE.md`（規則），並能用 grep/讀檔直接搜尋全部 Markdown，回答時附檔案路徑。 |
| B. Claude Desktop + Filesystem MCP | 想在桌面 App 對話中用 | 見下方設定，只授權 vault 路徑 |
| C. Claude.ai Projects | 小範圍、固定文件集 | 上傳特定資料夾內容到 Project knowledge；適合「某計畫書專案」，不適合全庫 |

**B 的設定**（`claude_desktop_config.json`）：
```json
{
  "mcpServers": {
    "pkb": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/<你>/Documents/PKB"]
    }
  }
}
```

**跨 AI**：`CLAUDE.md` 是規則本體；`AGENTS.md`（Codex、Cursor 等讀取）只指向它。換 AI 時不需要搬資料，只需要讓新工具讀這兩個檔。

### 2.2 固定 AI 指令（三種助理 + 會議秘書）

角色定義寫在 `_ai/roles/`（純文字，任何 AI 都能貼上使用）；在 Claude Code 中則有對應的斜線指令：

| 指令 | 角色 | 典型用法 |
|---|---|---|
| `/research` | 研究助理 | `/research 我們過去做過哪些關於 sepsis 早期預警的分析？有哪些限制沒解決？` |
| `/admin` | 行政助理 | `/admin 依 60-Admin 過去格式，草擬一份委員會簽呈` |
| `/literature` | 文獻整理助理 | `/literature 整理 30-Literature 中所有 SGLT2 相關文獻成比較表` |
| `/meeting` | 會議秘書 | `/meeting 00-Inbox/2026-11-18-transcript.md` |

在 ChatGPT / Gemini 等平台：把 `_ai/roles/<角色>.md` 內容貼到「自訂指令」或 Gem/GPT 的系統說明即可。

### 2.3 測試：AI 能否搜尋歷史資料並引用原始文件

不要憑感覺判斷「好不好用」。`_ai/eval/` 提供一個小型評測流程：

1. 在 `_ai/eval/questions.csv` 寫 20–30 題**你知道答案和出處**的問題（例：「2024 年院內計畫的主要結果指標是什麼？」→ 標準出處 `20-Grants/...md`）。
2. 讓 AI 逐題回答，記錄：是否找到正確檔案、引用是否真實存在、內容是否正確。
3. `python scripts/eval_score.py _ai/eval/questions.csv` 計算 **檢索命中率、引用正確率、幻覺率**，並附 Wilson 95% 信賴區間。

> 統計提醒：n=20 時，觀察到 90% 命中率的 95% CI 約為 70–97%。題數太少時，「A 工具比 B 好」的結論通常不成立；改版前後比較請用同一題組（配對設計，McNemar 檢定）。

詳見 `_ai/eval/README.md`。

---

## 第三階段：自動化 AI Agent

所有腳本預設 **dry-run 或只輸出到 `00-Inbox/`**，不會覆蓋既有筆記。

```bash
cd ~/Documents/PKB
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
export ANTHROPIC_API_KEY=...        # 或使用 `ant auth login`；切勿寫進 vault
```

| 功能 | 指令 | 資料去向 |
|---|---|---|
| 錄音 → 逐字稿 | `python scripts/transcribe.py 99-Attachments/audio/xxx.m4a` | **本機**運算（faster-whisper），音檔不出電腦 |
| 手寫筆記 OCR | `python scripts/ocr.py 99-Attachments/scans/xxx.jpg` | 影像送 Claude API |
| Inbox 自動分類 | `python scripts/classify.py`（預覽）→ `--apply`（執行搬移） | 筆記前 4,000 字送 Claude API |
| 會議紀錄＋待辦 | `python scripts/meeting.py 00-Inbox/xxx-transcript.md` | 逐字稿送 Claude API |
| 一鍵處理全部 | `python scripts/pipeline.py` | 依序執行以上（音檔→逐字稿→會議紀錄；掃描→OCR；最後分類預覽） |

**排程**（macOS 每晚 22:30 自動處理）：`crontab -e` 加入
```
30 22 * * * cd ~/Documents/PKB && .venv/bin/python scripts/pipeline.py >> 00-Inbox/_pipeline.log 2>&1
```

### 3.1 錄音來源建議
- 手機：iPhone「語音備忘錄」或 Android 錄音機 → 存到 `99-Attachments/audio/`（經由 Obsidian Sync 或 AirDrop）。
- 醫療會議錄音若可能含病人資訊，請確認單位規範；本流程轉錄在本機完成，但後續 `meeting.py` 會將逐字稿送雲端——請先檢視或改用本地模型。

### 3.2 手寫筆記
- iPad（GoodNotes / Notability）→ 匯出 PDF 或 JPG 到 `99-Attachments/scans/`。
- 紙本 → 手機掃描（iOS 備忘錄「掃描文件」、Microsoft Lens）。
- `ocr.py` 用 Claude 視覺模型處理中英混合手寫，比 Tesseract 準確得多；輸出會標示 `[?]` 表示無法辨識的字，**不會臆測補字**。

### 3.3 手機與電腦同步

同步（多裝置即時一致）與備份（版本歷史）是兩件事，建議分開：

| 方案 | 同步 | 備份 | 評語 |
|---|---|---|---|
| **Obsidian Sync（付費）＋ 桌機 Git** | ✅ 端對端加密、手機體驗最好 | Git 每日推 GitHub | **推薦**：最穩定，手機零設定 |
| iCloud Drive（僅 Apple）＋ 桌機 Git | ✅ 免費 | Git | Vault 須放 iCloud/Obsidian；勿同時讓 Git 與 iCloud 管 `.git`（可把 `.git` 移出並用 `--git-dir`），設定較繁 |
| Obsidian Git 外掛（手機直接 Git） | ⚠️ iOS 慢、大庫易失敗 | ✅ | 適合技術型使用者、純文字小庫 |

---

## 前瞻性設計考量

1. **格式壽命 > 工具壽命**：Obsidian 未來可能被取代，但 Markdown + YAML frontmatter + 資料夾不會。避免依賴單一外掛的專屬語法作為唯一資訊來源（Dataview 查詢可以用，但資料本身要在 frontmatter）。
2. **AI 會換代，規則檔要可攜**：`CLAUDE.md` / `AGENTS.md` / `_ai/roles/` 都是純文字。下一代模型上下文更長，甚至可整庫讀入，但「引用出處、不捏造」的規範仍然適用。
3. **規模化後的檢索**：筆記超過約 5,000 則時，grep 式搜尋召回率會下降，屆時可加上本地向量索引（例如 embedding + SQLite）作為第二層檢索；目前不需要，先以 frontmatter 品質為主。評測集（`_ai/eval/`）就是決定「何時需要升級」的客觀依據。
4. **病人資料邊界要一開始就畫清楚**：事後清除 Git 歷史中的 PHI 非常困難（需重寫歷史且已推送的副本無法回收）。
