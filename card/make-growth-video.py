"""DORY 成長影片：以微軟正黑體版卡片為主軸，產生 1080x1920 直式 MP4。

用法：python3 make-growth-video.py <卡片.pptx> <投影片圖片資料夾 s1.png…s8.png> <輸出.mp4>
投影片圖片由 LibreOffice 轉出的 PDF 逐頁輸出；照片與文字直接從 pptx 讀取，
所以在 PowerPoint 裡改過的內容會一起反映在影片裡。
"""
import io, os, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import imageio_ffmpeg

PPTX, SLIDES, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W, H, FPS, XF = 1080, 1920, 30, 0.8           # 解析度、影格率、交叉淡化秒數
PAGE, INK, SOFT, ROSE, LEAF = (244, 248, 244), (47, 58, 74), (94, 107, 124), (200, 100, 91), (111, 156, 126)
TAPES = [(243, 213, 122), (242, 167, 160), (169, 196, 228)]
REG, BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
font = lambda size, bold=False: ImageFont.truetype(BOLD if bold else REG, size, index=3)

# ---------- 從 pptx 讀照片與文字 ----------
prs = Presentation(PPTX)
def slide_parts(i):
    s = prs.slides[i]
    pics = [Image.open(io.BytesIO(sh.image.blob)).convert('RGB') for sh in s.shapes if sh.shape_type == MSO_SHAPE_TYPE.PICTURE]
    texts = [sh.text_frame.text for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
    return pics, texts

# ---------- 文字排版 ----------
NO_START = set('，。、！？；：」』）》…—')
def wrap(draw, text, f, width):
    lines = []
    for para in text.split('\n'):
        line = ''
        for ch in para:
            if draw.textlength(line + ch, font=f) > width and line:
                if ch in NO_START:                 # 標點不放行首
                    line, ch = line[:-1], line[-1] + ch
                lines.append(line); line = ''
            line += ch
        lines.append(line)
    return lines

def draw_lines(draw, lines, f, x, y, fill, gap, center=False):
    for ln in lines:
        lx = x - draw.textlength(ln, font=f) / 2 if center else x
        draw.text((lx, y), ln, font=f, fill=fill)
        y += gap
    return y

# ---------- 場景 ----------
def slide_scene(n, dur):
    img = Image.open(os.path.join(SLIDES, f's{n}.png')).convert('RGB')
    img = img.resize((W, round(img.height * W / img.width)), Image.LANCZOS)
    base = Image.new('RGB', (W, H), PAGE); base.paste(img, (0, (H - img.height) // 2))
    def frame(t):
        z = 1 + 0.045 * t / dur                     # 緩慢推近
        cw, ch = W / z, H / z
        return base.resize((W, H), Image.BICUBIC, box=((W - cw) / 2, (H - ch) / 2, (W + cw) / 2, (H + ch) / 2))
    return dur, frame

def photo_scene(photo, kicker, caption, title, body, dur, tape=0, finale=False):
    landscape = photo.width > photo.height
    pw = 960 if landscape else (700 if finale else 860)
    ph = round(pw / (photo.width / photo.height))
    pad, cap_h = 28, 70
    fw, fh = pw + pad * 2, ph + pad + cap_h
    fx, fy = (W - fw) // 2, 250 if not landscape else 360
    base = Image.new('RGB', (W, H), PAGE); d = ImageDraw.Draw(base)
    # 小標
    fk = font(30); d.text(((W - d.textlength(kicker, font=fk)) / 2, 150), kicker, font=fk, fill=ROSE if not finale else LEAF)
    # 拍立得外框與陰影
    sh = Image.new('L', (W, H), 0); ImageDraw.Draw(sh).rectangle((fx + 6, fy + 14, fx + fw + 6, fy + fh + 14), fill=90)
    base.paste((200, 208, 202), (0, 0), sh.filter(ImageFilter.GaussianBlur(14)))
    d.rectangle((fx, fy, fx + fw, fy + fh), fill=(255, 255, 255))
    fc = font(34); d.text(((W - d.textlength(caption, font=fc)) / 2, fy + pad + ph + 14), caption, font=fc, fill=SOFT)
    # 紙膠帶
    tp = Image.new('RGBA', (230, 62), TAPES[tape] + (225,)).rotate(-4 if tape % 2 == 0 else 5, expand=True, resample=Image.BICUBIC)
    base.paste(tp, ((W - tp.width) // 2, fy - tp.height // 2 - 4), tp)
    # 標題與內文
    ty = fy + fh + 70
    if finale:
        ft = font(66, True); y = draw_lines(d, title.split('\n'), ft, W / 2, ty, ROSE, 92, center=True)
        fb = font(36); draw_lines(d, wrap(d, body, fb, 900), fb, W / 2, y + 30, INK, 58, center=True)
    else:
        ft = font(58, True); d.text((90, ty), title, font=ft, fill=INK)
        fb = font(40); draw_lines(d, wrap(d, body, fb, 900), fb, 90, ty + 100, INK, 64)
    # 照片：外框內慢慢推近並微微平移（Ken Burns）
    src = photo.resize((round(pw * 1.12), round(ph * 1.12)), Image.LANCZOS)
    def frame(t):
        k = t / dur; z = 1.12 - 0.10 * k
        cw, chh = pw * 1.12 / z, ph * 1.12 / z
        cx = (src.width - cw) * (0.5 + 0.15 * (k - 0.5) * (1 if tape % 2 else -1))
        cy = (src.height - chh) * 0.4
        img = base.copy()
        img.paste(src.resize((pw, ph), Image.BICUBIC, box=(cx, cy, cx + cw, cy + chh)), (fx + pad, fy + pad))
        return img
    return dur, frame

# ---------- 場景清單（依卡片頁序） ----------
scenes = [slide_scene(1, 6)]
chapters = [(1, '第一章 · 相信自己'), (2, '第二章 · 肯定自己'), (3, '第三章 · 戰勝自己')]
for si, kicker in chapters:
    pics, texts = slide_parts(si)
    # 文字順序：章/標題/引言，然後每張照片：日期、分類、標題、內文，最後一行是底部金句
    items = [texts[3:7], texts[7:11]]
    scenes.append(slide_scene(si + 1, 4.5))
    for k, (pic, it) in enumerate(zip(pics, items)):
        scenes.append(photo_scene(pic, kicker, it[0], it[2], it[3], 6.5, tape=k))
pics, texts = slide_parts(4)                       # 鋼琴頁
scenes.append(photo_scene(pics[0], '第三章 · 戰勝自己', texts[1], texts[3], texts[4], 7, tape=2))
pics, texts = slide_parts(5)                       # 最後一頁
scenes.append(photo_scene(pics[0], '最後一頁', texts[1], texts[2], texts[3].replace('\n', ''), 9, tape=1, finale=True))
scenes.append(slide_scene(7, 18))                  # 信：留足夠的閱讀時間
scenes.append(slide_scene(8, 6))

total = sum(d for d, _ in scenes) - XF * (len(scenes) - 1)
print(f'{len(scenes)} 個場景，總長約 {total:.1f} 秒')

# ---------- 配樂：自動合成的音樂盒旋律（C–G–Am–F） ----------
def music(seconds, sr=44100):
    n = int(seconds * sr); out = np.zeros(n)
    bpm = 72; beat = 60 / bpm; eighth = beat / 2
    chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]
    melody = [[72, 76, 79, 76], [74, 71, 74, 79], [76, 72, 69, 72], [77, 72, 69, 72]]
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    def note(m, start, amp, decay):
        i0 = int(start * sr); L = min(int(2.5 * sr), n - i0)
        if L <= 0: return
        t = np.arange(L) / sr; f = hz(m)
        tone = np.sin(2*np.pi*f*t) + .35*np.sin(2*np.pi*2*f*t) + .12*np.sin(2*np.pi*3.01*f*t) + .05*np.sin(2*np.pi*4.2*f*t)
        out[i0:i0+L] += amp * tone * np.exp(-t / decay) * np.minimum(1, t / .004)
    bar = 4 * beat; b = 0
    while b * bar < seconds:
        c = chords[b % 4]; mel = melody[b % 4]; t0 = b * bar
        note(c[0] - 12, t0, .16, 1.8); note(c[0] - 12, t0 + 2 * beat, .10, 1.6)
        for k in range(8): note(c[k % 3] + (12 if k in (3, 7) else 0), t0 + k * eighth, .07, .9)
        if b >= 2:                                  # 前兩小節只有伴奏，之後加入旋律
            for k, m in enumerate(mel): note(m, t0 + k * beat, .13, 1.3)
        b += 1
    # 簡單殘響
    for dly, g in ((.11, .25), (.23, .15), (.37, .08)):
        k = int(dly * sr); out[k:] += g * out[:-k]
    env = np.minimum(1, np.arange(n) / (2.5 * sr)) * np.minimum(1, (n - np.arange(n)) / (4 * sr))
    out = out * env; out = out / np.max(np.abs(out)) * 0.5
    return (out * 32767).astype(np.int16), sr

if os.environ.get('PREVIEW'):                       # 只輸出每個場景中間的一格，供檢查版面
    for k, (d, f) in enumerate(scenes): f(d / 2).save(os.path.join(os.environ['PREVIEW'], f'scene{k:02d}.jpg'), quality=80)
    sys.exit()

wav_path = OUT + '.wav'
pcm, sr = music(total)
with wave.open(wav_path, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())

# ---------- 逐格輸出 ----------
ff = imageio_ffmpeg.get_ffmpeg_exe()
proc = subprocess.Popen([ff, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                         '-i', wav_path, '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
                         '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
starts, t = [], 0.0
for d, _ in scenes: starts.append(t); t += d - XF
nframes = int(total * FPS)
for i in range(nframes):
    t = i / FPS
    act = [(k, t - s) for k, s in enumerate(starts) if s <= t < s + scenes[k][0]]
    k, lt = act[-1]
    img = scenes[k][1](lt)
    if len(act) > 1 and lt < XF:                    # 交叉淡化
        pk, plt = act[-2]; img = Image.blend(scenes[pk][1](plt), img, lt / XF)
    if t > total - 1.5:                             # 結尾淡出到白色
        img = Image.blend(img, Image.new('RGB', (W, H), (255, 255, 255)), (t - (total - 1.5)) / 1.5)
    proc.stdin.write(img.tobytes())
proc.stdin.close(); proc.wait()
os.remove(wav_path)
print('完成', OUT)
