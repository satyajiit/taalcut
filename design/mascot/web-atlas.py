# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Build Kaatu's high-resolution web atlases for taalcut.app (website/public/kaatu/).

    python3 design/mascot/web-atlas.py [--tile 480] [--check <dir>]

The app's atlases (build.py, 240 px cells) are sharp to about 120 px on screen. The site shows Kaatu up to 240 px on
a 2x screen, so it needs 480 px cells. This is build.py's method, unchanged, at a bigger tile and over eight sheets:
the six drawn for the app plus the two drawn for the site (web-creator, web-story). Every frame of every sheet is
registered on the centre cell of `directions`: scaled so the collar's teal and violet end segments span the same
width (the web sheets: so the cream tummy oval is the same width, since their props share the collar's colours),
slid so the seat lands on the reference seat, then nudged to where the lower body overlaps best. So the player
can cut between any two frames of any two sheets without the body moving.

Writes only website/public/kaatu/kaatu-<sheet>.webp (3x3 cells, WebP). The source drawing's cell is about 570 px, so
480 px cells are a downscale: nothing is ever upscaled. Provenance (the sheet's prompt) is embedded afterwards by
website/scripts/kaatu-atlas.mjs, which runs this. Needs Pillow, NumPy and SciPy.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import BOTTOM_AT, HEIGHT, SCALE_SPREAD, SETTLE, body, cells, collar, lower, place, seat  # noqa: E402

OUT = os.path.join(HERE, '..', '..', 'website', 'public', 'kaatu')
# In the order of website/src/components/kaatu/kaatu-frames.ts › SHEETS.
SHEETS = ['directions', 'blinks', 'glances', 'reactions', 'antics', 'tricks', 'web-creator', 'web-story']
QUALITY = 80
# The web sheets hold props in the collar's own colours (teal scissors, a violet screen), so their collar reads are
# unreliable. They are scaled by the cream tummy oval's width instead, which every pose shows and no arm changes.
BY_TUMMY = {'web-creator', 'web-story'}
CREAM = (0xF6, 0xEB, 0xDD)
TUMMY_SPREAD = 0.12   # a tummy narrower or wider than this, against the reference, is covered by a prop


HAZE = 40             # alpha under this, more than EDGE px from the drawing, is haze the image model left
EDGE = 3


def dehaze(cell):
    """The cell without the faint haze that clings to the drawing (clean() keeps it, since it touches the body)."""
    alpha = cell[..., 3]
    near = ndimage.binary_dilation(alpha > 128, iterations=EDGE)
    out = cell.copy()
    out[(alpha < HAZE) & ~near] = 0
    return out


def tummy(cell, mask):
    """The width of the cream tummy oval (the largest cream patch on the body), or None."""
    near = mask & (np.abs(cell[..., :3].astype(int) - CREAM).sum(axis=2) < 40)
    labels, n = ndimage.label(near)
    if not n:
        return None
    k = int(np.argmax(ndimage.sum(near, labels, range(1, n + 1)))) + 1
    xs = np.where(labels == k)[1]
    return float(xs.max() - xs.min())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default=os.path.join(HERE, 'source'))
    parser.add_argument('--out', default=OUT)
    parser.add_argument('--tile', type=int, default=480)
    parser.add_argument('--check', help='also write an onion-skin sheet per atlas here')
    parser.add_argument('--only', nargs='*', help='build only these sheets (directions is always read)')
    args = parser.parse_args()
    tile = args.tile

    names = [n for n in SHEETS if not args.only or n in args.only]
    sheets = {}
    for name in {'directions', *names}:
        w, group = cells(os.path.join(args.source, f'{name}.png'))
        sheets[name] = (w, [dehaze(c) for c in group])

    w0, directions = sheets['directions']
    ref = directions[4]
    ref_mask = body(ref)
    ref_collar = collar(ref, ref_mask)
    assert ref_collar, 'the reference frame must show its collar'
    ref_span = np.hypot(ref_collar[1][0] - ref_collar[0][0], ref_collar[1][1] - ref_collar[0][1])
    ref_tummy = tummy(ref, ref_mask)
    ref_bottom, ref_x = seat(ref_mask)
    ys, _ = np.where(ref_mask)
    depth = int((ref_bottom - ys.min()) * 0.32)
    ref_lower = lower(ref_mask, ref_bottom, depth)

    pad = w0 // 2
    size = w0 + 2 * pad
    ref_lower = np.pad(ref_lower, pad)
    side = (ref_bottom - ys.min()) / HEIGHT
    top = pad + ref_bottom - BOTTOM_AT * side
    left = pad + ref_x - 0.5 * side
    crop = (round(left), round(top), round(left + side), round(top + side))
    if tile > side:
        sys.exit(f'a {tile} px tile would upscale the {side:.0f} px source cell; use --tile {int(side)} or less')

    os.makedirs(args.out, exist_ok=True)
    for name in names:
        w, group = sheets[name]
        if name in BY_TUMMY:
            widths = [tummy(c, body(c)) for c in group]
            found = [t if t and abs(t / ref_tummy - 1) <= TUMMY_SPREAD else None for t in widths]
            fits = [ref_tummy / t for t in found if t]
            median = float(np.median(fits)) if fits else w0 / w
        else:
            found = [collar(c, body(c)) for c in group]
            spans = [np.hypot(f[1][0] - f[0][0], f[1][1] - f[0][1]) for f in found if f]
            median = ref_span / float(np.median(spans)) if spans else w0 / w
        atlas = Image.new('RGBA', (tile * 3, tile * 3), (0, 0, 0, 0))
        onion = Image.new('RGBA', (tile * 3, tile * 3), (255, 255, 255, 255))
        report = []
        for i, (cell, ring) in enumerate(zip(group, found)):
            scale = median
            if ring:
                own = ref_tummy / ring if name in BY_TUMMY else ref_span / np.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1])
                if abs(own / median - 1) <= SCALE_SPREAD:
                    scale = own
            bottom, x = seat(body(cell))
            dx, dy = pad + ref_x - x * scale, pad + ref_bottom - bottom * scale
            framed = place(cell, scale, dx, dy, size)
            mask = body(framed)
            band = lower(mask, seat(mask)[0], depth)
            best = (-1.0, 0, 0)
            for sy in range(-SETTLE, SETTLE + 1, 2):
                for sx in range(-SETTLE, SETTLE + 1, 2):
                    moved = np.roll(np.roll(band, sy, axis=0), sx, axis=1)
                    score = (moved & ref_lower).sum() / max((moved | ref_lower).sum(), 1)
                    best = max(best, (score, sx, sy))
            score, sx, sy = best
            framed = place(cell, scale, dx + sx, dy + sy, size)
            out = Image.fromarray(framed, 'RGBA').crop(crop)
            edge = np.array(out)
            clipped = edge[[0, -1], :, 3].max() > 60 or edge[:, [0, -1], 3].max() > 60
            frame = out.resize((tile, tile), Image.LANCZOS)
            atlas.paste(frame, ((i % 3) * tile, (i // 3) * tile))
            cue = 'tummy' if name in BY_TUMMY else 'collar'
            report.append(f'{i}:{scale / median:.3f}/{score * 100:.0f}%{"/CLIPPED" if clipped else ""}{"" if ring else "/no-" + cue}')
            if args.check:
                ghost = Image.fromarray(np.pad(ref, ((pad, pad), (pad, pad), (0, 0))), 'RGBA').crop(crop).resize((tile, tile))
                g = np.array(ghost)
                g[..., :3] = (230, 40, 40)
                g[..., 3] = (g[..., 3] * 0.45).astype(np.uint8)
                view = Image.new('RGBA', (tile, tile), (255, 255, 255, 255))
                view.alpha_composite(frame)
                view.alpha_composite(Image.fromarray(g, 'RGBA'))
                onion.paste(view, ((i % 3) * tile, (i // 3) * tile))
        dest = os.path.join(args.out, f'kaatu-{name}.webp')
        atlas.save(dest, quality=QUALITY, method=6)
        print(f'{name:<11} {os.path.getsize(dest) // 1024:>4} KB  scale {median:.3f}  ' + ' '.join(report))
        if args.check:
            os.makedirs(args.check, exist_ok=True)
            onion.convert('RGB').resize((tile * 3 // 2, tile * 3 // 2)).save(os.path.join(args.check, f'{name}-onion.png'))


if __name__ == '__main__':
    main()
