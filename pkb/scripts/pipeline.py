#!/usr/bin/env python3
"""一鍵處理：新錄音 → 逐字稿 → 會議紀錄；新掃描 → OCR；最後列出 Inbox 分類建議。

用法：python scripts/pipeline.py [--no-meeting] [--classify-apply]
已處理的檔案記錄在 .pipeline-state.json，不會重複處理（重新處理請刪除該紀錄）。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from _common import VAULT

STATE = VAULT / ".pipeline-state.json"
AUDIO = VAULT / "99-Attachments" / "audio"
SCANS = VAULT / "99-Attachments" / "scans"
AUDIO_EXT = {".m4a", ".mp3", ".wav", ".mp4", ".aac", ".ogg", ".flac"}
SCAN_EXT = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
PY = sys.executable
HERE = Path(__file__).parent


def run(script: str, *args: str) -> str:
    r = subprocess.run([PY, str(HERE / script), *args], capture_output=True, text=True)
    print(r.stdout[-2000:], r.stderr[-2000:] if r.returncode else "", sep="")
    if r.returncode:
        raise RuntimeError(f"{script} 失敗")
    return r.stdout


def new_files(folder: Path, exts: set[str], done: set[str]) -> list[Path]:
    return sorted(p for p in folder.glob("*") if p.suffix.lower() in exts and p.name not in done)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-meeting", action="store_true", help="只轉逐字稿，不送雲端產生會議紀錄")
    ap.add_argument("--classify-apply", action="store_true")
    a = ap.parse_args()

    state = json.loads(STATE.read_text()) if STATE.exists() else {"audio": [], "scans": []}
    done_a, done_s = set(state["audio"]), set(state["scans"])

    for f in new_files(AUDIO, AUDIO_EXT, done_a):
        print(f"🎙  {f.name}")
        try:
            out = run("transcribe.py", str(f))
            transcript = next(l.split("✅ ", 1)[1].strip() for l in out.splitlines() if l.startswith("✅ "))
            if not a.no_meeting:
                run("meeting.py", str(VAULT / transcript))
            state["audio"].append(f.name)
        except (RuntimeError, StopIteration) as e:
            print(f"❌ {f.name}: {e}")

    for f in new_files(SCANS, SCAN_EXT, done_s):
        print(f"📝 {f.name}")
        try:
            run("ocr.py", str(f))
            state["scans"].append(f.name)
        except RuntimeError as e:
            print(f"❌ {f.name}: {e}")

    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    print("🗂  Inbox 分類")
    run("classify.py", *(["--apply"] if a.classify_apply else []))


if __name__ == "__main__":
    main()
