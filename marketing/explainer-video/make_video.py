#!/usr/bin/env python3
"""Render a 30s explainer video for Whispered Events (brand: cream/charcoal/gold)."""
import os, subprocess, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from gtts import gTTS
import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
OUT = os.environ.get("OUT_DIR", ".")
W, H, FPS = 1920, 1080, 30
SR = 44100

CREAM = (245, 239, 230)      # #F5EFE6
CREAM_DARK = (232, 221, 208) # #E8DDD0
CHARCOAL = (26, 26, 46)      # #1a1a2e
GRAY = (107, 114, 128)
LOGO_GRAY = (171, 171, 171)  # #ABABAB
GOLD = (184, 114, 20)        # gold-600 #b87214
GOLD_DEEP = (146, 82, 18)    # gold-700

DEJAVU = "/usr/share/fonts/truetype/dejavu/"
def F(name, size): return ImageFont.truetype(DEJAVU + name, size)

# ---------------- voiceover ----------------
SCENES = [
    ("s1", "The best events aren't posted. They're whispered."),
    ("s2", "Invite-only dinners. Private roundtables. They never hit your feed."),
    ("s3", "Whispered Events is a free platform where executives share exclusive events, and unlock the ones that fit."),
    ("s4", "Share one event, tell us your interests, and the right invitations find you, quietly."),
    ("s5", "Whispered Events. For executives only."),
]

def tts_wav(name, text):
    mp3 = f"{OUT}/{name}.mp3"; wav = f"{OUT}/{name}.wav"
    gTTS(text, lang="en", tld="co.uk").save(mp3)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", mp3,
                    "-ar", str(SR), "-ac", "1", wav], check=True)
    data = read_wav(wav)
    return data

def speed_up(clip, rate):
    p = subprocess.run([FFMPEG, "-y", "-loglevel", "error",
                        "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-filter:a", f"atempo={rate:.4f}",
                        "-f", "f32le", "-ar", str(SR), "-ac", "1", "-"],
                       input=clip.tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32)

def read_wav(path):
    raw = subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", path,
                          "-f", "f32le", "-ar", str(SR), "-ac", "1", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

print("generating voiceover...")
vo_clips = [tts_wav(n, t) for n, t in SCENES]
vo_durs = [len(c) / SR for c in vo_clips]
print("vo durations:", [round(d, 2) for d in vo_durs], "total", round(sum(vo_durs), 2))

TOTAL = 30.0
LEAD = 0.45  # vo starts this far into each scene
slack = TOTAL - sum(vo_durs) - LEAD * len(SCENES)
if slack < 0:
    # speed VO up uniformly to fit
    rate = sum(vo_durs) / (sum(vo_durs) + slack)
    print(f"vo too long, applying atempo={rate:.3f}")
    vo_clips = [speed_up(c, rate) for c in vo_clips]
    vo_durs = [len(c) / SR for c in vo_clips]
    slack = TOTAL - sum(vo_durs) - LEAD * len(SCENES)
# distribute slack: weight later scenes slightly less, ending scene a bit more
weights = np.array([1.0, 1.0, 1.0, 1.0, 1.4]); weights /= weights.sum()
scene_durs = [vo_durs[i] + LEAD + slack * weights[i] for i in range(len(SCENES))]
# snap to frames
scene_frames = [round(d * FPS) for d in scene_durs]
scene_frames[-1] += int(TOTAL * FPS) - sum(scene_frames)
starts = np.cumsum([0] + scene_frames[:-1])
print("scene frames:", scene_frames, "total", sum(scene_frames))

# ---------------- drawing helpers ----------------
def ease_out(t): return 1 - (1 - min(max(t, 0), 1)) ** 3

def tracked_w(draw, text, font, tracking):
    return sum(draw.textlength(ch, font=font) + tracking for ch in text) - (tracking if text else 0)

def draw_tracked(draw, xy, text, font, fill, tracking=0, anchor_center=None):
    x, y = xy
    if anchor_center:
        x = anchor_center - tracked_w(draw, text, font, tracking) / 2
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking

def mix(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def fade(color, alpha):  # alpha 0..1 against cream bg
    return mix(CREAM, color, alpha)

def base_frame():
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)
    # subtle top/bottom border lines like the site header/footer
    d.line([(0, 6), (W, 6)], fill=CREAM_DARK, width=2)
    d.line([(0, H - 7), (W, H - 7)], fill=CREAM_DARK, width=2)
    return img, d

def appear(d, frame_in_scene, at, dur=12):
    """returns (alpha, y_offset) for slide-up fade starting at frame `at`"""
    t = ease_out((frame_in_scene - at) / dur)
    return t, int((1 - t) * 24)

serif_xl  = F("DejaVuSerif-Bold.ttf", 92)
serif_lg  = F("DejaVuSerif-Bold.ttf", 72)
serif_md  = F("DejaVuSerif.ttf", 54)
sans_md   = F("DejaVuSans.ttf", 44)
sans_sm   = F("DejaVuSans.ttf", 36)
sans_bold = F("DejaVuSans-Bold.ttf", 40)
logo_big  = F("DejaVuSans-Bold.ttf", 110)
logo_sm   = F("DejaVuSans-Bold.ttf", 44)

def draw_logo(d, cy, scale=1.0, alpha=1.0):
    f = F("DejaVuSans-Bold.ttf", int(110 * scale))
    tr1, tr2 = 14 * scale, 52 * scale
    draw_tracked(d, (0, cy - int(130 * scale)), "WHISPERED", f, fade(LOGO_GRAY, alpha), tr1, anchor_center=W // 2)
    draw_tracked(d, (0, cy + int(10 * scale)), "EVENTS", f, fade((184, 134, 11), alpha), tr2, anchor_center=W // 2)

# ---------------- scene renderers ----------------
def scene1(d, f, n):
    a1, y1 = appear(d, f, 4)
    draw_tracked(d, (0, 380 + y1), "The best events aren't posted.", serif_lg, fade(CHARCOAL, a1), 0, anchor_center=W // 2)
    a2, y2 = appear(d, f, 26)
    draw_tracked(d, (0, 520 + y2), "They're whispered.", serif_xl, fade(GOLD, a2), 0, anchor_center=W // 2)
    if a2 > 0:
        w = tracked_w(d, "They're whispered.", serif_xl, 0)
        d.line([(W/2 - w/2, 660), (W/2 - w/2 + w * ease_out((f - 30) / 20), 660)], fill=fade(GOLD, a2), width=4)

def scene2(d, f, n):
    items = ["Invite-only dinners.", "Private roundtables.", "Rooms where real relationships are built."]
    step = max(1, (n - 50) // 3)
    for i, txt in enumerate(items):
        a, y = appear(d, f, 6 + i * step)
        draw_tracked(d, (0, 300 + i * 130 + y), txt, serif_md, fade(CHARCOAL, a), 0, anchor_center=W // 2)
        if a > 0.5:
            d.ellipse([W/2 - 5, 270 + i * 130 + 95, W/2 + 5, 280 + i * 130 + 95], fill=fade(GOLD, a)) if False else None
    a4, y4 = appear(d, f, 6 + 3 * step + 6)
    draw_tracked(d, (0, 740 + y4), "They never hit your feed.", sans_bold, fade(GOLD_DEEP, a4), 1, anchor_center=W // 2)

def scene3(d, f, n):
    a0, _ = appear(d, f, 2)
    draw_logo(d, 260, scale=0.42, alpha=a0)
    a1, y1 = appear(d, f, 14)
    draw_tracked(d, (0, 470 + y1), "A free platform where executives", serif_md, fade(CHARCOAL, a1), 0, anchor_center=W // 2)
    draw_tracked(d, (0, 560 + y1), "share exclusive events —", serif_md, fade(CHARCOAL, a1), 0, anchor_center=W // 2)
    a2, y2 = appear(d, f, 34)
    draw_tracked(d, (0, 680 + y2), "and unlock the ones that fit them.", serif_md, fade(GOLD, a2), 0, anchor_center=W // 2)

def scene4(d, f, n):
    a0, y0 = appear(d, f, 2)
    draw_tracked(d, (0, 200 + y0), "HOW IT WORKS", F("DejaVuSans-Bold.ttf", 34), fade(GRAY, a0), 10, anchor_center=W // 2)
    steps = ["Share one event you know about", "Tell us what you're interested in", "The right invitations find you — quietly"]
    gap = max(1, (n - 30) // 3)
    for i, txt in enumerate(steps):
        a, y = appear(d, f, 14 + i * gap)
        cy = 340 + i * 170
        if a > 0:
            r = 38
            d.ellipse([W/2 - 560 - r, cy + y + 28 - r, W/2 - 560 + r, cy + y + 28 + r],
                      fill=fade((253, 248, 232), a), outline=fade(GOLD, a), width=3)
            d.text((W/2 - 560, cy + y + 28), str(i + 1), font=F("DejaVuSans-Bold.ttf", 42),
                   fill=fade(GOLD_DEEP, a), anchor="mm")
            d.text((W/2 - 480, cy + y + 28), txt, font=sans_md, fill=fade(CHARCOAL, a), anchor="lm")

def scene5(d, f, n):
    a0, _ = appear(d, f, 4, dur=16)
    draw_logo(d, H // 2 - 80, scale=1.0, alpha=a0)
    a1, y1 = appear(d, f, 24)
    draw_tracked(d, (0, H // 2 + 180 + y1), "For executives only.", serif_md, fade(CHARCOAL, a1), 0, anchor_center=W // 2)
    a2, y2 = appear(d, f, 40)
    draw_tracked(d, (0, H // 2 + 290 + y2), "Free to join — share one event to unlock the rest.",
                 sans_sm, fade(GRAY, a2), 0, anchor_center=W // 2)
    # end fade to cream handled globally

RENDER = [scene1, scene2, scene3, scene4, scene5]

# ---------------- render video ----------------
print("rendering frames...")
total_frames = sum(scene_frames)
writer = imageio_ffmpeg.write_frames(
    f"{OUT}/video.mp4", (W, H), fps=FPS, codec="libx264",
    output_params=["-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium"])
writer.send(None)
XFADE = 10  # crossfade-to-cream frames at scene boundaries
for s, nf in enumerate(scene_frames):
    for f in range(nf):
        img, d = base_frame()
        RENDER[s](d, f, nf)
        # fade scene out at its end (to cream), except hold last scene then fade at very end
        if s < len(RENDER) - 1 and f > nf - XFADE:
            img = Image.blend(img, Image.new("RGB", (W, H), CREAM), (f - (nf - XFADE)) / XFADE)
        if s == len(RENDER) - 1 and f > nf - 20:
            img = Image.blend(img, Image.new("RGB", (W, H), CREAM), (f - (nf - 20)) / 20 * 0.9)
        writer.send(np.asarray(img))
writer.close()
print("video rendered")

# ---------------- audio: vo track + ambient pad ----------------
print("building audio...")
N = int(TOTAL * SR)
vo = np.zeros(N, dtype=np.float32)
for i, clip in enumerate(vo_clips):
    off = int((starts[i] / FPS + LEAD) * SR)
    end = min(off + len(clip), N)
    vo[off:end] += clip[: end - off]

t = np.arange(N) / SR
pad = np.zeros(N, dtype=np.float32)
# gentle two-chord pad: Fmaj7 -> Am(add9), 7.5s each, sine + soft octave
chords = [[174.61, 220.0, 261.63, 329.63], [220.0, 261.63, 329.63, 493.88 / 2]]
for ci, chord in enumerate(chords * 2):
    seg = (t >= ci * 7.5) & (t < (ci + 1) * 7.5)
    ts = t[seg] - ci * 7.5
    env = np.minimum(ts / 2.5, 1) * np.minimum((7.5 - ts) / 2.5, 1)
    for fr in chord:
        pad[seg] += 0.035 * env * np.sin(2 * np.pi * fr * t[seg]) \
                  + 0.012 * env * np.sin(2 * np.pi * fr * 2 * t[seg])
# global fade in/out
pad *= np.minimum(t / 2, 1) * np.clip((TOTAL - t) / 2.5, 0, 1)
audio = np.clip(vo * 0.95 + pad, -1, 1)
audio.astype(np.float32).tofile(f"{OUT}/audio.f32")
subprocess.run([FFMPEG, "-y", "-loglevel", "error",
                "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", f"{OUT}/audio.f32",
                "-i", f"{OUT}/video.mp4",
                "-map", "1:v", "-map", "0:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-shortest", f"{OUT}/whispered-events-30s.mp4"], check=True)
print("done:", f"{OUT}/whispered-events-30s.mp4", os.path.getsize(f"{OUT}/whispered-events-30s.mp4"), "bytes")
