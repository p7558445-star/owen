#!/usr/bin/env python3
"""自動分類 00-Inbox 的筆記：建議資料夾、標題、type、tags，補齊 frontmatter。

用法：
  python scripts/classify.py              預覽（不改任何檔案）
  python scripts/classify.py --apply      依建議搬移並補 frontmatter
  python scripts/classify.py --min-confidence 0.8 --apply
只送出每則筆記前 4,000 字。既有 frontmatter 欄位不會被覆蓋，只補空缺。
"""
from __future__ import annotations

import argparse
from pathlib import Path

from _common import FOLDERS, INBOX, TYPES, VAULT, ClaudeError, ask_claude, rel, split_frontmatter, join_frontmatter, unique_path

SCHEMA = {
    "type": "object",
    "properties": {
        "folder": {"type": "string", "enum": list(FOLDERS)},
        "title": {"type": "string"},
        "type": {"type": "string", "enum": TYPES},
        "tags": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        "confidence": {"type": "number"},
        "phi_suspected": {"type": "boolean"},
    },
    "required": ["folder", "title", "type", "tags", "summary", "confidence", "phi_suspected"],
    "additionalProperties": False,
}

SYSTEM = "你是醫師科學家個人知識庫的分類員。資料夾定義：\n" + "\n".join(
    f"- {k}：{v}" for k, v in FOLDERS.items()
) + """
規則：
- folder 選最符合「這則筆記為了什麼產出」的資料夾；真的無法判斷選 00-Inbox。
- title 為簡潔繁體中文標題（≤25 字）。tags 3–6 個，小寫英文或中文名詞，優先使用醫學標準詞（如 sepsis、rct、irb）。
- summary 一句話（≤60 字）。confidence 為 0–1 的分類把握度。
- 若內容含可識別病人資訊（姓名、病歷號、身分證、生日），phi_suspected=true。"""


def classify(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    return ask_claude(f"檔名：{path.name}\n\n內容：\n{text[:4000]}", SYSTEM, effort="low", schema=SCHEMA, max_tokens=2000)


def apply(path: Path, r: dict) -> Path:
    meta, body = split_frontmatter(path.read_text(encoding="utf-8"))
    for k in ("title", "type"):
        meta.setdefault(k, r[k])
    meta["tags"] = sorted(set(meta.get("tags") or []) | set(r["tags"]))
    meta.setdefault("summary", r["summary"])
    dest = unique_path(VAULT / r["folder"] / path.name)
    dest.write_text(join_frontmatter(meta, body), encoding="utf-8")
    path.unlink()
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--min-confidence", type=float, default=0.7)
    a = ap.parse_args()

    notes = sorted(p for p in INBOX.glob("*.md") if not p.name.startswith("_"))
    if not notes:
        print("Inbox 是空的。")
        return
    for p in notes:
        try:
            r = classify(p)
        except ClaudeError as e:
            print(f"❌ {p.name}: {e}")
            continue
        flag = "⚠️PHI " if r["phi_suspected"] else ""
        print(f"{flag}{p.name}\n   → {r['folder']}  [{r['type']}] {r['title']}  conf={r['confidence']:.2f}\n   tags={r['tags']}  {r['summary']}")
        if not a.apply:
            continue
        if r["phi_suspected"]:
            print("   跳過：疑似含病人資訊，請先人工去識別化")
        elif r["folder"] == "00-Inbox" or r["confidence"] < a.min_confidence:
            print("   跳過：把握度不足，留在 Inbox 人工判斷")
        else:
            print(f"   ✅ 已移至 {rel(apply(p, r))}")
    if not a.apply:
        print("\n（預覽模式，未改動檔案。確認後加 --apply 執行）")


if __name__ == "__main__":
    main()
