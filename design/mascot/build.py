# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Build Kaatu's atlases from the drawn 3x3 sheets.

    python3 design/mascot/build.py [--source design/mascot/source] [--check <dir>]

Every sheet is lined up on the centre cell of the directions sheet, so the player
can cut between any two frames of any two sheets without the body moving. Each
frame is registered on its own: scaled so the collar (the teal and violet end
segments, which every frame shows) spans the same width, then slid so the seat
(the bottom of the body, which never changes) lands on the reference seat. A
last search slides it a few pixels to make the lower body overlap best.

The idea is page-mascot's build (MIT, nilbuild/page-mascot: align each frame on
the part that does not change, then fit the sheets to one another), redone for
any number of sheets and for frames whose arms and head move.

Out: packages/ui/src/brand/kaatu-<sheet>.webp, 3x3 cells of 240 px, WebP q78,
the drawing at the same size and place as the 2026-10-13 atlases (bottom at 74.6%
of the cell, 59.6% of it tall) so the component's optical inset still holds.
With --check, also writes an onion-skin sheet per atlas (each frame over the
reference in red) for a look by eye. Needs Pillow, NumPy and SciPy.
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.join(HERE, '..', '..', 'packages', 'ui', 'src', 'brand')
SHEETS = ['directions', 'blinks', 'glances', 'reactions', 'antics', 'tricks']

TILE = 240
QUALITY = 78
GHOST = 96            # a patch whose alpha never passes this is noise the image model left
TEAL = (0x3C, 0xC2, 0xB4)
VIOLET = (0x9E, 0x8C, 0xF4)
COLLAR_TOLERANCE = 46
SCALE_SPREAD = 0.06   # a frame's own collar scale is trusted this far from its sheet's median
SETTLE = 10           # how far, in source pixels, the overlap search may slide a frame
BOTTOM_AT = 0.746     # where the seat sits down the output cell
HEIGHT = 0.596        # how much of the cell the reference drawing fills, top to seat


def cells(path):
    sheet = np.array(Image.open(path).convert('RGBA'))
    w = sheet.shape[0] // 3
    return w, [clean(sheet, r, c, w) for r in range(3) for c in range(3)]


def clean(sheet, row, col, w):
    """One cell, without near-invisible specks or what bleeds in from a neighbour.

    A shape on the cell's edge is bleed only when it carries on across the edge into
    the next cell: a music note drawn right up to the line is the cell's own.
    """
    cell = sheet[row * w:(row + 1) * w, col * w:(col + 1) * w].copy()
    labels, n = ndimage.label(cell[..., 3] > 0, structure=np.ones((3, 3), int))
    if n:
        peaks = ndimage.maximum(cell[..., 3], labels, range(1, n + 1))
        cell[np.isin(labels, [k + 1 for k, p in enumerate(peaks) if p < GHOST])] = 0
    opaque = cell[..., 3] > 40
    labels, n = ndimage.label(opaque)
    if not n:
        return cell
    keep = int(np.argmax(ndimage.sum(opaque, labels, range(1, n + 1)))) + 1
    beyond = sheet[..., 3] > 40
    y0, x0 = row * w, col * w
    edges = [  # this cell's edge pixels, and the pixels just across that edge
        (labels[0], beyond[y0 - 1, x0:x0 + w] if row else None),
        (labels[-1], beyond[y0 + w, x0:x0 + w] if row < 2 else None),
        (labels[:, 0], beyond[y0:y0 + w, x0 - 1] if col else None),
        (labels[:, -1], beyond[y0:y0 + w, x0 + w] if col < 2 else None),
    ]
    bleed = set()
    for edge, across in edges:
        for k in set(edge.tolist()) - {0, keep}:
            if across is None or (across & (edge == k)).any():
                bleed.add(k)
    cell[np.isin(labels, list(bleed))] = 0
    return cell


def body(cell):
    """The character itself, its largest blob: floating hearts, notes and zzz are left out."""
    opaque = cell[..., 3] > 100
    labels, n = ndimage.label(opaque)
    if not n:
        return opaque
    return labels == int(np.argmax(ndimage.sum(opaque, labels, range(1, n + 1)))) + 1


def collar(cell, mask):
    """Centroids of the collar's teal and violet end segments, or None where something covers one."""
    rgb = cell[..., :3].astype(int)
    found = []
    for colour in (TEAL, VIOLET):
        near = mask & (np.abs(rgb - colour).sum(axis=2) < COLLAR_TOLERANCE)
        labels, n = ndimage.label(near)
        if not n:
            return None
        sizes = ndimage.sum(near, labels, range(1, n + 1))
        k = int(np.argmax(sizes)) + 1
        if sizes[k - 1] < 40:
            return None
        ys, xs = np.where(labels == k)
        found.append((xs.mean(), ys.mean()))
    return found


def seat(mask):
    """The bottom row of the body and the centre of its lowest band."""
    ys, xs = np.where(mask)
    bottom = ys.max()
    band = ys >= bottom - (ys.max() - ys.min()) * 0.06
    return bottom, xs[band].mean()


def lower(mask, bottom, depth):
    """The lower body (seat and tummy), the part that is the same in every frame."""
    band = np.zeros_like(mask)
    band[max(0, bottom - depth):bottom + 1] = mask[max(0, bottom - depth):bottom + 1]
    return band


def place(cell, scale, dx, dy, size):
    """The cell scaled about its origin and moved by (dx, dy), on a canvas of the given size."""
    h, w = cell.shape[:2]
    image = Image.fromarray(cell, 'RGBA').resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(image, (round(dx), round(dy)))
    return np.array(canvas)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default=os.path.join(HERE, 'source'))
    parser.add_argument('--check', help='write onion-skin sheets here')
    args = parser.parse_args()

    sheets = {}
    for name in SHEETS:
        w, group = cells(os.path.join(args.source, f'{name}.png'))
        sheets[name] = (w, group)

    w0, directions = sheets['directions']
    ref = directions[4]
    ref_mask = body(ref)
    ref_collar = collar(ref, ref_mask)
    assert ref_collar, 'the reference frame must show its collar'
    ref_span = np.hypot(ref_collar[1][0] - ref_collar[0][0], ref_collar[1][1] - ref_collar[0][1])
    ref_bottom, ref_x = seat(ref_mask)
    ys, _ = np.where(ref_mask)
    depth = int((ref_bottom - ys.min()) * 0.32)
    ref_lower = lower(ref_mask, ref_bottom, depth)

    # The working canvas: the reference cell with room around it for frames that reach further.
    pad = w0 // 2
    size = w0 + 2 * pad
    ref_lower = np.pad(ref_lower, pad)
    side = (ref_bottom - ys.min()) / HEIGHT
    top = pad + ref_bottom - BOTTOM_AT * side
    left = pad + ref_x - 0.5 * side
    crop = (round(left), round(top), round(left + side), round(top + side))

    for name in SHEETS:
        w, group = sheets[name]
        found = [collar(c, body(c)) for c in group]
        spans = [np.hypot(f[1][0] - f[0][0], f[1][1] - f[0][1]) for f in found if f]
        median = ref_span / float(np.median(spans)) if spans else w0 / w
        atlas = Image.new('RGBA', (TILE * 3, TILE * 3), (0, 0, 0, 0))
        onion = Image.new('RGBA', (TILE * 3, TILE * 3), (255, 255, 255, 255))
        report = []
        for i, (cell, ring) in enumerate(zip(group, found)):
            scale = median
            if ring:
                own = ref_span / np.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1])
                if abs(own / median - 1) <= SCALE_SPREAD:
                    scale = own
            bottom, x = seat(body(cell))
            dx, dy = pad + ref_x - x * scale, pad + ref_bottom - bottom * scale
            framed = place(cell, scale, dx, dy, size)
            # Slide it the last few pixels to where the lower body overlaps the reference best.
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
            clipped = out.size != (0, 0) and (np.array(out)[[0, -1], :, 3].max() > 60 or np.array(out)[:, [0, -1], 3].max() > 60)
            tile = out.resize((TILE, TILE), Image.LANCZOS)
            atlas.paste(tile, ((i % 3) * TILE, (i // 3) * TILE))
            report.append(f'{i}:{scale / median:.3f}/{score * 100:.0f}%{"/CLIPPED" if clipped else ""}{"" if ring else "/no-collar"}')
            if args.check:
                ghost = Image.fromarray(np.pad(ref, ((pad, pad), (pad, pad), (0, 0))), 'RGBA').crop(crop).resize((TILE, TILE))
                g = np.array(ghost)
                g[..., :3] = (230, 40, 40)
                g[..., 3] = (g[..., 3] * 0.45).astype(np.uint8)
                cellview = Image.new('RGBA', (TILE, TILE), (255, 255, 255, 255))
                cellview.alpha_composite(tile)
                cellview.alpha_composite(Image.fromarray(g, 'RGBA'))
                onion.paste(cellview, ((i % 3) * TILE, (i // 3) * TILE))
        dest = os.path.join(BRAND, f'kaatu-{name}.webp')
        atlas.save(dest, quality=QUALITY, method=6)
        print(f'{name:<10} {os.path.getsize(dest) // 1024:>3} KB  scale {median:.3f}  ' + ' '.join(report))
        if args.check:
            os.makedirs(args.check, exist_ok=True)
            onion.convert('RGB').save(os.path.join(args.check, f'{name}-onion.png'))


if __name__ == '__main__':
    main()
