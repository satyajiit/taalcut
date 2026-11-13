// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Colours as values, read at build, for the two places that need a value rather than a utility class: the social
 * cards (Satori paints hex) and the press kit's colour list (a writer copies the hex). Nothing is typed as a colour
 * here: the logo's colours come from design/tokens/tokens.json, and the world's (ground, ink, stickers) from the
 * light values in src/app/globals.css, converted from OKLCH. Server-only: it reads files.
 */

const SITE_ROOT = process.cwd();
const REPO = join(SITE_ROOT, '..');

interface TokenFile {
  readonly color: Readonly<Record<'light' | 'dark', Readonly<Record<string, { readonly $value: { readonly hex: string } }>>>>;
}

let tokens: TokenFile | undefined;

/** A design token's hex in a theme (tokens.json): `logo-1` on light is the marigold for light grounds. */
export function tokenHex(theme: 'light' | 'dark', name: string): string {
  tokens ??= JSON.parse(readFileSync(join(REPO, 'design/tokens/tokens.json'), 'utf8')) as TokenFile;
  const hex = tokens.color[theme][name]?.$value.hex;
  if (!hex) throw new Error(`tokens.json has no ${theme} ${name}`);
  return hex.toLowerCase();
}

/** sRGB hex from OKLCH (L 0–1, C, H in degrees), clamped into the gamut. */
export function oklchToHex(l: number, c: number, h: number): string {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  return `#${linear
    .map((x) => {
      const v = Math.min(1, Math.max(0, x));
      const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
      return Math.round(g * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

let world: ReadonlyMap<string, string> | undefined;

/**
 * The site's light colours by token name (`canvas`, `ink-2`, `sticker-pink`), from globals.css: the first value each
 * name takes there is its light one (the @theme block and the light :root come before the dark ones).
 */
export function worldHex(name: string): string {
  if (!world) {
    const css = readFileSync(join(SITE_ROOT, 'src/app/globals.css'), 'utf8');
    const found = new Map<string, string>();
    for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
      if (!found.has(m[1]!)) found.set(m[1]!, oklchToHex(Number(m[2]) / 100, Number(m[3]), Number(m[4])));
    }
    world = found;
  }
  const hex = world.get(name);
  if (!hex) throw new Error(`globals.css has no light --color-${name}`);
  return hex;
}

/** The logo's four colours, light and dark, in its order (logo-1 to logo-4), for the press kit. */
export function logoColours(): readonly { readonly token: string; readonly light: string; readonly dark: string }[] {
  return ['logo-1', 'logo-2', 'logo-3', 'logo-4'].map((token) => ({ token, light: tokenHex('light', token), dark: tokenHex('dark', token) }));
}
