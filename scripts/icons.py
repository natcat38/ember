"""Draw Ember's placeholder app icons from the design tokens: the progress ring on oat.
Run: python scripts/icons.py  (writes public/icon-192.png, icon-512.png, apple-touch-icon.png)
Placeholder until a designed mark exists; the ring is Ember's own progress element (Design_Direction.md §4)."""
from PIL import Image, ImageDraw

OAT, NOOK, LAVENDER = "#F6F3EE", "#ECE7F6", "#8C7BC4"


def icon(size: int, path: str) -> None:
    scale = 4  # draw large, then downsample for smooth edges
    s = size * scale
    img = Image.new("RGB", (s, s), OAT)
    d = ImageDraw.Draw(img)
    # Keep the mark inside the maskable safe zone (centre 80%).
    pad, width = s * 0.24, int(s * 0.1)
    box = [pad, pad, s - pad, s - pad]
    d.ellipse(box, outline=NOOK, width=width)
    d.arc(box, start=-90, end=150, fill=LAVENDER, width=width)  # two-thirds round, like "3 of 5"
    img.resize((size, size), Image.LANCZOS).save(path)


for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    icon(size, f"public/{name}")
print("ok")
