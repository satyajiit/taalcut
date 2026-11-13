#!/usr/bin/env python3
"""Builds the three Taalcut logo concepts as clean, black-first SVG.

No live text, no transforms, no filters: every letter and shape is constructed
from circles, arcs and rectangles on a 256-unit grid, so geometry stays exact.

  python3 design/logo/build_concepts.py [version]   # writes design/logo/concepts/*-v<version>.svg
"""
import math
import os
import sys

VERSION = sys.argv[1] if len(sys.argv) > 1 else '1'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'concepts')
INK = '#000000'  # black first; colour comes after a direction is chosen


def n(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def svg(w, h, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(w)} {n(h)}" width="{n(w)}" height="{n(h)}" '
            f'role="img" aria-labelledby="title">\n  <title id="title">{title}</title>\n{body}\n</svg>\n')


def path(d, evenodd=False):
    rule = ' fill-rule="evenodd"' if evenodd else ''
    return f'  <path fill="{INK}"{rule} d="{d}"/>'


# ---------- primitives (y grows downward; angles in degrees, 0 = right, 90 = down) ----------

def rect(x, y, w, h):
    return f'M{n(x)} {n(y)}H{n(x + w)}V{n(y + h)}H{n(x)}Z'


def disc(cx, cy, r):
    return f'M{n(cx - r)} {n(cy)}A{n(r)} {n(r)} 0 1 1 {n(cx + r)} {n(cy)}A{n(r)} {n(r)} 0 1 1 {n(cx - r)} {n(cy)}Z'


def ring(cx, cy, R, r):  # use with evenodd
    return disc(cx, cy, R) + disc(cx, cy, r)


def arc_band(cx, cy, R, r, a0, a1, gap=0.0):
    """Ring segment from a0 to a1. With gap > 0 the cut ends are parallel-sided (constant width)."""
    do = math.degrees(math.asin(gap / 2 / R)) if gap else 0
    di = math.degrees(math.asin(gap / 2 / r)) if gap else 0
    o0, o1, i0, i1 = a0 + do, a1 - do, a0 + di, a1 - di
    lo = 1 if o1 - o0 > 180 else 0
    li = 1 if i1 - i0 > 180 else 0
    x0, y0 = polar(cx, cy, R, o0)
    x1, y1 = polar(cx, cy, R, o1)
    x2, y2 = polar(cx, cy, r, i1)
    x3, y3 = polar(cx, cy, r, i0)
    return (f'M{n(x0)} {n(y0)}A{n(R)} {n(R)} 0 {lo} 1 {n(x1)} {n(y1)}'
            f'L{n(x2)} {n(y2)}A{n(r)} {n(r)} 0 {li} 0 {n(x3)} {n(y3)}Z')


# ---------- the Taalcut letter set (geometric lowercase, built for this name) ----------

X = 120      # x-height
W = 26       # stem weight
HW = 23      # horizontal weight (thinned for optical evenness)
O = 3        # overshoot of round forms
ASC_L = 176  # height of l
ASC_T = 150  # height of t


class Pen:
    def __init__(self, s=1.0, base=0.0, x=0.0):
        self.s, self.base, self.x, self.parts = s, base, x, []

    def _r(self, x, y, w, h):
        s = self.s
        self.parts.append(path(rect(self.x + x * s, self.base + y * s, w * s, h * s)))

    def t(self):
        s = self.s
        self._r(22, -ASC_T, W, ASC_T)   # stem
        self._r(0, -X, 22 + W + 26, HW)  # crossbar at the x-height
        self.x += (22 + W + 26) * s

    def a(self, filled=False):
        s, R = self.s, X / 2 + O
        cx, cy = self.x + R * s, self.base - X / 2 * s
        if filled:
            self.parts.append(path(disc(cx, cy, R * s)))
        else:
            self.parts.append(path(ring(cx, cy, R * s, (R - W) * s), evenodd=True))
        self._r(2 * R - W, -X, W, X)  # stem on the right
        self.x += 2 * R * s

    def l(self):
        self._r(0, -ASC_L, W, ASC_L)
        self.x += W * self.s

    def c(self):
        s, R = self.s, X / 2 + O
        cx, cy = self.x + R * s, self.base - X / 2 * s
        self.parts.append(path(arc_band(cx, cy, R * s, (R - W) * s, 45, 315)))
        self.x += 2 * R * s

    def u(self):
        s, R = self.s, X / 2
        cx, cy = self.x + R * s, self.base - (R - O) * s
        self._r(0, -X, W, X - (R - O))                 # left stem down to the bowl's centre
        self._r(2 * R - W, -X, W, X)                   # right stem to the baseline
        self.parts.append(path(arc_band(cx, cy, R * s, (R - W) * s, 0, 180)))
        self.x += 2 * R * s

    def gap(self, units):
        self.x += units * self.s


def wordmark(pen, tali=False):
    """taalcut. With tali=True the first a is clapped (filled), the second waved (open)."""
    pen.t(); pen.gap(22 if tali else 14)
    pen.a(filled=tali); pen.gap(20)
    pen.a(); pen.gap(22)
    pen.l(); pen.gap(22)
    pen.c(); pen.gap(12)
    pen.u(); pen.gap(16)
    pen.t()
    return pen


def wordmark_width(s):
    return wordmark(Pen(s)).x


# ---------- concept A: Avartan, the rhythm cycle ----------

# Jhaptaal: 2+3+2+3 beats. Vibhag weights follow the accents: sam (X) heaviest,
# tali (2, 3) medium, khali (0) lightest. Outer edge stays a perfect circle.
AVARTAN_WEIGHTS = (60, 38, 20, 38)


def avartan(cx, cy, size, weights=AVARTAN_WEIGHTS, start=-90):
    """Four arcs in a 2:3:2:3 feel (75°, 105°, 75°, 105°, so every cut sits on a clean 15° angle),
    the cycle starting at the top (sam)."""
    k = size / 256
    R, gap = 112 * k, 18 * k
    spans = (75, 105, 75, 105)
    parts, a = [], start
    for span, w in zip(spans, weights):
        parts.append(path(arc_band(cx, cy, R, R - w * k, a, a + span, gap)))
        a += span
    return parts


# ---------- concept C: Half beat, one beat cut and nudged ----------

def half_beat(cx, cy, size, angle=0):
    """A disc cut through the middle; the halves slide apart along the cut.
    Left half solid (tali, the clap), right half open (khali, the wave)."""
    k = size / 256
    R, g, slide, t = 100 * k, 18 * k, 26 * k, 25 * k
    c, s_ = math.cos(math.radians(angle)), math.sin(math.radians(angle))

    def P(x, y):  # rotate local coords (cut along local y) and move to centre
        return cx + x * c - y * s_, cy + x * s_ + y * c

    def pt(x, y):
        px, py = P(x, y)
        return f'{n(px)} {n(py)}'

    lx, ly = -g / 2, slide / 2      # solid half's flat edge centre
    rx, ry = g / 2, -slide / 2      # open half's flat edge centre
    solid = f'M{pt(lx, ly - R)}A{n(R)} {n(R)} 0 0 0 {pt(lx, ly + R)}Z'
    h = math.sqrt((R - t) ** 2 - t ** 2)
    open_ = (f'M{pt(rx, ry - R)}A{n(R)} {n(R)} 0 0 1 {pt(rx, ry + R)}Z'
             f'M{pt(rx + t, ry - h)}A{n(R - t)} {n(R - t)} 0 0 1 {pt(rx + t, ry + h)}Z')
    return [path(solid), path(open_, evenodd=True)]


# ---------- lockups ----------

def lockup(symbol_fn, title, tali=False):
    sym = 196
    s = 0.6
    base = 128 + X * s / 2
    gap = 44
    x0 = 16 + sym + gap
    pen = wordmark(Pen(s, base, x0), tali)
    width = pen.x + 16
    return svg(width, 256, title, '\n'.join(symbol_fn(16 + sym / 2, 128, sym) + pen.parts))


def wordmark_only(title):
    s = 1.0
    pen = wordmark(Pen(s, 0, 0), tali=True)
    pad = 24
    width = pen.x + 2 * pad
    pen = wordmark(Pen(s, 128 + X / 2 + 18, pad), tali=True)
    return svg(width, 256, title, '\n'.join(pen.parts))


def aa_symbol(title):
    s = 0.84
    w = (2 * (X / 2 + O) * 2 + 20) * s
    pen = Pen(s, 128 + X * s / 2, (256 - w) / 2)
    pen.a(filled=True); pen.gap(20); pen.a()
    return svg(256, 256, title, '\n'.join(pen.parts))


def write(name, content):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, f'{name}-v{VERSION}.svg')
    with open(p, 'w') as fh:
        fh.write(content)
    print(p)


if __name__ == '__main__':
    write('a-avartan-symbol', svg(256, 256, 'Taalcut concept A: Avartan', '\n'.join(avartan(128, 128, 256))))
    write('a-avartan-lockup', lockup(avartan, 'Taalcut concept A lockup'))
    write('b-tali-khali-symbol', aa_symbol('Taalcut concept B: Tali and khali'))
    write('b-tali-khali-wordmark', wordmark_only('Taalcut concept B wordmark'))
    write('c-half-beat-symbol', svg(256, 256, 'Taalcut concept C: Half beat', '\n'.join(half_beat(128, 128, 256))))
    write('c-half-beat-lockup', lockup(half_beat, 'Taalcut concept C lockup'))
    if '--explore' in sys.argv:
        for ang in (0, 90):
            write(f'x-c-angle{ang}', svg(256, 256, 'explore', '\n'.join(half_beat(128, 128, 256, angle=ang))))
        write('x-a-even', svg(256, 256, 'explore', '\n'.join(avartan(128, 128, 256, weights=(44, 44, 44, 44)))))
        write('x-a-start-54', svg(256, 256, 'explore', '\n'.join(avartan(128, 128, 256, start=-126))))
