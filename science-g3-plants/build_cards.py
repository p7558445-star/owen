#!/usr/bin/env python3
"""產生「三上自然・植物圖卡」HTML。

用法:
  python3 build_cards.py print FONT_DIR   -> cards-print.html(A4 一頁 4 張,給 Playwright 轉 PDF)
  python3 build_cards.py web              -> cards-web.html(單檔、圖片內嵌,可直接分享)

資料:plants.json(文字)、photos.json(照片出處)、images/<id>.jpg
"""
import base64, html, io, json, sys
from pathlib import Path

HERE = Path(__file__).parent
plants = json.loads((HERE / "plants.json").read_text())
photos = json.loads((HERE / "photos.json").read_text())

GROUP = {  # 單元觀念分組 -> (標籤, 顏色)
    "根": ("觀察根", "#8a5a2b"),
    "莖": ("觀察莖", "#2f7d4a"),
    "葉": ("觀察葉", "#4d8f1f"),
    "花": ("花・果實・種子", "#c2417a"),
    "環境": ("植物與環境", "#2a6f9e"),
}
LIC = {
    "CC0": "CC0", "CC-BY": "CC BY 4.0", "CC-BY-NC": "CC BY-NC 4.0",
    "CC-BY-SA": "CC BY-SA 4.0", "CC-BY-NC-SA": "CC BY-NC-SA 4.0",
}


def img_src(pid, mode):
    f = HERE / "images" / f"{pid}.jpg"
    if mode == "print":
        return f"images/{pid}.jpg"
    from PIL import Image
    im = Image.open(f)
    im.thumbnail((1000, 1000))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=80, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def card(p, mode):
    e = html.escape
    ph = photos[p["id"]]
    label, color = GROUP[p["group"]]
    credit = f'照片:{e(ph["observer"])}・{LIC.get(ph["license"], ph["license"])}・iNaturalist(台灣)'
    return f"""
<article class="card" style="--c:{color}">
  <div class="photo" style="background-image:url('{img_src(p['id'], mode)}');background-position:{ph.get('pos','center')}">
    <span class="chip">{label}</span>
  </div>
  <div class="body">
    <h2>{e(p['zh'])}</h2>
    <div class="sci">{e(p['sci'])}</div>
    <dl>
      <dt>根</dt><dd>{e(p['root'])}</dd>
      <dt>莖</dt><dd>{e(p['stem'])}</dd>
      <dt>葉</dt><dd>{e(p['leaf'])}</dd>
    </dl>
    <p class="tip"><b>觀察重點</b>{e(p['tip'])}</p>
    <p class="use"><b>生活中</b>{e(p['use'])}</p>
    <div class="credit">{credit}</div>
  </div>
</article>"""


def main():
    mode = sys.argv[1]
    if mode == "print":
        fd = sys.argv[2]
        fonts = "\n".join(
            f'<link rel="stylesheet" href="{fd}/fontsource-noto-sans-tc-5.2.8/package/{w}.css">' for w in (400, 700, 900)
        )
    else:
        fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
                 '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;900&display=swap">')
    cards = [card(p, mode) for p in plants]
    if mode == "print":
        pages = ["<section class='page'>" + "".join(cards[i:i + 4]) + "</section>" for i in range(0, len(cards), 4)]
        body = "".join(pages)
    else:
        body = "<header><h1>三上自然・植物圖卡</h1><p>南一版第一單元複習用・共 %d 張・照片皆為在台灣拍攝的 iNaturalist 開放授權照片</p></header><main class='grid'>%s</main>" % (len(cards), "".join(cards))
    css = (HERE / "cards.css").read_text()
    out = HERE / ("cards-print.html" if mode == "print" else "cards-web.html")
    out.write_text(f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>三上植物圖卡</title>{fonts}<style>{css}</style></head>
<body class="{mode}">{body}</body></html>""")
    print(out)


main()
