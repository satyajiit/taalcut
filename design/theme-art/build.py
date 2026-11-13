# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Builds the theme scene's WebP art from the drawn PNGs.

    python3 design/theme-art/build.py

Reads design/theme-art/source/{sun,moon,stars}.png and writes
packages/ui/src/theme/art/: sun.webp and moon.webp (256 px square), star-1..3.webp
(96 px, three quarters of the stars sheet; the fourth, a small one, is spare). Needs Pillow with WebP support.
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / 'packages' / 'ui' / 'src' / 'theme' / 'art'


def clean(im: Image.Image) -> Image.Image:
    """Near-opaque alpha to opaque, faint specks to clear."""
    r, g, b, a = im.split()
    a = a.point(lambda v: 255 if v >= 248 else (0 if v <= 6 else v))
    return Image.merge('RGBA', (r, g, b, a))


def trim(im: Image.Image, pad: float = 0.03) -> Image.Image:
    """Crops to what is drawn and centres it on a square with a small margin."""
    box = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    im = im.crop(box)
    side = max(im.size)
    p = round(side * pad)
    canvas = Image.new('RGBA', (side + 2 * p, side + 2 * p), (0, 0, 0, 0))
    canvas.paste(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2))
    return canvas


def save(im: Image.Image, name: str, width: int) -> None:
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    path = OUT / f'{name}.webp'
    im.save(path, 'WEBP', quality=88, method=6, alpha_quality=90)
    print(f'{path.name}: {im.size[0]}x{im.size[1]}, {path.stat().st_size / 1024:.1f} KB')


def load(name: str) -> Image.Image:
    return clean(Image.open(HERE / 'source' / f'{name}.png').convert('RGBA'))


OUT.mkdir(parents=True, exist_ok=True)
save(trim(load('sun')), 'sun', 256)
save(trim(load('moon')), 'moon', 256)
stars = load('stars')
w, h = stars.size
for i, (x, y) in enumerate([(0, 0), (1, 0), (0, 1)], start=1):
    quarter = stars.crop((x * w // 2, y * h // 2, (x + 1) * w // 2, (y + 1) * h // 2))
    save(trim(quarter, 0.06), f'star-{i}', 96)
