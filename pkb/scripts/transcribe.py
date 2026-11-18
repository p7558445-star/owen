#!/usr/bin/env python3
"""錄音 → 逐字稿 Markdown（本機運算，音檔不上傳）。

用法：python scripts/transcribe.py 99-Attachments/audio/會議.m4a [--model large-v3] [--lang zh]
輸出：00-Inbox/YYYY-MM-DD-<檔名>-transcript.md

環境變數 PKB_WHISPER_MODEL 可改預設模型（例如 small 較快、large-v3 較準）。
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
from pathlib import Path

from _common import INBOX, rel, slug, write_note

INITIAL_PROMPT = "以下是繁體中文的醫院會議或研究討論錄音，可能夾雜英文醫學名詞，例如 sepsis、ICU、IRB、p value。"


def to_traditional(text: str) -> str:
    try:
        from opencc import OpenCC
    except ImportError:
        return text
    return OpenCC("s2twp").convert(text)


def fmt_ts(sec: float) -> str:
    return str(dt.timedelta(seconds=int(sec)))


def transcribe(audio: Path, model_size: str, lang: str) -> Path:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="auto", compute_type="default")
    segments, info = model.transcribe(
        str(audio), language=lang, vad_filter=True, initial_prompt=INITIAL_PROMPT
    )
    lines = []
    for s in segments:
        lines.append(f"[{fmt_ts(s.start)}] {to_traditional(s.text.strip())}")
        print(lines[-1])

    recorded = dt.date.fromtimestamp(audio.stat().st_mtime).isoformat()
    meta = {
        "title": f"{audio.stem} 逐字稿",
        "type": "meeting",
        "status": "idea",
        "created": recorded,
        "tags": ["transcript"],
        "source": rel(audio),
        "duration": fmt_ts(info.duration),
        "asr_model": f"faster-whisper {model_size}",
    }
    body = "> 自動語音辨識結果，未經校對。\n\n" + "\n".join(lines)
    return write_note(INBOX / f"{recorded}-{slug(audio.stem)}-transcript.md", meta, body)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio", type=Path, nargs="+")
    ap.add_argument("--model", default=os.environ.get("PKB_WHISPER_MODEL", "large-v3"))
    ap.add_argument("--lang", default="zh")
    a = ap.parse_args()
    for f in a.audio:
        out = transcribe(f.resolve(), a.model, a.lang)
        print(f"✅ {rel(out)}")


if __name__ == "__main__":
    main()
