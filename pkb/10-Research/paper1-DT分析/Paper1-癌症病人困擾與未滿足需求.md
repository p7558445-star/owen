---
title: Paper 1 — 癌症病人心理困擾、未滿足支持性照護需求與生活品質（彰基）
type: research
status: active
created: 2026-11-18
tags: [psycho-oncology, distress-thermometer, scns, unmet-needs, quality-of-life, cross-sectional, interim-analysis]
irb: CCH IRB 251009（核准 2025-11-10）
target_journal: Psycho-Oncology
source: OneDrive/00_進行中/paper1_DT分析/（README.md、stats.json、content/sections_rendered.json、outputs/Manuscript_n216_final.docx）
---
# Paper 1 — 癌症病人心理困擾、未滿足需求與生活品質

**英文標題**：Psychological Distress, Unmet Supportive Care Needs, and Quality of Life among Cancer Patients in Central Taiwan: A Cross-Sectional Survey
**目標期刊**：Psycho-Oncology（正文 ≤4000 字、摘要 ≤250 字、表 ≤5、圖 ≤5）

## 研究問題（PECO）
- P：彰化基督教醫院 ≥20 歲、5 年內診斷或復發之癌症病人
- E/C：性別、復發、轉移、共病、健康識能困難、未滿足需求數、身體 QoL
- O（主要）：臨床顯著困擾 DT ≥4

## 背景
- 母計畫：國健署委託、希望基金會協調之全國多中心「癌症病友及家屬照護經驗與需求調查」（2024–2026）；依 MOU 各院可獨立分析發表。
- 匿名 QR code 網路問卷（另備紙本），因此**無法計算回應率**。
- 先驗樣本數：每院 300 人（G*Power，單組比例 p0=0.88）。本稿為 **n=216 期中分析**，收案持續至 2027-05。
- 照顧者資料 n=176，預計另做 dyadic 分析。

## 方法
- 工具：DT＋問題清單（A11）、SCNS-35（A16，五點量表）、QoL 四分量表 VAS（A17）、工作能力（C4a）、收入變化（B6–B8）
- 統計：全部無母數（Spearman、Mann-Whitney U、Kruskal-Wallis、χ²）；8 個預先指定預測因子之多變項 logistic regression；VIF；未做多重比較校正
- 分析環境：Python 3.11（SciPy 1.11、statsmodels 0.14、pandas 2.0）

## 主要結果（來源：stats.json）
| 指標 | 數值 |
|---|---|
| 樣本 | N=216；女性 51.4%；年齡 60.0±12.7（21–91） |
| 癌別前三 | 乳癌 28.7%、口腔癌 16.2%、頭頸癌 12.5% |
| DT | 平均 4.36±3.60，中位數 5；DT≥4：125/216（57.9%） |
| Logistic（N=214，events=125） | 男性 OR 2.56（1.36–4.80），p=0.003；身體 QoL 每單位 OR 0.71（0.60–0.84），p<0.001；Nagelkerke R² 0.173；max VIF 1.31 |
| 雙變項 | 男 vs 女 DT 5.02 vs 3.73（U=6,920，p=0.015，r=0.19）；復發 vs 非復發 5.74 vs 4.03（p=0.018），調整後不顯著（OR 1.45，p=0.464） |
| 最高未滿足率（需求 n≥20） | 害怕復發 55.2%（80/145，34 重度）、生育 55.0%（n=20）、性健康 53.8%（n=26）、職場 52.2%（n=46） |
| 領域未滿足率 | 健康系統 14.0%、輔助/壓力 23.1%、心理存在 26.0%、社經 38.4% |
| 相關 | DT–未滿足數 ρ=0.237；DT–身體 QoL ρ=−0.341；DT–工作能力 ρ=−0.209 |
| 財務 | 收入減少 50.9%；工作改變 59.3%；月收入 <2 萬 22.7% |

## 核心論點
1. 男性困擾較高，可能與中部口腔/頭頸癌（男性為主）造成的外觀、吞嚥與污名有關。
2. 驅動困擾的是**功能後果**（身體 QoL），而非疾病嚴重度（分期、轉移）。
3. 害怕復發是最普遍且最常未被滿足的需求。
4. 全民健保下「健康系統/資訊」需求多已被滿足，剩餘負擔轉移到心理存在與間接成本領域（Discussion 的健康體系對比段落是本文最具原創性的論點）。

## 工作流程（可重用經驗）
見 [[單一數據來源的論文建置流程]]。

## 投稿前待修正
見 [[Paper1-數據一致性稽核-2026-11-18]]。

## 下一步
- [ ] 處理稽核清單中的問題 👤 本人
- [ ] 收滿 300 例後執行 `build.py` + `verify.py` 重出全文 👤 本人 📅 2027-05-31
- [ ] 照顧者資料（n=176）dyadic 分析規劃 👤 本人
