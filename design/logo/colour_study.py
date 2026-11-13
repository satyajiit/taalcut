#!/usr/bin/env python3
"""Colour study for concept A (Avartan) on the DESIGN.md palette.

  python3 design/logo/colour_study.py   # writes design/logo/colour-study-a.svg
"""
import os
import build_concepts as bc

HERE = os.path.dirname(os.path.abspath(__file__))

# DESIGN.md fills (light theme / dark theme) and surfaces
PAPER, CHARCOAL, INK, CREAM = '#faf6f1', '#15110d', '#1e1712', '#f0ece7'
LIGHT = {'marigold': '#faab35', 'rose': '#e44d7d', 'teal': '#33bcae', 'violet': '#765dcf', 'marigold-strong': '#a94e00'}
DARK = {'marigold': '#faab3f', 'rose': '#f26a90', 'teal': '#3cc2b4', 'violet': '#9e8cf4'}

SPANS = (75, 105, 75, 105)


def arcs(cx, cy, size, colours, start=-90):
    """Arc order: sam (beat one, heaviest), tali, khali (lightest), tali."""
    k = size / 256
    out, a = [], start
    for span, w, colour in zip(SPANS, bc.AVARTAN_WEIGHTS, colours):
        d = bc.arc_band(cx, cy, 112 * k, (112 - w) * k, a, a + span, 18 * k)
        out.append(f'<path fill="{colour}" d="{d}"/>')
        a += span
    return ''.join(out)


def tile(x, y, w, h, bg, colours, label, sub, radius=24, size=200, label_ink=INK):
    cx, cy = x + w / 2, y + h / 2 - 22
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{bg}" stroke="#e4ddd3"/>'
            f'{arcs(cx, cy, size, colours)}'
            f'<text x="{x + 24}" y="{y + h - 44}" font-size="20" font-weight="600" fill="{label_ink}">{label}</text>'
            f'<text x="{x + 24}" y="{y + h - 18}" font-size="15" fill="{label_ink}" opacity="0.72">{sub}</text>')


def sizes(x, y, bg, colours, label_ink):
    out = [f'<rect x="{x}" y="{y}" width="300" height="150" rx="20" fill="{bg}" stroke="#e4ddd3"/>']
    px = x + 28
    for s in (64, 32, 16):
        out.append(arcs(px + s / 2, y + 62, s, colours))
        out.append(f'<text x="{px}" y="{y + 128}" font-size="13" fill="{label_ink}" opacity="0.7">{s} px</text>')
        px += s + 40
    return ''.join(out)


def main():
    four_l = [LIGHT['marigold'], LIGHT['rose'], LIGHT['violet'], LIGHT['teal']]
    four_d = [DARK['marigold'], DARK['rose'], DARK['violet'], DARK['teal']]
    duo_l = [LIGHT['marigold-strong'], INK, INK, INK]
    duo_d = [DARK['marigold'], CREAM, CREAM, CREAM]
    mono_d = [DARK['marigold']] * 4

    W, TW, TH, G = 1600, 360, 380, 32
    x0 = 64
    body = [f'<rect width="{W}" height="1000" fill="#f6f2ec"/>',
            f'<text x="{x0}" y="78" font-size="38" font-weight="700" fill="{INK}">Taalcut · concept A in colour</text>',
            f'<text x="{x0}" y="114" font-size="18" fill="{INK}" opacity="0.72">Colours are the DESIGN.md fills. Arcs clockwise from the top: beat one, a clap, the empty beat, a clap.</text>']
    row1 = [
        (CHARCOAL, four_d, 'Four beats, four jobs', 'marigold · rose · violet · teal', CREAM),
        (PAPER, four_l, 'Four beats on paper', 'marigold and teal are faint here', INK),
        (CHARCOAL, duo_d, 'The cut lands on one', 'cream + marigold beat one', CREAM),
        (PAPER, duo_l, 'The cut lands on one', 'ink + burnt-orange beat one', INK),
    ]
    for i, (bg, cols, lab, sub, ink) in enumerate(row1):
        body.append(tile(x0 + i * (TW + G), 150, TW, TH, bg, cols, lab, sub, label_ink=ink))

    # app icon (macOS squircle-ish) and favicon sizes
    y2 = 150 + TH + 48
    body.append(f'<text x="{x0}" y="{y2}" font-size="22" font-weight="600" fill="{INK}">In use</text>')
    ix, iy = x0, y2 + 24
    body.append(f'<rect x="{ix}" y="{iy}" width="300" height="300" rx="68" fill="{CHARCOAL}"/>')
    body.append(arcs(ix + 150, iy + 150, 196, four_d))
    body.append(f'<text x="{ix}" y="{iy + 330}" font-size="15" fill="{INK}" opacity="0.72">App icon (dock)</text>')
    ix2 = ix + 300 + G
    body.append(f'<rect x="{ix2}" y="{iy}" width="300" height="300" rx="68" fill="{CHARCOAL}"/>')
    body.append(arcs(ix2 + 150, iy + 150, 196, mono_d))
    body.append(f'<text x="{ix2}" y="{iy + 330}" font-size="15" fill="{INK}" opacity="0.72">One colour: marigold</text>')
    sx = ix2 + 300 + G
    body.append(sizes(sx, iy, CHARCOAL, four_d, CREAM))
    body.append(sizes(sx, iy + 150 + 24, PAPER, duo_l, INK))
    body.append(f'<text x="{sx}" y="{iy + 330}" font-size="15" fill="{INK}" opacity="0.72">Favicon and small sizes</text>')
    lx = sx + 300 + G
    pen = bc.wordmark(bc.Pen(0.42, iy + 104 + 0.42 * bc.X / 2, lx + 128))
    word = ''.join(p.replace('#000000', CREAM) for p in pen.parts)
    body.append(f'<rect x="{lx}" y="{iy}" width="{W - lx - x0}" height="210" rx="20" fill="{CHARCOAL}"/>')
    body.append(arcs(lx + 70, iy + 104, 96, four_d) + word)
    body.append(f'<text x="{lx}" y="{iy + 240}" font-size="15" fill="{INK}" opacity="0.72">Lockup on the dark canvas</text>')

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 1000" width="{W}" height="1000" '
           f'font-family="Onest, Helvetica Neue, Helvetica, Arial, sans-serif">{"".join(body)}</svg>\n')
    out = os.path.join(HERE, 'colour-study-a.svg')
    with open(out, 'w') as fh:
        fh.write(svg)
    print(out)


if __name__ == '__main__':
    main()
