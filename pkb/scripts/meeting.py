#!/usr/bin/env python3
"""逐字稿 → 正式會議紀錄 + 待辦事項（Obsidian Tasks 格式）。

用法：python scripts/meeting.py 00-Inbox/xxx-transcript.md [--series 科部會議] [--date 2026-11-18]
輸出：00-Inbox/YYYY-MM-DD-會議紀錄-<主題>.md；待辦另彙整到 00-Inbox/_待辦彙整.md
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from _common import INBOX, VAULT, ClaudeError, ask_claude, rel, role, slug, split_frontmatter, today, vault_rules, write_note

TEMPLATE = (VAULT / "90-Templates" / "meeting.md").read_text(encoding="utf-8")


def previous_open_tasks(series: str | None, limit: int = 3) -> str:
    """找同系列最近幾次會議中尚未完成的待辦，供「前次待辦追蹤」使用。"""
    files = sorted((VAULT / "50-Meetings").glob("*.md"), reverse=True)
    picked = []
    for f in files:
        meta, body = split_frontmatter(f.read_text(encoding="utf-8"))
        if series and meta.get("series") != series:
            continue
        open_tasks = [l for l in body.splitlines() if l.strip().startswith("- [ ]")]
        if open_tasks:
            picked.append(f"來源 [[{f.stem}]]：\n" + "\n".join(open_tasks))
        if len(picked) >= limit:
            break
    return "\n\n".join(picked) or "（無前次未完成待辦）"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("transcript", type=Path)
    ap.add_argument("--series", help="會議系列名稱，用於追蹤前次待辦")
    ap.add_argument("--date", help="會議日期 YYYY-MM-DD（預設取逐字稿 created）")
    a = ap.parse_args()

    meta, body = split_frontmatter(a.transcript.read_text(encoding="utf-8"))
    date = a.date or str(meta.get("created") or today())
    system = vault_rules() + "\n\n" + role("meeting-secretary")
    prompt = f"""會議日期：{date}
會議系列：{a.series or '未指定'}

## 前次未完成待辦
{previous_open_tasks(a.series)}

## 輸出模板（請依此結構，輸出完整 Markdown，不含 frontmatter；第一行為 `# 標題`）
{TEMPLATE.split('---', 2)[2]}

## 逐字稿
{body}"""
    try:
        text = ask_claude(prompt, system, effort="high")
    except ClaudeError as e:
        raise SystemExit(f"❌ {e}")

    title = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), "會議紀錄")
    out_meta = {"title": title, "type": "meeting", "status": "done", "created": date,
                "series": a.series or "", "tags": ["meeting"], "source": rel(a.transcript.resolve())}
    out = write_note(INBOX / f"{date}-會議紀錄-{slug(title, 30)}.md", out_meta, text)

    tasks = [l for l in text.splitlines() if re.match(r"\s*- \[ \]", l)]
    if tasks:
        agg = INBOX / "_待辦彙整.md"
        with agg.open("a", encoding="utf-8") as f:
            f.write(f"\n## {date} [[{out.stem}]]\n" + "\n".join(tasks) + "\n")
    print(f"✅ {rel(out)}（待辦 {len(tasks)} 項）")


if __name__ == "__main__":
    main()
