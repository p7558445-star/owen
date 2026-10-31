# 三上自然・認識植物|考點圖卡(南一版 3 上 單元 1)

依考題方向整理成 12 個考點,共 64 種植物。每個考點先有一張「必考重點+易錯陷阱」卡,
接著是該考點的植物卡(照片、課本重點與頁碼、考法問答、小知識)。
標示「課本沒有照片」的 25 種,是課本只提到名字、沒附照片的植物。

- `三上自然-認識植物-考點圖卡.pdf`:A4 一頁 4 張(每張 A6),可直接列印裁切,共 19 頁
- `topics.json`:12 個考點的必考重點與易錯陷阱
- `plants.json`:植物文字內容
- `photos.json`:每張照片的拍攝者、授權、iNaturalist 照片連結
- `images/`:照片(長邊 1800px)
- `build_cards.py` + `cards.css`:產生 HTML(`print` 版轉 PDF;`web` 版單檔可分享)

## 照片來源

全部取自 iNaturalist 開放資料集(AWS Open Data,2025-01 版),只用在台灣拍攝的觀察紀錄,
逐張人工檢視挑選。授權:CC BY-NC 50 張、CC BY 6 張、CC0 5 張、CC BY-NC-SA 2 張、CC BY-SA 1 張;
每張卡片下方都標了拍攝者與授權。CC BY-NC 照片僅限非商業使用(家庭、課堂複習可用)。

## 重新產生

```bash
python3 build_cards.py print <fontsource 字型目錄>   # 產生 cards-print.html,再用 Playwright 轉 PDF
python3 build_cards.py web                            # 產生 cards-web.html
```
