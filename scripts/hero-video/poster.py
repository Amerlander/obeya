"""The site's poster for the hero video: its first frame, slightly dimmed. The play button over it
is a real button in site/index.html, not part of the picture. Given a third path, also the
README's picture of the video: the same frame, smaller, with the site's play button drawn on it,
since GitHub plays no video from a link and the picture links to the video on obeya.si.

    uv run --with pillow python scripts/hero-video/poster.py ~/demos/obeya-hero/demo.mp4 site/img/hero-poster.jpg [docs/images/video.jpg]
"""

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

video, out = sys.argv[1], sys.argv[2]
readme = sys.argv[3] if len(sys.argv) > 3 else None
with tempfile.TemporaryDirectory() as tmp:
    frame = Path(tmp) / "frame.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "0.6", "-i", video, "-frames:v", "1", str(frame)], check=True)
    im = Image.open(frame).convert("RGBA")
dim = Image.new("RGBA", im.size, (28, 27, 25, 18))
poster = Image.alpha_composite(im, dim)
poster.convert("RGB").save(out, quality=82, optimize=True, progressive=True)


def play_button(size: int) -> Image.Image:
    """The site's play button (its SVG in site/index.html, a 148 box), drawn four times larger and
    scaled down for smooth edges."""
    s = size * 4 / 148
    big = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    draw.ellipse((0, 0, 148 * s, 148 * s), fill=(255, 255, 255, round(0.38 * 255)))
    draw.ellipse((14 * s, 14 * s, 134 * s, 134 * s), fill=(31, 27, 20, round(0.84 * 255)))
    draw.polygon([(60.5 * s, 48 * s), (60.5 * s, 100 * s), (107.3 * s, 74 * s)], fill=(255, 255, 255, 255))
    return big.resize((size, size), Image.LANCZOS)


if readme:
    # GitHub shows a README at most about 900 px wide; twice that is sharp on a retina screen
    width = min(poster.width, 1280)
    small = poster.resize((width, round(poster.height * width / poster.width)), Image.LANCZOS)
    button = play_button(round(width * 0.103))  # as wide as on the site (10.3 % of the video)
    small.alpha_composite(button, ((small.width - button.width) // 2, (small.height - button.height) // 2))
    small.convert("RGB").save(readme, quality=82, optimize=True, progressive=True)
