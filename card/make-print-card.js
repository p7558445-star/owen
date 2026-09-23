// 產生可編輯、可列印的 A5 成長小書（PowerPoint）
// 用法：node make-print-card.js <照片資料夾> <輸出檔.pptx>
const pptxgen = require('pptxgenjs');
const path = require('path');

const PHOTOS = process.argv[2] || './photos';
const OUT = process.argv[3] || 'DORY成長小書.pptx';
const img = n => path.join(PHOTOS, n + '.jpg');

const C = { ink: '2F3A4A', soft: '5E6B7C', rose: 'C8645B', leaf: '6F9C7E', page: 'F4F8F4',
  paper: 'FFFFFF', yellow: 'F3D57A', pink: 'F2A7A0', blue: 'A9C4E4' };
const HAND = '標楷體', UI = 'Microsoft JhengHei';
const W = 5.83, H = 8.27, M = 0.45;

const pres = new pptxgen();
pres.defineLayout({ name: 'A5', width: W, height: H });
pres.layout = 'A5';
pres.title = '給 DORY 的成長小書';

const shadow = () => ({ type: 'outer', color: C.ink, opacity: 0.22, blur: 6, offset: 2, angle: 90 });
function text(slide, t, o) {
  slide.addText(t, Object.assign({ isTextBox: true, margin: 0, fontFace: HAND, color: C.ink, valign: 'top' }, o));
}
function tape(slide, x, y, color, rot) {
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.85, h: 0.24, rotate: rot, fill: { color, transparency: 15 }, line: { type: 'none' } });
}
// 拍立得：白框 + 照片 + 手寫說明，回傳底部 y
function polaroid(slide, { x, y, w, ratio, photo, caption, tapeColor = C.yellow, tapeRot = -4 }) {
  const pad = 0.12, pw = w - pad * 2, ph = pw / ratio, capH = 0.3;
  const h = pad + ph + 0.06 + capH + 0.06;
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: C.paper }, line: { color: 'E3E8E4', width: 0.5 }, shadow: shadow() });
  slide.addImage({ path: img(photo), x: x + pad, y: y + pad, w: pw, h: ph, altText: caption || photo });
  if (caption) text(slide, caption, { x: x + pad, y: y + pad + ph + 0.06, w: pw, h: capH, fontSize: 10.5, color: C.soft, align: 'center', valign: 'middle' });
  tape(slide, x + w / 2 - 0.425, y - 0.12, tapeColor, tapeRot);
  return y + h;
}
function newPage() { const s = pres.addSlide(); s.background = { color: C.page }; return s; }
function chapterHead(slide, no, title, note) {
  text(slide, no, { x: M, y: 0.5, w: W - 2 * M, h: 0.25, fontFace: UI, fontSize: 9, color: C.rose, charSpacing: 4 });
  text(slide, title, { x: M, y: 0.76, w: W - 2 * M, h: 0.55, fontSize: 26, valign: 'middle' });
  if (note) text(slide, note, { x: M, y: 1.34, w: W - 2 * M, h: 0.32, fontSize: 11.5, color: C.soft });
}
// 兩張直式照片並排 + 各自的標題與內文
function footQuote(slide, q) {
  text(slide, q, { x: M, y: H - 1.05, w: W - 2 * M, h: 0.4, fontSize: 13, color: C.rose, align: 'center', valign: 'middle' });
}
function twoUp(slide, items) {
  const gap = 0.3, w = (W - 2 * M - gap) / 2;
  items.forEach((it, i) => {
    const x = M + i * (w + gap);
    const bottom = polaroid(slide, { x, y: 1.95, w, ratio: 4 / 5, photo: it.photo, caption: it.date,
      tapeColor: i ? C.pink : C.yellow, tapeRot: i ? 5 : -4 });
    text(slide, it.label, { x, y: bottom + 0.22, w, h: 0.22, fontFace: UI, fontSize: 8, color: C.leaf, charSpacing: 3 });
    text(slide, it.title, { x, y: bottom + 0.44, w, h: 0.36, fontSize: 14.5, valign: 'middle' });
    text(slide, it.text, { x, y: bottom + 0.86, w, h: H - bottom - 2.1, fontSize: 11, lineSpacingMultiple: 1.25 });
  });
}

// 1. 封面
let s = newPage();
text(s, 'DORY · 2023 — 2025', { x: M, y: 0.62, w: W - 2 * M, h: 0.25, fontFace: UI, fontSize: 9, color: C.leaf, align: 'center', charSpacing: 4 });
text(s, [{ text: '給 ' }, { text: 'DORY', options: { color: C.rose } }, { text: ' 的成長小書' }],
  { x: M, y: 0.92, w: W - 2 * M, h: 0.75, fontSize: 30, align: 'center', valign: 'middle' });
text(s, '相信自己 · 肯定自己 · 戰勝自己', { x: M, y: 1.75, w: W - 2 * M, h: 0.4, fontSize: 14, align: 'center', valign: 'middle', charSpacing: 1 });
polaroid(s, { x: 0.6, y: 2.6, w: W - 1.2, ratio: 4 / 3, photo: 'cover', caption: '2025.06.22 · 繡球花開的日子', tapeColor: C.blue, tapeRot: -3 });
text(s, '送給親愛的亦倢', { x: M, y: 6.95, w: W - 2 * M, h: 0.4, fontSize: 14, color: C.soft, align: 'center', valign: 'middle' });

// 2. 第一章 相信自己
s = newPage();
chapterHead(s, '第一章', '相信自己', '敢站上去，就已經贏了一半。');
twoUp(s, [
  { photo: 'dance1', date: '2023.07.15', label: '舞蹈', title: '舞蹈教室裡的小舞者', text: '穿上亮晶晶的表演服，擺出最有自信的姿勢。你相信自己做得到，所以你真的做到了。' },
  { photo: 'dance2', date: '2023.07.18', label: '舞蹈', title: '站上舞台', text: '燈光亮起、台下坐滿了人，你還是跟著音樂把每個動作跳完。相信自己，就是這個樣子。' }]);
footQuote(s, '相信自己，你比你想像的更勇敢。');

// 3. 第二章 肯定自己
s = newPage();
chapterHead(s, '第二章', '肯定自己', '你的畫、你的顏色，都值得被好好欣賞。');
twoUp(s, [
  { photo: 'drawing', date: '我的山水畫', label: '畫畫', title: '你畫的山和河', text: '紫色的山、彎彎的河、小房子和大樹，還有白色的雲霧。你的畫不用跟別人一樣，它就是你看世界的樣子。' },
  { photo: 'gallery', date: '2025.03.01', label: '畫畫', title: 'DORY 的小畫展', text: '牆上貼滿你的畫，那幅山水畫也在上面。你拿著小紅花站在中間——這是你為自己贏得的掌聲。' }]);
footQuote(s, '你不需要完美，做你自己就很好。');

// 4. 第三章 戰勝自己
s = newPage();
chapterHead(s, '第三章', '戰勝自己', '真正的對手不是別人，而是昨天的自己。');
twoUp(s, [
  { photo: 'award1', date: '2024.03.17', label: '努力', title: '努力被看見了', text: '胸前掛著獎牌、手上舉著獎狀。比起那張紙，我們更記得你為它練習了多少次。' },
  { photo: 'award2', date: '2025.01', label: '努力', title: '笑得最燦爛的 YA', text: '又一張獎狀，你笑得眼睛都瞇起來了。你打敗的不是別人，而是那個曾經想說「我不行」的自己。' }]);
footQuote(s, '做不到的事，只是「還」做不到而已。');

// 5. 第三章（續）鋼琴
s = newPage();
text(s, '第三章 · 戰勝自己', { x: M, y: 0.5, w: W - 2 * M, h: 0.25, fontFace: UI, fontSize: 9, color: C.rose, charSpacing: 4 });
let b = polaroid(s, { x: M, y: 1.05, w: W - 2 * M, ratio: 1.6, photo: 'piano', caption: '琴聲', tapeColor: C.blue, tapeRot: 3 });
text(s, '鋼琴', { x: M, y: b + 0.3, w: W - 2 * M, h: 0.22, fontFace: UI, fontSize: 8, color: C.leaf, charSpacing: 3 });
text(s, '琴鍵前的專注', { x: M, y: b + 0.52, w: W - 2 * M, h: 0.45, fontSize: 18, valign: 'middle' });
text(s, '在大家面前彈琴需要很大的勇氣。你坐上去，一個音一個音把曲子彈完——那一刻，你戰勝了自己。',
  { x: M, y: b + 1.05, w: W - 2 * M, h: 1.0, fontSize: 12, lineSpacingMultiple: 1.3 });
footQuote(s, '每一次，都比昨天的你再進步一點點。');

// 6. 最後一頁 公主之夜
s = newPage();
text(s, '最後一頁', { x: M, y: 0.5, w: W - 2 * M, h: 0.25, fontFace: UI, fontSize: 9, color: C.leaf, align: 'center', charSpacing: 4 });
b = polaroid(s, { x: (W - 3.0) / 2, y: 0.98, w: 3.0, ratio: 4 / 5, photo: 'princess', caption: '2025.05.31 · 公主之夜', tapeColor: C.pink, tapeRot: 4 });
text(s, '在爸媽心中，\n你永遠是最棒的', { x: M, y: b + 0.22, w: W - 2 * M, h: 0.95, fontSize: 22, color: C.rose, align: 'center', valign: 'middle', lineSpacingMultiple: 1.15 });
text(s, '穿上安娜公主的禮服、戴上小皇冠，你對著鏡頭比了一個讚。DORY，就像這個讚一樣——要記得常常為自己按讚。不管輸或贏、跳錯或彈錯，你永遠是我們心中最棒的公主。',
  { x: M + 0.2, y: b + 1.3, w: W - 2 * M - 0.4, h: H - b - 1.75, fontSize: 11, align: 'center', lineSpacingMultiple: 1.3 });

// 7. 信
s = newPage();
s.addShape(pres.shapes.RECTANGLE, { x: M - 0.05, y: 0.55, w: W - 2 * M + 0.1, h: H - 1.1, fill: { color: C.paper }, line: { color: 'E3E8E4', width: 0.5 }, shadow: shadow() });
tape(s, W / 2 - 0.425, 0.43, C.blue, 2);
text(s, '親愛的 亦倢：', { x: M + 0.25, y: 0.95, w: W - 2 * M - 0.5, h: 0.45, fontSize: 16, valign: 'middle' });
text(s, [
  '這張卡片裡，是你這幾年最勇敢的樣子。', '',
  '你站上舞台的時候，是在「相信自己」——就算台下坐滿了人，你還是把舞跳完。',
  '你畫出自己的山和河的時候，是在「肯定自己」——你的顏色，不需要跟別人一樣。',
  '你一次又一次練琴、努力拿到獎狀的時候，是在「戰勝自己」——每一次，都比昨天的你再進步一點點。', '',
  '以後一定會遇到覺得自己不夠好的時候。那時候，請翻開這張卡片，看看照片裡那個勇敢的你。', '',
  '不管分數、不管輸贏，在爸爸媽媽心中，你永遠是最棒的。'
].join('\n'), { x: M + 0.25, y: 1.5, w: W - 2 * M - 0.5, h: 4.9, fontSize: 11.5, lineSpacingMultiple: 1.4, paraSpaceAfter: 2 });
text(s, '2026 年 9 月 23 日\n永遠愛你的 爸爸 & 媽媽', { x: M + 0.25, y: H - 1.55, w: W - 2 * M - 0.5, h: 0.7, fontSize: 13, align: 'right', valign: 'bottom', lineSpacingMultiple: 1.3 });

// 8. 封底
s = newPage();
s.addShape(pres.shapes.HEART, { x: W / 2 - 0.35, y: 3.2, w: 0.7, h: 0.62, fill: { color: C.pink }, line: { type: 'none' } });
text(s, '相信自己 · 肯定自己 · 戰勝自己', { x: M, y: 4.05, w: W - 2 * M, h: 0.4, fontSize: 13, align: 'center', valign: 'middle' });
text(s, '爸爸 & 媽媽　2026.09.23', { x: M, y: H - 0.95, w: W - 2 * M, h: 0.3, fontFace: UI, fontSize: 9, color: C.soft, align: 'center', valign: 'middle', charSpacing: 2 });

pres.writeFile({ fileName: OUT }).then(f => console.log('wrote', f));
