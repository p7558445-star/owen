#!/usr/bin/env python3
"""手寫筆記（圖片或 PDF）→ Markdown，使用 Claude 視覺辨識。

用法：python scripts/ocr.py 99-Attachments/scans/筆記.jpg [更多檔案...]
支援：.jpg .jpeg .png .webp .gif .pdf（HEIC 請先匯出為 JPG）
輸出：00-Inbox/YYYY-MM-DD-<檔名>-ocr.md
注意：影像會送到 Claude API；含病人資訊的手寫紀錄請勿使用。
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import io
from pathlib import Path

from _common import INBOX, ClaudeError, ask_claude, rel, slug, write_note

SYSTEM = """你是精確的手寫筆記轉錄員。把影像中的手寫內容轉成 Markdown。
規則：
1. 忠實轉錄，不摘要、不改寫、不補充。保留原本的條列、編號、箭頭（用 →）、圈選重點（用 **粗體**）。
2. 無法辨識的字用 [?] 表示；不確定的字寫成「字[?]」。絕不臆測補字。
3. 圖表或手繪示意圖：以 > [圖] 簡短描述其結構。
4. 中文用繁體；英文醫學名詞與縮寫照原樣。
5. 若看到可識別病人的資訊（姓名、病歷號、身分證），改寫為 [已去識別]。
6. 只輸出轉錄內容，第一行為 `# 標題`（依內容判斷，若無則寫 `# 手寫筆記`）。"""

IMG_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
MAX_EDGE = 2000


def image_block(path: Path) -> dict:
    from PIL import Image, ImageOps

    img = ImageOps.exif_transpose(Image.open(path))
    if max(img.size) > MAX_EDGE:
        img.thumbnail((MAX_EDGE, MAX_EDGE))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=90)
    data = base64.standard_b64encode(buf.getvalue()).decode()
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}}


def pdf_block(path: Path) -> dict:
    data = base64.standard_b64encode(path.read_bytes()).decode()
    return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}}


def ocr(path: Path) -> Path:
    ext = path.suffix.lower()
    if ext == ".pdf":
        block = pdf_block(path)
    elif ext in IMG_TYPES:
        block = image_block(path)
    else:
        raise SystemExit(f"不支援的格式：{path.name}")
    text = ask_claude([block, {"type": "text", "text": "請轉錄這份手寫筆記。"}], SYSTEM, effort="medium")
    title = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), path.stem)
    date = dt.date.fromtimestamp(path.stat().st_mtime).isoformat()
    meta = {"title": title, "type": "journal", "status": "idea", "created": date,
            "tags": ["handwritten", "ocr"], "source": rel(path)}
    body = f"> OCR 自動轉錄，[?] 為無法辨識處。原稿：![[{path.name}]]\n\n{text}"
    return write_note(INBOX / f"{date}-{slug(path.stem)}-ocr.md", meta, body)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", type=Path, nargs="+")
    for f in ap.parse_args().files:
        try:
            print(f"✅ {rel(ocr(f.resolve()))}")
        except ClaudeError as e:
            print(f"❌ {f.name}: {e}")


if __name__ == "__main__":
    main()
