# Whispered Events — 30-second explainer

**Audience:** executives who don't yet use the platform.
**Format:** 1920×1080, 30s, kinetic typography in brand style (cream `#F5EFE6`,
charcoal `#1a1a2e`, gold `#b87214`), with voiceover and soft ambient pad.

## Voiceover script (~75 words)

> The best events aren't posted. They're whispered.
>
> Invite-only dinners. Private roundtables. They never hit your feed.
>
> Whispered Events is a free platform where executives share exclusive
> events — and unlock the ones that fit.
>
> Share one event, tell us your interests, and the right invitations find
> you, quietly.
>
> Whispered Events. For executives only.

## Storyboard

| Time | On screen |
|---|---|
| 0–4s | "The best events aren't posted." / **"They're whispered."** (gold, underline draws in) |
| 4–10s | "Invite-only dinners." / "Private roundtables." / "Rooms where real relationships are built." → "They never hit your feed." |
| 10–18s | Wordmark + "A free platform where executives share exclusive events — and unlock the ones that fit them." |
| 18–26s | HOW IT WORKS — 1. Share one event you know about · 2. Tell us what you're interested in · 3. The right invitations find you — quietly |
| 26–30s | Full WHISPERED EVENTS wordmark, "For executives only.", "Free to join — share one event to unlock the rest." Fade out. |

## Regenerating

`make_video.py` produces the video end-to-end (frames via Pillow, voiceover
via gTTS, ambient pad via numpy, encoding via imageio-ffmpeg):

```bash
pip install pillow imageio-ffmpeg gTTS numpy
python3 make_video.py   # writes whispered-events-30s.mp4
```

The voiceover is synthesized; for a polished cut, record the script above
with a human VO or a premium TTS voice and swap the audio track.
