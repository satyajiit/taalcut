#!/usr/bin/env python3
"""Renders the Taalcut logo kit's raster files from the SVG masters. Run build_kit.py first.

  python3 design/logo/export_kit.py

Needs cairosvg (pip install cairosvg). On macOS, iconutil builds the .icns.
Writes kit/png, kit/app-icon/{macos,windows,linux}, kit/web, kit/social and kit/guide.
"""
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
from html import escape

import cairosvg

import build_kit as bk
from build_concepts import n, polar

KIT = bk.KIT
SVG = bk.SVG_DIR
ICON = bk.ICON_DIR
C = bk.C
PAPER, WHITE = '#FAF6F1', '#FFFFFF'
FONT = 'Onest, Helvetica Neue, Helvetica, Arial, sans-serif'


def out_dir(*parts):
    p = os.path.join(KIT, *parts)
    os.makedirs(p, exist_ok=True)
    return p


def viewbox(path):
    w, h = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', open(path).read()).groups()
    return float(w), float(h)


def render(src, dst, width, height=None, bg=None):
    """SVG file (or SVG string) to PNG; height follows the viewBox when omitted."""
    is_file = not src.lstrip().startswith('<')
    if height is None:
        vw, vh = viewbox(src) if is_file else map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', src).groups())
        height = round(width * vh / vw)
    kw = {'url': src} if is_file else {'bytestring': src.encode()}
    cairosvg.svg2png(**kw, write_to=dst, output_width=width, output_height=height, background_color=bg)
    return dst


def png_bytes(src, size):
    return cairosvg.svg2png(url=src, output_width=size, output_height=size)


def write_ico(dst, entries):
    """ICO with PNG-compressed images; entries = [(size, png_bytes)]. Each size keeps its own drawing."""
    head = struct.pack('<HHH', 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    dirs, blobs = b'', b''
    for size, data in entries:
        dim = 0 if size >= 256 else size
        dirs += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    with open(dst, 'wb') as fh:
        fh.write(head + dirs + blobs)


# ---------- PNG masters ----------

def export_pngs():
    d = out_dir('png')
    count = 0
    for scheme in bk.SCHEMES:
        for size in (512, 1024):
            render(f'{SVG}/taalcut-symbol-{scheme}.svg', f'{d}/taalcut-symbol-{scheme}-{size}.png', size)
        for width in (1200, 2400):
            render(f'{SVG}/taalcut-horizontal-{scheme}.svg', f'{d}/taalcut-horizontal-{scheme}-{width}.png', width)
        render(f'{SVG}/taalcut-horizontal-small-{scheme}.svg', f'{d}/taalcut-horizontal-small-{scheme}-320.png', 320)
        render(f'{SVG}/taalcut-stacked-{scheme}.svg', f'{d}/taalcut-stacked-{scheme}-1200.png', 1200)
        count += 6
    for name in ('ink', 'cream', 'black', 'white'):
        render(f'{SVG}/taalcut-wordmark-{name}.svg', f'{d}/taalcut-wordmark-{name}-1200.png', 1200)
        count += 1
    return count


# ---------- app icons ----------

def tile_for(size):
    return f'{ICON}/source-tile-small.svg' if size <= 48 else f'{ICON}/source-tile.svg'


def export_app_icons():
    mac = out_dir('app-icon', 'macos')
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'Taalcut.iconset')
        os.makedirs(iconset)
        for pt in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                px = pt * scale
                src = f'{ICON}/source-macos-small.svg' if px <= 32 else f'{ICON}/source-macos.svg'
                name = f'icon_{pt}x{pt}{"@2x" if scale == 2 else ""}.png'
                render(src, os.path.join(iconset, name), px)
        if shutil.which('iconutil'):
            subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', f'{mac}/Taalcut.icns'], check=True)
        else:
            print('iconutil not found: skipped Taalcut.icns (macOS only)')
    render(f'{ICON}/source-macos.svg', f'{mac}/icon-1024.png', 1024)

    win = out_dir('app-icon', 'windows')
    write_ico(f'{win}/icon.ico', [(s, png_bytes(tile_for(s), s)) for s in (16, 24, 32, 48, 64, 128, 256)])

    lin = out_dir('app-icon', 'linux')
    for s in (16, 24, 32, 48, 64, 128, 256, 512):
        render(tile_for(s), f'{lin}/{s}x{s}.png', s)


# ---------- web icons ----------

def export_web():
    d = out_dir('web')
    write_ico(f'{d}/favicon.ico', [(s, png_bytes(tile_for(s), s)) for s in (16, 32, 48)])
    for s in (16, 32, 48):
        render(tile_for(s), f'{d}/favicon-{s}.png', s)
    render(f'{ICON}/source-full-bleed.svg', f'{d}/apple-touch-icon.png', 180)
    render(f'{ICON}/source-tile.svg', f'{d}/icon-192.png', 192)
    render(f'{ICON}/source-tile.svg', f'{d}/icon-512.png', 512)
    render(f'{ICON}/source-full-bleed.svg', f'{d}/maskable-512.png', 512)
    manifest = {
        'name': 'Taalcut', 'short_name': 'Taalcut',
        'icons': [{'src': '/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
                  {'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
                  {'src': '/maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}],
        'theme_color': C['charcoal'], 'background_color': C['charcoal'], 'display': 'standalone',
    }
    with open(f'{d}/site.webmanifest', 'w') as fh:
        json.dump(manifest, fh, indent=2)
        fh.write('\n')
    with open(f'{d}/head-snippet.html', 'w') as fh:
        fh.write('<!-- Taalcut icons: copy kit/web/* to the site root -->\n'
                 '<link rel="icon" href="/favicon.ico" sizes="48x48">\n'
                 '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
                 '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
                 '<link rel="manifest" href="/site.webmanifest">\n'
                 '<meta name="theme-color" content="#faf6f1" media="(prefers-color-scheme: light)">\n'
                 '<meta name="theme-color" content="#15110d" media="(prefers-color-scheme: dark)">\n')


# ---------- social ----------

def export_social():
    d = out_dir('social')
    render(f'{ICON}/source-full-bleed.svg', f'{d}/avatar-1024.png', 1024)
    W, H = 1280, 640
    D = 190
    _, w = bk.horizontal_body('four-colour-dark', 0, 0, D)
    body, _ = bk.horizontal_body('four-colour-dark', (W - w) / 2, H / 2, D)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">'
           f'<rect width="{W}" height="{H}" fill="{C["charcoal"]}"/>{body}</svg>')
    render(svg, f'{d}/social-preview-1280x640.png', W, H)


# ---------- usage-guide figures ----------

def label(x, y, text, size=17, fill=None, weight=500, anchor='start', opacity=1.0):
    fill = fill or C['ink']
    return (f'<text x="{n(x)}" y="{n(y)}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}" opacity="{opacity}">{escape(text)}</text>')


def figure(w, h, body, bg='#F3EEE7'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"><rect width="{w}" height="{h}" fill="{bg}"/>{body}</svg>'


def symbol_body(scheme, cx, cy, D, small=False):
    cols, _, geom, sgeom, _ = bk.SCHEMES[scheme]
    return bk.paint(zip(cols, bk.arcs(cx, cy, D, sgeom if small else geom)))


def fig_clear_space():
    W, H = 1600, 640
    guide = '#C0562A'
    parts = [f'<rect x="40" y="40" width="1520" height="560" rx="18" fill="{PAPER}"/>']
    # horizontal lockup with its clear-space zone (a quarter of the symbol's diameter)
    D = 180
    q = D / 4
    _, w = bk.horizontal_body('two-colour-light', 0, 0, D)
    x0, cy = 130, 320
    body, _ = bk.horizontal_body('two-colour-light', x0, cy, D)
    parts.append(f'<rect x="{n(x0 - q)}" y="{n(cy - D / 2 - q)}" width="{n(w + 2 * q)}" height="{n(D + 2 * q)}" '
                 f'fill="none" stroke="{guide}" stroke-width="2" stroke-dasharray="8 6"/>')
    for sx, sy in ((x0 - q, cy - q / 2), (x0 + w, cy - q / 2), (x0 + D / 2 - q / 2, cy - D / 2 - q),
                   (x0 + D / 2 - q / 2, cy + D / 2)):
        parts.append(f'<rect x="{n(sx)}" y="{n(sy)}" width="{n(q)}" height="{n(q)}" fill="{guide}" opacity="0.18"/>')
    parts.append(body)
    parts.append(label(x0 - q, cy + D / 2 + q + 34, 'Clear space: ¼ of the symbol’s width (¼ D) on every side', 18,
                       fill=guide, weight=600))
    # symbol alone, same rule
    Ds = 200
    sx0, sy0 = 1250, 320
    parts.append(f'<rect x="{n(sx0 - Ds / 2 - Ds / 4)}" y="{n(sy0 - Ds / 2 - Ds / 4)}" width="{n(Ds * 1.5)}" '
                 f'height="{n(Ds * 1.5)}" fill="none" stroke="{guide}" stroke-width="2" stroke-dasharray="8 6"/>')
    parts.append(symbol_body('two-colour-light', sx0, sy0, Ds))
    parts.append(label(sx0, sy0 + Ds / 2 + Ds / 4 + 34, 'Symbol alone: the same ¼ D', 18, fill=guide, weight=600,
                       anchor='middle'))
    return figure(W, H, ''.join(parts))


def fig_backgrounds():
    cells = [
        ('four-colour-dark', C['charcoal'], 'Four colours on the dark canvas', C['cream'], None),
        ('four-colour-light', PAPER, 'Four colours on paper', C['ink'], None),
        ('two-colour-light', PAPER, 'Two colours on light (everyday)', C['ink'], None),
        ('two-colour-dark', C['charcoal'], 'Two colours on dark (everyday)', C['cream'], None),
        ('black', WHITE, 'One colour: black', C['ink'], None),
        ('marigold', C['charcoal'], 'One colour: marigold on dark', C['cream'], None),
        ('white', C['violet-strong'], 'White on a strong accent', WHITE, None),
        ('white', None, 'White on a calm, dark photo area', WHITE, 'photo'),
    ]
    cw, ch, g, m = 370, 230, 20, 30
    W = m * 2 + cw * 4 + g * 3
    H = m * 2 + ch * 2 + g
    defs = ('<defs><linearGradient id="ph" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a3b2e"/>'
            '<stop offset="0.55" stop-color="#2b2420"/><stop offset="1" stop-color="#18222a"/></linearGradient></defs>')
    parts = [defs]
    for i, (scheme, bg, text, ink, kind) in enumerate(cells):
        x = m + (i % 4) * (cw + g)
        y = m + (i // 4) * (ch + g)
        fill = 'url(#ph)' if kind == 'photo' else bg
        stroke = ' stroke="#E2DACF"' if bg in (PAPER, WHITE) else ''
        parts.append(f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="16" fill="{fill}"{stroke}/>')
        D = 68
        _, w = bk.horizontal_body(scheme, 0, 0, D)
        body, _ = bk.horizontal_body(scheme, x + (cw - w) / 2, y + 90, D)
        parts.append(body)
        parts.append(label(x + 20, y + ch - 22, text, 16, fill=ink, weight=500))
    return figure(W, H, ''.join(parts))


def fig_donts():
    cw, ch, g, m = 370, 230, 20, 30
    W = m * 2 + cw * 4 + g * 3
    H = m * 2 + ch * 2 + g
    red = '#C23B22'
    D = 68
    parts = []

    def lock(x, y, scheme='two-colour-light'):
        _, w = bk.horizontal_body(scheme, 0, 0, D)
        return bk.horizontal_body(scheme, x + (cw - w) / 2, y + 90, D)[0], x + (cw - w) / 2, w

    cells = ['Don’t stretch or squash', 'Don’t rotate', 'Don’t recolour outside the palette', 'Don’t add effects',
             'Don’t rearrange the parts', 'Don’t use the dark four-colour version on light',
             'Don’t place it on busy backgrounds', 'Don’t outline or retype it']
    for i, text in enumerate(cells):
        x = m + (i % 4) * (cw + g)
        y = m + (i // 4) * (ch + g)
        bg = PAPER
        art = ''
        if i == 0:
            body, lx, w = lock(x, y)
            cx, cy = lx + w / 2, y + 90
            art = f'<g transform="translate({n(cx)} {n(cy)}) scale(1.22 0.72) translate({n(-cx)} {n(-cy)})">{body}</g>'
        elif i == 1:
            body, lx, w = lock(x, y)
            art = f'<g transform="rotate(-14 {n(lx + w / 2)} {n(y + 90)})">{body}</g>'
        elif i == 2:
            body, _, _ = lock(x, y)
            art = body.replace(C['marigold-strong'], '#2E7D32').replace(C['ink'], '#1565C0')
        elif i == 3:
            body, _, _ = lock(x, y)
            shadow = re.sub(r'fill="#[0-9A-Fa-f]{6}"', 'fill="#000000" opacity="0.25"', body)
            art = f'<g transform="translate(6 7)">{shadow}</g>{body}'
        elif i == 4:
            s = bk.LOCK['xheight'] * D / bk.X
            wd, xend = bk.wordmark(0, 0, s)
            ww = xend
            total = ww + 0.3 * D + D
            x0 = x + (cw - total) / 2
            wd, _ = bk.wordmark(x0, y + 90 + bk.X * s / 2, s)
            art = bk.paint([(C['ink'], wd)]) + symbol_body('two-colour-light', x0 + ww + 0.3 * D + D / 2, y + 90, D)
        elif i == 5:
            body, _, _ = lock(x, y, 'four-colour-dark')
            art = body.replace(C['cream'], C['ink'])
        elif i == 6:
            band = ch - 64
            stripes = f'<rect x="{x}" y="{y}" width="{cw}" height="{band}" fill="#7FA7C9"/>' + ''.join(
                f'<rect x="{x + k * 28}" y="{y}" width="14" height="{band}" fill="#D9A441" opacity="0.6"/>'
                for k in range(cw // 28 + 1))
            body, _, _ = lock(x, y)
            art = f'<clipPath id="cl{i}"><rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="16"/></clipPath>' \
                  f'<g clip-path="url(#cl{i})">{stripes}</g>{body}'
        elif i == 7:
            body, _, _ = lock(x, y)
            art = re.sub(r'fill="#[0-9A-Fa-f]{6}"', f'fill="none" stroke="{C["ink"]}" stroke-width="2"', body)
        parts.append(f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="16" fill="{bg}" stroke="#E2DACF"/>')
        parts.append(art)
        # the cross marker
        mx, my = x + cw - 34, y + 34
        parts.append(f'<circle cx="{mx}" cy="{my}" r="15" fill="{red}"/>'
                     f'<path d="M{mx - 6} {my - 6}L{mx + 6} {my + 6}M{mx + 6} {my - 6}L{mx - 6} {my + 6}" '
                     f'stroke="#fff" stroke-width="3" stroke-linecap="round"/>')
        parts.append(label(x + 20, y + ch - 22, text, 16, weight=500))
    return figure(W, H, ''.join(parts))


def fig_construction():
    W, H = 1600, 760
    D = 520
    cx, cy = 520, 380
    R = D / 2
    guide = '#C0562A'
    parts = [f'<rect x="40" y="40" width="1520" height="680" rx="18" fill="{PAPER}"/>']
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="{n(R)}" fill="none" stroke="{guide}" stroke-width="1.5" '
                 f'stroke-dasharray="6 6" opacity="0.7"/>')
    for a in (-90, -15, 90, 165):
        x1, y1 = polar(cx, cy, 30, a)
        x2, y2 = polar(cx, cy, R + 46, a)
        parts.append(f'<path d="M{n(x1)} {n(y1)}L{n(x2)} {n(y2)}" stroke="{guide}" stroke-width="1.5" opacity="0.8"/>')
    parts.append(symbol_body('black', cx, cy, D).replace('#000000', C['ink']))
    names = (('sam · beat one', '60'), ('tali · clap', '38'), ('khali · wave', '20'), ('tali · clap', '38'))
    a = -90
    for (name, weight), span in zip(names, bk.SPANS):
        mid = a + span / 2
        lx, ly = polar(cx, cy, R + 70, mid)
        anchor = 'start' if -90 < mid < 90 else 'end'
        parts.append(label(lx, ly - 4, name, 19, weight=600, anchor=anchor))
        parts.append(label(lx, ly + 20, f'{span}° · weight {weight}', 16, anchor=anchor, opacity=0.7))
        a += span
    tx = 1020
    notes = [('Grid', '224-unit ring; every value below is in those units'),
             ('Rhythm', 'jhaptaal’s 2+3+2+3 beats, drawn as arcs of 75°, 105°, 75°, 105°'),
             ('Start', 'the cycle starts at the top (sam), like a clock'),
             ('Weights', '60 · 38 · 20 · 38 (outer edge stays one circle)'),
             ('Cuts', '18 wide, parallel-sided, on clean 15° angles'),
             ('Reversed', '58 · 36 · 19 · 36, cuts 19 (light on dark looks heavier)'),
             ('Small (<40 px)', '66 · 46 · 32 · 46, cuts 28 (stays open at 16 px)')]
    y = 150
    for head, text in notes:
        parts.append(label(tx, y, head, 18, weight=600))
        parts.append(label(tx, y + 26, text, 16, opacity=0.75))
        y += 72
    return figure(W, H, ''.join(parts))


def fig_palette():
    rows = [('On dark  ·  canvas #15110D', C['charcoal'], [('Marigold', C['marigold']), ('Rose', C['rose']),
                                                         ('Violet', C['violet']), ('Teal', C['teal']),
                                                         ('Cream', C['cream'])], C['cream']),
            ('On light  ·  paper #FAF6F1', PAPER, [('Marigold strong', C['marigold-strong']),
                                                  ('Rose strong', C['rose-strong']),
                                                  ('Violet strong', C['violet-strong']),
                                                  ('Teal strong', C['teal-strong']), ('Ink', C['ink'])], C['ink'])]
    W, H = 1600, 620
    parts = []
    y = 40
    for title, bg, swatches, ink in rows:
        parts.append(f'<rect x="40" y="{y}" width="1520" height="250" rx="18" fill="{bg}" stroke="#E2DACF"/>')
        parts.append(label(72, y + 44, title, 18, fill=ink, weight=600))
        x = 72
        for name, hx in swatches:
            parts.append(f'<rect x="{x}" y="{y + 70}" width="268" height="104" rx="12" fill="{hx}"/>')
            parts.append(label(x, y + 204, name, 17, fill=ink, weight=600))
            parts.append(label(x, y + 228, hx, 15, fill=ink, opacity=0.75))
            x += 292
        y += 280
    return figure(W, H, ''.join(parts))


def export_guide():
    d = out_dir('guide')
    for name, fn, w in (('clear-space', fig_clear_space, 1600), ('backgrounds', fig_backgrounds, 1600),
                        ('donts', fig_donts, 1600), ('construction', fig_construction, 1600),
                        ('palette', fig_palette, 1600)):
        svg = fn()
        render(svg, f'{d}/{name}.png', w)


if __name__ == '__main__':
    pngs = export_pngs()
    export_app_icons()
    export_web()
    export_social()
    export_guide()
    print(f'{pngs} PNG masters; app icons, web icons, social images and guide figures written to {KIT}')
