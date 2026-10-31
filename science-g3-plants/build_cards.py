#!/usr/bin/env python3
"""產生「三上自然・植物圖卡」HTML。

用法:
  python3 build_cards.py print FONT_DIR   -> cards-print.html(A4 一頁 4 張,給 Playwright 轉 PDF)
  python3 build_cards.py web              -> cards-web.html(單檔、圖片內嵌,可直接分享)

資料:plants.json(文字,依南一版 3 上單元 1 內容)、photos.json(照片出處)、images/<id>.jpg
"""
import base64, html, io, json, sys
from pathlib import Path

HERE = Path(__file__).parent
plants = json.loads((HERE / "plants.json").read_text())
photos = json.loads((HERE / "photos.json").read_text())

COLORS = {"1": "#2a6f9e", "2": "#2f7d4a", "3": "#b5651d", "科": "#7a4fa0", "自": "#c2417a"}


def color(sec):
    k = sec[0]
    if k == "2" and any(w in sec for w in ("花", "果實")):
        return "#c2417a"
    return COLORS.get(k, "#2f7d4a")


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
    badge = "" if p["bookphoto"] else '<span class="nophoto">課本沒有照片・網路補圖</span>'
    credit = f'照片:{e(ph["observer"])}・{LIC.get(ph["license"], ph["license"])}・iNaturalist(台灣)'
    sci = p["sci"][0]
    return f"""
<article class="card" style="--c:{color(p['sec'])}">
  <div class="photo" style="background-image:url('{img_src(p['id'], mode)}');background-position:{ph.get('pos','center')}">
    <span class="chip">{e(p['sec'])}</span>{badge}
  </div>
  <div class="body">
    <h2>{e(p['zh'])}</h2>
    <div class="sci">{e(sci)}<span class="pg">課本 {e(p['page'])}</span></div>
    <p class="point"><b>課本重點</b>{e(p['point'])}</p>
    <p class="tip"><b>小知識</b>{e(p['tip'])}</p>
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
    # 課本沒有照片的排前面(這次的重點),其餘依課本頁序
    ordered = [p for p in plants if not p["bookphoto"]] + [p for p in plants if p["bookphoto"]]
    cards = [card(p, mode) for p in ordered]
    if mode == "print":
        pages = ["<section class='page'>" + "".join(cards[i:i + 4]) + "</section>" for i in range(0, len(cards), 4)]
        body = "".join(pages)
    else:
        body = "<header><h1>三上自然・植物圖卡</h1><p>南一版 3 上 單元 1「認識植物」・共 %d 張・照片皆為在台灣拍攝的 iNaturalist 開放授權照片;標示「課本沒有照片」的是課本只提到名字、沒有附照片的植物</p></header><main class='grid'>%s</main>" % (len(cards), "".join(cards))
    css = (HERE / "cards.css").read_text()
    out = HERE / ("cards-print.html" if mode == "print" else "cards-web.html")
    out.write_text(f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>三上植物圖卡</title>{fonts}<style>{css}</style></head>
<body class="{mode}">{body}</body></html>""")
    print(out)


main()
