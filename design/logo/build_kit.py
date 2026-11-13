#!/usr/bin/env python3
"""Builds the Taalcut logo kit: concept A (Avartan), final geometry, every colour version and lockup.

  python3 design/logo/build_kit.py        # writes design/logo/kit/svg/*.svg and kit/app-icon/*.svg
  python3 design/logo/export_kit.py       # then renders PNGs, app icons, web icons and guide figures

It also writes design/logo/motion/mark-geometry.js, the same shapes for the motion component.

Masters are clean SVG: no live text, no transforms, no strokes, one path per colour, letters merged
into single outlines (counters as real holes), so there are no seams between parts.
"""
import math
import os

from build_concepts import arc_band, n

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.join(HERE, 'kit')
SVG_DIR = os.path.join(KIT, 'svg')
ICON_DIR = os.path.join(KIT, 'app-icon')

# Brand colours: the DESIGN.md tokens the logo uses.
C = {
    'marigold': '#FAAB3F',   # --color-marigold (dark theme fill)
    'rose': '#F26A90',       # --color-rose (dark)
    'violet': '#9E8CF4',     # --color-violet (dark)
    'teal': '#3CC2B4',       # --color-teal (dark)
    'marigold-strong': '#A94E00',  # --color-*-strong (light): accents that hold 5:1 on paper
    'rose-strong': '#B02B57',
    'violet-strong': '#6347B8',
    'teal-strong': '#056965',
    'ink': '#1E1712',        # --color-ink (light)
    'charcoal': '#15110D',   # --color-canvas (dark): app icon tile, dark backgrounds
    'cream': '#F0ECE7',      # --color-ink (dark): reversed wordmark and arcs
    'black': '#000000',
    'white': '#FFFFFF',
}

# ---------- the symbol: one rhythm cycle, four beats ----------
# Jhaptaal's 2+3+2+3 as 75°/105° arcs (cuts on clean 15° angles), starting at the top (sam).
# Weights follow the accents: sam heaviest, the two claps medium, khali (the empty beat) lightest.
SPANS = (75, 105, 75, 105)
GEOM = {
    'standard': {'weights': (60, 38, 20, 38), 'gap': 18},
    'reversed': {'weights': (58, 36, 19, 36), 'gap': 19},        # light on dark: thinned for irradiation
    'small': {'weights': (66, 46, 32, 46), 'gap': 28},           # 32 px and below
    'small-reversed': {'weights': (64, 44, 31, 44), 'gap': 29},
}


def arcs(cx, cy, diameter, geom):
    """The four arc outlines (path data), on a design grid where the ring is 224 units across."""
    k = diameter / 224
    R = diameter / 2
    g = GEOM[geom]
    out, a = [], -90
    for span, w in zip(SPANS, g['weights']):
        out.append(arc_band(cx, cy, R, R - w * k, a, a + span, g['gap'] * k))
        a += span
    return out


def paint(d_by_colour):
    """One <path> per colour, merging every shape that shares it."""
    order, groups = [], {}
    for colour, d in d_by_colour:
        if colour not in groups:
            order.append(colour)
            groups[colour] = []
        groups[colour].append(d)
    return '\n'.join(f'  <path fill="{c}" fill-rule="evenodd" d="{"".join(groups[c])}"/>' for c in order)


# ---------- the wordmark: geometric lowercase built for this name, each letter one outline ----------
X, W, HW, O = 120, 26, 23, 3          # x-height, stem, thinned horizontal, overshoot
ASC_L, ASC_T = 176, 150


def P(x, y):
    return f'{n(x)} {n(y)}'


def letter_t(x, yb, s):
    xs = x + 22 * s
    w, top, bar_t, bar_b, right = W * s, yb - ASC_T * s, yb - X * s, yb - (X - HW) * s, x + 74 * s
    pts = [(xs, top), (xs + w, top), (xs + w, bar_t), (right, bar_t), (right, bar_b), (xs + w, bar_b),
           (xs + w, yb), (xs, yb), (xs, bar_b), (x, bar_b), (x, bar_t), (xs, bar_t)]
    return 'M' + 'L'.join(P(*p) for p in pts) + 'Z', 74 * s


def letter_a(x, yb, s):
    R, w = (X / 2 + O) * s, W * s
    cx, cy = x + R, yb - X / 2 * s
    xl, xr, top = x + 2 * R - w, x + 2 * R, yb - X * s
    dy = math.sqrt(R * R - (R - w) ** 2)       # where the bowl meets the stem's inner edge
    outer = (f'M{P(xl, top)}L{P(xr, top)}L{P(xr, yb)}L{P(xl, yb)}L{P(xl, cy + dy)}'
             f'A{n(R)} {n(R)} 0 1 1 {P(xl, cy - dy)}Z')
    r = R - w
    hole = f'M{P(cx + r, cy)}A{n(r)} {n(r)} 0 1 0 {P(cx - r, cy)}A{n(r)} {n(r)} 0 1 0 {P(cx + r, cy)}Z'
    return outer + hole, 2 * R


def letter_l(x, yb, s):
    w = W * s
    return f'M{P(x, yb - ASC_L * s)}L{P(x + w, yb - ASC_L * s)}L{P(x + w, yb)}L{P(x, yb)}Z', w


def letter_c(x, yb, s):
    R, w = (X / 2 + O) * s, W * s
    return arc_band(x + R, yb - X / 2 * s, R, R - w, 45, 315), 2 * R


def letter_u(x, yb, s):
    R, w = X / 2 * s, W * s
    cx, cy = x + R, yb - (X / 2 - O) * s
    top, r = yb - X * s, R - w
    xr_in, xr = x + 2 * R - w, x + 2 * R
    qy = cy + math.sqrt(R * R - (xr_in - cx) ** 2)   # outer bowl meets the right stem's inner edge
    d = (f'M{P(x, top)}L{P(x + w, top)}L{P(x + w, cy)}'
         f'A{n(r)} {n(r)} 0 0 0 {P(cx, cy + r)}A{n(r)} {n(r)} 0 0 0 {P(xr_in, cy)}'
         f'L{P(xr_in, top)}L{P(xr, top)}L{P(xr, yb)}L{P(xr_in, yb)}L{P(xr_in, qy)}'
         f'A{n(R)} {n(R)} 0 0 1 {P(x, cy)}Z')
    return d, 2 * R


SEQUENCE = [(letter_t, 14), (letter_a, 20), (letter_a, 22), (letter_l, 22), (letter_c, 12), (letter_u, 16), (letter_t, 0)]


def wordmark(x, yb, s):
    parts = []
    for fn, space in SEQUENCE:
        d, w = fn(x, yb, s)
        parts.append(d)
        x += w + space * s
    return ''.join(parts), x


def wordmark_width(s):
    return wordmark(0, 0, s)[1]


# ---------- colour schemes ----------
SCHEMES = {
    # name: (arc colours sam→clap→khali→clap, wordmark colour, geometry, small geometry, meant for)
    'four-colour-dark': ((C['marigold'], C['rose'], C['violet'], C['teal']), C['cream'], 'reversed', 'small-reversed', 'dark'),
    'four-colour-light': ((C['marigold-strong'], C['rose-strong'], C['violet-strong'], C['teal-strong']), C['ink'],
                          'standard', 'small', 'light'),
    'two-colour-light': ((C['marigold-strong'], C['ink'], C['ink'], C['ink']), C['ink'], 'standard', 'small', 'light'),
    'two-colour-dark': ((C['marigold'], C['cream'], C['cream'], C['cream']), C['cream'], 'reversed', 'small-reversed', 'dark'),
    'black': ((C['black'],) * 4, C['black'], 'standard', 'small', 'light'),
    'white': ((C['white'],) * 4, C['white'], 'reversed', 'small-reversed', 'dark'),
    'marigold': ((C['marigold'],) * 4, C['marigold'], 'reversed', 'small-reversed', 'dark'),
}


def doc(w, h, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(w)} {n(h)}" width="{n(w)}" height="{n(h)}" '
            f'role="img" aria-labelledby="title">\n  <title id="title">{title}</title>\n{body}\n</svg>\n')


def symbol_svg(scheme, small=False):
    cols, _, geom, sgeom, _ = SCHEMES[scheme]
    ds = arcs(128, 128, 224, sgeom if small else geom)
    return doc(256, 256, 'Taalcut', paint(zip(cols, ds)))


# Lockup proportions, all relative to the symbol's diameter D (locked; never adjust by eye per use).
LOCK = {'xheight': 0.40, 'gap': 0.30, 'stack_gap': 0.20, 'stack_width': 1.60}
PAD = 16


def horizontal_body(scheme, x, cy, D=224, small=False):
    """The horizontal lockup with its symbol's left edge at x and centre at cy. Returns (paths, width)."""
    cols, wcol, geom, sgeom, _ = SCHEMES[scheme]
    s = LOCK['xheight'] * D / X
    wd, xend = wordmark(x + D + LOCK['gap'] * D, cy + X * s / 2, s)
    body = paint(list(zip(cols, arcs(x + D / 2, cy, D, sgeom if small else geom))) + [(wcol, wd)])
    return body, xend - x


def horizontal_svg(scheme, small=False):
    _, w = horizontal_body(scheme, 0, 128, small=small)
    width = math.ceil(w + 2 * PAD)                     # whole-unit canvas, content centred in it
    body, _ = horizontal_body(scheme, (width - w) / 2, 128, small=small)
    return doc(width, 256, 'Taalcut', body)


def stacked_svg(scheme):
    cols, wcol, geom, _, _ = SCHEMES[scheme]
    D = 224
    s = LOCK['stack_width'] * D / wordmark_width(1)
    ww = wordmark_width(s)
    width = math.ceil(max(D, ww) + 2 * PAD)
    yb = PAD + D + LOCK['stack_gap'] * D + ASC_L * s   # baseline: symbol, gap, then the l's full height
    height = math.ceil(yb + O * s + PAD)
    top = (height - (yb + O * s + PAD)) / 2            # centre the content in the whole-unit canvas
    wd, _ = wordmark((width - ww) / 2, yb + top, s)
    body = paint(list(zip(cols, arcs(width / 2, PAD + D / 2 + top, D, geom))) + [(wcol, wd)])
    return doc(width, height, 'Taalcut', body)


def wordmark_svg(colour):
    s = 1.0
    ww = wordmark_width(s)
    wd, _ = wordmark(PAD, PAD + ASC_L, s)
    return doc(ww + 2 * PAD, ASC_L + 2 * PAD + O, 'Taalcut', paint([(colour, wd)]))


# ---------- app icons ----------
# Every tile carries the four-colour ring on the dark canvas; the small drawing is used at 48 px and below.

def macos_icon_svg(small=False):
    """Apple's 1024 grid: an 824-unit tile with ~185 corner radius, 100 units of margin for the shadow."""
    cols, _, geom, sgeom, _ = SCHEMES['four-colour-dark']
    tile = f'  <rect x="100" y="100" width="824" height="824" rx="185" fill="{C["charcoal"]}"/>'
    ring = paint(zip(cols, arcs(512, 512, 520, sgeom if small else geom)))
    return doc(1024, 1024, 'Taalcut', tile + '\n' + ring)


def tile_svg(small=False):
    """Rounded tile filling the canvas: Windows, Linux, PWA 'any' icons and the PNG/ICO favicon."""
    cols, _, geom, sgeom, _ = SCHEMES['four-colour-dark']
    tile = f'  <rect x="0" y="0" width="256" height="256" rx="56" fill="{C["charcoal"]}"/>'
    return doc(256, 256, 'Taalcut', tile + '\n' + paint(zip(cols, arcs(128, 128, 184, sgeom if small else geom))))


def full_bleed_svg(scale=0.6):
    """Square, no corner radius: the platform masks it (apple-touch-icon, maskable PWA icon, avatars).
    The ring stays inside the maskable safe zone (a centred circle 80 % of the canvas wide)."""
    cols, _, geom, _, _ = SCHEMES['four-colour-dark']
    bg = f'  <rect x="0" y="0" width="256" height="256" fill="{C["charcoal"]}"/>'
    return doc(256, 256, 'Taalcut', bg + '\n' + paint(zip(cols, arcs(128, 128, 256 * scale, geom))))


def favicon_svg():
    """Adaptive SVG favicon: two-colour on light browser chrome, four-colour on dark."""
    light = SCHEMES['two-colour-light'][0]
    dark = SCHEMES['four-colour-dark'][0]
    ds = arcs(128, 128, 248, 'small')
    css = ''.join(f'.b{i}{{fill:{c}}}' for i, c in enumerate(light))
    css += '@media (prefers-color-scheme:dark){' + ''.join(f'.b{i}{{fill:{c}}}' for i, c in enumerate(dark)) + '}'
    body = f'  <style>{css}</style>\n' + '\n'.join(f'  <path class="b{i}" d="{d}"/>' for i, d in enumerate(ds))
    return doc(256, 256, 'Taalcut', body)


# ---------- geometry for the motion component ----------

def motion_geometry_js():
    """Every arc drawing as path data, so design/logo/motion animates exactly the kit's shapes."""
    import json
    sym = {g: arcs(128, 128, 224, g) for g in GEOM}
    _, w = horizontal_body('two-colour-light', 0, 128)
    width = math.ceil(w + 2 * PAD)
    x = (width - w) / 2
    D = 224
    s = LOCK['xheight'] * D / X
    word, _ = wordmark(x + D + LOCK['gap'] * D, 128 + X * s / 2, s)
    lock = {g: arcs(x + D / 2, 128, D, g) for g in GEOM}
    bisectors, a = [], -90
    for span in SPANS:
        bisectors.append(a + span / 2)
        a += span
    js = lambda v: json.dumps(v, indent=2)
    return f"""// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// GENERATED by design/logo/build_kit.py from the logo's construction. Do not edit by hand.
// Arcs run clockwise from the top: beat one (sam), clap, the empty beat (khali), clap.

/** Spans of the four arcs in degrees (jhaptaal's 2+3+2+3, snapped to 15° cuts). */
export const SPANS = {js(list(SPANS))};

/** Centre line of each arc in degrees, 0 = right, clockwise (SVG). Hits push along these. */
export const BISECTORS = {js(bisectors)};

/** Ring diameter in canvas units. Motion amplitudes are given on this 224-unit grid. */
export const RING = 224;

/** Symbol alone on a 256 × 256 canvas. */
export const SYMBOL = {{
  width: 256,
  height: 256,
  cx: 128,
  cy: 128,
  arcs: {js(sym)},
}};

/** Horizontal lockup: the same ring plus the wordmark (one path, counters as holes). */
export const LOCKUP = {{
  width: {width},
  height: 256,
  cx: {n(x + D / 2)},
  cy: 128,
  arcs: {js(lock)},
  wordmark: {js(word)},
}};
"""


def write(folder, name, content):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), 'w') as fh:
        fh.write(content)
    return name


if __name__ == '__main__':
    files = []
    for scheme in SCHEMES:
        files.append(write(SVG_DIR, f'taalcut-symbol-{scheme}.svg', symbol_svg(scheme)))
        files.append(write(SVG_DIR, f'taalcut-symbol-small-{scheme}.svg', symbol_svg(scheme, small=True)))
        files.append(write(SVG_DIR, f'taalcut-horizontal-{scheme}.svg', horizontal_svg(scheme)))
        files.append(write(SVG_DIR, f'taalcut-horizontal-small-{scheme}.svg', horizontal_svg(scheme, small=True)))
        files.append(write(SVG_DIR, f'taalcut-stacked-{scheme}.svg', stacked_svg(scheme)))
    for name, colour in (('ink', C['ink']), ('cream', C['cream']), ('black', C['black']), ('white', C['white'])):
        files.append(write(SVG_DIR, f'taalcut-wordmark-{name}.svg', wordmark_svg(colour)))
    write(ICON_DIR, 'source-macos.svg', macos_icon_svg())
    write(ICON_DIR, 'source-macos-small.svg', macos_icon_svg(small=True))
    write(ICON_DIR, 'source-tile.svg', tile_svg())
    write(ICON_DIR, 'source-tile-small.svg', tile_svg(small=True))
    write(ICON_DIR, 'source-full-bleed.svg', full_bleed_svg())
    write(os.path.join(KIT, 'web'), 'favicon.svg', favicon_svg())
    write(os.path.join(HERE, 'motion'), 'mark-geometry.js', motion_geometry_js())
    print(f'{len(files)} masters in {SVG_DIR}, icon sources in {ICON_DIR}')
