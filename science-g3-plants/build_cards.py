#!/usr/bin/env python3
"""產生「三上自然・植物圖卡(依考題方向)」HTML。

用法:
  python3 build_cards.py print FONT_DIR   -> cards-print.html(A4 一頁 4 張,給 Playwright 轉 PDF)
  python3 build_cards.py web              -> cards-web.html(單檔、圖片內嵌,可直接分享)

資料:
  topics.json  12 個考點(必考重點、易錯陷阱),依南一版 3 上單元 1 概念圖排序
  plants.json  每種植物:所屬考點、課本重點、考法(問/答)、小知識
  photos.json  照片出處;images/<id>.jpg
"""
import base64, html, io, json, sys
from pathlib import Path

HERE = Path(__file__).parent
topics = json.loads((HERE / "topics.json").read_text())
plants = json.loads((HERE / "plants.json").read_text())
photos = json.loads((HERE / "photos.json").read_text())
e = html.escape

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
    im.thumbnail((900, 900))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=78, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def topic_card(t, n):
    must = "".join(f"<li>{e(x)}</li>" for x in t["must"])
    trap = "".join(f"<li>{e(x)}</li>" for x in t["trap"])
    return f"""
<article class="card topic" style="--c:{t['color']}" id="{t['id']}">
  <div class="thead"><span class="tno">考點 {n}</span><h2>{e(t['title'])}</h2><div class="tsub">{e(t['sub'])}</div></div>
  <div class="body">
    <h3>必考重點</h3><ul>{must}</ul>
    <h3 class="warn">易錯陷阱</h3><ul class="trap">{trap}</ul>
  </div>
</article>"""


def plant_card(p, t, n, mode):
    ph = photos[p["id"]]
    badge = "" if p["bookphoto"] else '<span class="nophoto">課本沒有照片</span>'
    where = "iNaturalist(台灣)" if ph.get("tw", True) else "iNaturalist"
    credit = f'照片:{e(ph["observer"])}・{LIC.get(ph["license"], ph["license"])}・{where}'
    return f"""
<article class="card" style="--c:{t['color']}">
  <div class="photo" style="background-image:url('{img_src(p['id'], mode)}');background-position:{ph.get('pos', 'center')}">
    <span class="chip">考點 {n}・{e(t['title'])}</span>{badge}
  </div>
  <div class="body">
    <h2>{e(p['zh'])}</h2>
    <div class="sci">{e(p['sci'][0])}<span class="pg">課本 {e(p['page'])}</span></div>
    <p class="point"><b>課本重點</b>{e(p['point'])}</p>
    <div class="qa"><div class="q"><b>考法</b>{e(p['q'])}</div><div class="a">答:{e(p['a'])}</div></div>
    <p class="tip"><b>小知識</b>{e(p['tip'])}</p>
    <div class="credit">{credit}</div>
  </div>
</article>"""


def main():
    mode = sys.argv[1]
    if mode == "print":
        fd = sys.argv[2]
        fonts = "\n".join(
            f'<link rel="stylesheet" href="{fd}/fontsource-noto-sans-tc-5.2.8/package/{w}.css">' for w in (400, 500, 700, 900)
        )
    else:
        fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
                 '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap">')
    groups = []
    for n, t in enumerate(topics, 1):
        ps = [p for p in plants if p["topic"] == t["id"]]
        groups.append((n, t, [topic_card(t, n)] + [plant_card(p, t, n, mode) for p in ps]))
    nplants = len(plants)
    nmiss = sum(not p["bookphoto"] for p in plants)
    if mode == "print":
        cards = [c for _, _, cs in groups for c in cs]
        body = "".join("<section class='sheet'>" + "".join(cards[i:i + 4]) + "</section>" for i in range(0, len(cards), 4))
    else:
        nav = "".join(f'<a href="#{t["id"]}">{n}. {e(t["title"])}</a>' for n, t, _ in groups)
        secs = "".join(f"<section class='grp'><h2 class='gh'>考點 {n}|{e(t['title'])}</h2><div class='grid'>{''.join(cs)}</div></section>"
                       for n, t, cs in groups)
        body = (f"<header><h1>三上自然・認識植物|考點圖卡</h1>"
                f"<p>南一版 3 上 單元 1・依考題方向分 12 個考點・{nplants} 種植物;"
                f"其中 {nmiss} 種標示「課本沒有照片」,是課本只提到名字、沒附照片的植物。照片皆為 iNaturalist 開放授權照片。</p>"
                f"<nav>{nav}</nav></header><main>{secs}</main>")
    css = (HERE / "cards.css").read_text()
    out = HERE / ("cards-print.html" if mode == "print" else "cards-web.html")
    out.write_text(f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>三上植物考點圖卡</title>{fonts}<style>{css}</style></head>
<body class="{mode}">{body}</body></html>""")
    print(out)


main()
