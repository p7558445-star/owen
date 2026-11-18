# 檢索評測：AI 能否找到並正確引用你的資料

## 為什麼要測
「感覺好用」會受最近幾次經驗影響（可得性偏誤）。固定題組 + 客觀指標，才能比較：不同 AI、不同設定（例如加入向量索引前後）、知識庫整理前後。

## 步驟
1. 在 `questions.csv` 寫 **20–30 題**，每題你已知答案與正確出處（`gold_source`）。題型分配建議：
   - 事實查找（某計畫的經費、某研究的樣本數）40%
   - 跨文件彙整（過去所有關於 X 的研究）30%
   - 時間/版本（最新版 protocol 改了什麼）15%
   - **知識庫中沒有答案的題目** 15%（測試 AI 會不會承認不知道）
2. 用 `/research` 等指令逐題詢問，**每題開新對話**（避免前題資訊污染）。
3. 填欄位（1=是，0=否；無答案題的 `retrieved_correct` 指「正確回答找不到」）：
   - `ai_answer_source`：AI 引用的檔案
   - `retrieved_correct`：引用到 gold_source（或正確回答查無）
   - `citation_valid`：所引用的檔案確實存在且內容支持該句
   - `answer_correct`：答案內容正確
4. 計分：`python scripts/eval_score.py _ai/eval/questions.csv`

## 指標
| 指標 | 定義 | 目標（建議） |
|---|---|---|
| 檢索命中率 | retrieved_correct 平均 | ≥ 85% |
| 引用正確率 | citation_valid 平均 | ≥ 95% |
| 幻覺率 | 1 − citation_valid | ≤ 5% |
| 答案正確率 | answer_correct 平均 | ≥ 85% |

腳本輸出 Wilson 95% CI。兩種設定比較時（同一題組），用 `--compare other.csv` 做 McNemar 精確檢定（配對二元資料）。

## 解讀
- 題數少時 CI 很寬，n=20 只能偵測很大的差異。重要決策（例如是否付費導入某工具）前，把題組擴到 50 題以上。
- 檢索命中率低 → 改善 frontmatter、檔名、標籤；引用正確率低 → 加強 CLAUDE.md 的引用規範或換模型。
