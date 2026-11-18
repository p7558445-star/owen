#!/usr/bin/env python3
"""掃描 Markdown/文字檔中可能可識別病人的資訊（PHI）。

用法：
  python scripts/phi_scan.py                 掃描整個 vault
  python scripts/phi_scan.py 路徑...         掃描指定檔案/資料夾
  python scripts/phi_scan.py --staged        掃描 git 暫存區（pre-commit hook 使用）

行尾加上 <!-- phi-ok --> 可略過該行（確認為偽陽性時）。
這是安全網而非保證：規則式偵測必有偽陰性，請勿以「掃描通過」作為合規依據。
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

VAULT = Path(__file__).resolve().parent.parent
TEXT_EXT = {".md", ".txt", ".csv", ".tsv", ".json", ".yaml", ".yml"}
SKIP_DIRS = {".git", ".obsidian", ".venv", "node_modules", "90-Templates"}

# 身分證／居留證第一碼字母對應數值
_ID_LETTER = dict(zip("ABCDEFGHJKLMNPQRSTUVXYWZIO", range(10, 36)))


def valid_tw_id(s: str) -> bool:
    n = _ID_LETTER.get(s[0])
    if n is None:
        return False
    digits = [n // 10, n % 10] + [int(c) for c in s[1:]]
    weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1]
    return sum(d * w for d, w in zip(digits, weights)) % 10 == 0


RULES: list[tuple[str, re.Pattern, callable | None]] = [
    ("身分證/居留證字號", re.compile(r"(?<![A-Za-z0-9])[A-Z][12890]\d{8}(?!\d)"), lambda m: valid_tw_id(m.group())),
    ("手機號碼", re.compile(r"(?<!\d)09\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)"), None),
    ("病歷號", re.compile(r"(病歷號碼?|病歷號|MRN|Chart\s*No\.?)\s*[:：#]?\s*[A-Za-z]?\d{5,}", re.I), None),
    ("病人姓名欄位", re.compile(r"(病人|患者|病患|個案)?姓名\s*[:：]\s*\S+"), None),
    ("出生日期欄位", re.compile(r"(生日|出生日期|出生年月日|DOB)\s*[:：]\s*\S+", re.I), None),
]


def scan_text(text: str, label: str) -> list[str]:
    hits = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if "phi-ok" in line:
            continue
        for name, pat, check in RULES:
            for m in pat.finditer(line):
                if check is None or check(m):
                    snippet = m.group()
                    masked = snippet[:3] + "*" * max(0, len(snippet) - 3)
                    hits.append(f"{label}:{lineno}: [{name}] {masked}")
    return hits


def iter_files(paths: list[Path]):
    for p in paths:
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in p.rglob("*"):
                if f.is_file() and f.suffix.lower() in TEXT_EXT and not (SKIP_DIRS & set(f.relative_to(p).parts)):
                    yield f


def staged_files() -> list[tuple[str, str]]:
    names = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
        capture_output=True, text=True, check=True, cwd=VAULT,
    ).stdout.split("\n")
    out = []
    for n in filter(None, names):
        if Path(n).suffix.lower() not in TEXT_EXT or Path(n).name == "phi_scan.py":
            continue
        blob = subprocess.run(["git", "show", f":{n}"], capture_output=True, cwd=VAULT)
        out.append((n, blob.stdout.decode("utf-8", errors="replace")))
    return out


def main(argv: list[str]) -> int:
    hits: list[str] = []
    if "--staged" in argv:
        for name, text in staged_files():
            hits += scan_text(text, name)
    else:
        targets = [Path(a) for a in argv] or [VAULT]
        for f in iter_files(targets):
            hits += scan_text(f.read_text(encoding="utf-8", errors="replace"), str(f))
    if hits:
        print("⛔ 偵測到可能的病人可識別資訊（PHI）：")
        print("\n".join(hits))
        print("\n請去識別化後再提交；確認為偽陽性可在該行加上 <!-- phi-ok -->。")
        return 1
    print("✅ PHI 掃描通過（規則式偵測，非保證）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
