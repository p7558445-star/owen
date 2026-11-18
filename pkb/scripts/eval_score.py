#!/usr/bin/env python3
"""計算檢索評測指標與 Wilson 95% 信賴區間；可做兩組設定的 McNemar 精確檢定。

用法：
  python scripts/eval_score.py _ai/eval/questions.csv
  python scripts/eval_score.py A.csv --compare B.csv      （同題組、以 id 配對）
欄位值 1/0；空白視為未評分並排除。
"""
from __future__ import annotations

import argparse
import csv
from math import comb, sqrt

METRICS = {"retrieved_correct": "檢索命中率", "citation_valid": "引用正確率", "answer_correct": "答案正確率"}


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def mcnemar_exact(b: int, c: int) -> float:
    """雙尾精確 McNemar：不一致配對 b、c 在 H0 下 ~ Binomial(b+c, 0.5)。"""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    p = 2 * sum(comb(n, i) for i in range(k + 1)) / 2**n
    return min(1.0, p)


def load(path: str) -> dict[str, dict[str, int]]:
    rows = {}
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows[r["id"]] = {m: int(r[m]) for m in METRICS if (r.get(m) or "").strip() in ("0", "1")}
    return rows


def summarize(rows, label: str):
    print(f"== {label} ==")
    for m, name in METRICS.items():
        vals = [r[m] for r in rows.values() if m in r]
        n, k = len(vals), sum(vals)
        if n == 0:
            print(f"{name}: 尚無資料")
            continue
        lo, hi = wilson(k, n)
        print(f"{name}: {k}/{n} = {k/n:.1%}  (95% CI {lo:.1%}–{hi:.1%})")
        if m == "citation_valid":
            print(f"幻覺率: {(n-k)/n:.1%}  (95% CI {1-hi:.1%}–{1-lo:.1%})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("--compare")
    a = ap.parse_args()
    A = load(a.csv)
    summarize(A, a.csv)
    if a.compare:
        B = load(a.compare)
        summarize(B, a.compare)
        print("== 配對比較（McNemar 精確檢定）==")
        for m, name in METRICS.items():
            ids = [i for i in A if i in B and m in A[i] and m in B[i]]
            b = sum(A[i][m] == 1 and B[i][m] == 0 for i in ids)
            c = sum(A[i][m] == 0 and B[i][m] == 1 for i in ids)
            print(f"{name}: 配對 n={len(ids)}，僅A對={b}，僅B對={c}，p={mcnemar_exact(b, c):.3f}")


if __name__ == "__main__":
    main()
