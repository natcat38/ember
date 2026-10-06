"""Draw Ember's app icons: the asleep cat (Natalie's pack, ADR 0009) on nook lavender. Chosen 2026-10-06; it replaced a
progress ring that read as a loading spinner.
Run: python scripts/icons.py  (writes the icons below into public/)"""
from PIL import Image

NOOK = "#ECE7F6"
CAT = Image.open("public/cat/asleep-still.webp").convert("RGBA")
CAT = CAT.crop(CAT.getbbox())


def icon(size: int, fill: float) -> Image.Image:
    """The cat centred on nook, its longer side `fill` of the icon's width."""
    s = size * 4  # draw large, then downsample for smooth edges
    img = Image.new("RGBA", (s, s), NOOK)
    k = s * fill / max(CAT.size)
    cat = CAT.resize((round(CAT.width * k), round(CAT.height * k)), Image.LANCZOS)
    img.alpha_composite(cat, ((s - cat.width) // 2, (s - cat.height) // 2))
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


icon(192, 0.84).save("public/icon-192.png")
icon(512, 0.84).save("public/icon-512.png")
# Android crops a maskable icon to a circle or squircle: the cat stays inside the centre 80% safe circle.
icon(512, 0.66).save("public/icon-maskable-512.png")
icon(180, 0.80).save("public/apple-touch-icon.png")  # iOS rounds the corners itself
# Browser tabs: the cat fills nearly the whole square, or at 16 px it is a smudge.
icon(48, 0.96).save("public/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("ok")
