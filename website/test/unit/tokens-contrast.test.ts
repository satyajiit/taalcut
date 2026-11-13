// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA, contrast, parseOklch } from '#lib/contrast';
import { REPO_ROOT, SITE_ROOT } from './source-files';

/**
 * The WEB2 world's tokens, held to WCAG AA in both themes. The values are read from the CSS itself: the app's tokens
 * (design/tokens/tailwind.css) under the site's own (src/app/globals.css), the way the browser cascades them.
 */
const TOKENS = readFileSync(join(REPO_ROOT, 'design/tokens/tailwind.css'), 'utf8');
const SITE = readFileSync(join(SITE_ROOT, 'src/app/globals.css'), 'utf8');

/** The declarations inside the first block whose prelude is exactly `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No block ${selector}`);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = css.slice(css.indexOf('{', start) + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const appTheme = { ...block(TOKENS, '@theme static'), ...block(TOKENS, '@theme inline') };
const appDark = block(TOKENS, ':root[data-theme="dark"]');
const siteTheme = block(SITE, '@theme static');
const THEMES = {
  light: { ...appTheme, ...siteTheme, ...block(SITE, ":root:not([data-theme='dark'])") },
  dark: { ...appTheme, ...appDark, ...siteTheme, ...block(SITE, ":root[data-theme='dark']") },
} as const;

function colour(theme: keyof typeof THEMES, name: string) {
  let value = THEMES[theme][`--color-${name}`];
  for (let hops = 0; value?.startsWith('var('); hops++) {
    if (hops > 5) throw new Error(`--color-${name} loops`);
    value = THEMES[theme][/var\((--[\w-]+)\)/.exec(value)![1]!];
  }
  const parsed = value ? parseOklch(value) : undefined;
  if (!parsed) throw new Error(`--color-${name} is not an OKLCH colour in ${theme}: ${value}`);
  expect(parsed.alpha, `${name} is opaque`).toBe(1);
  return parsed;
}

const SURFACES = ['canvas', 'raised', 'overlay', 'panel', 'well', 'sunken', 'sidebar', 'sidebar-hover', 'bubble', 'chip', 'control', 'control-hover', 'hover', 'sticker-paper'];
const JOBS = ['violet', 'rose', 'teal', 'marigold'];
const KINDS = ['sky', 'lime', 'coral', 'orchid', 'success', 'warning', 'danger', 'info'];
const STICKERS = ['pink', 'violet', 'teal', 'marigold', 'sky', 'lime', 'paper'];

type Pair = readonly [fg: string, bg: string, min: number];

const TEXT_PAIRS: readonly Pair[] = [
  ...SURFACES.flatMap((s) => ['ink', 'ink-2', 'ink-3'].map((i): Pair => [i, s, AA.text])),
  ['on-inverse', 'inverse', AA.text],
  ['on-tooltip', 'tooltip', AA.text],
  ['viewer-ink', 'viewer', AA.text],
  ['viewer-ink-2', 'viewer', AA.text],
  ...[...JOBS, ...KINDS].flatMap((j): Pair[] => [
    ...['canvas', 'raised', 'panel', 'sunken', 'sidebar'].map((s): Pair => [`${j}-strong`, s, AA.text]),
    [`${j}-strong`, `${j}-soft`, AA.text],
    ['ink', `${j}-soft`, AA.text],
    [`${j}-ink`, j, AA.text],
    [`${j}-strong-ink`, `${j}-strong`, AA.text],
  ]),
  ['marigold-ink', 'marigold-hover', AA.text],
  ...STICKERS.map((s): Pair => [`sticker-${s}-ink`, `sticker-${s}`, AA.text]),
];

const UI_PAIRS: readonly Pair[] = [
  ...['canvas', 'raised', 'panel', 'sunken', 'sidebar'].map((s): Pair => ['focus', s, AA.ui]),
  ['rule-strong', 'canvas', AA.ui],
  ['rule-strong', 'raised', AA.ui],
  // Graphics that carry a job: the AI's mark, the rose beat ticks, the teal "yours" marks.
  ['violet', 'canvas', AA.ui],
  ['rose', 'canvas', AA.ui],
  ['teal', 'canvas', AA.ui],
];

describe('the WEB2 tokens', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`hold every text pair to AA in ${theme}`, () => {
      const failing = TEXT_PAIRS.map(([fg, bg, min]) => ({ pair: `${fg} on ${bg}`, ratio: contrast(colour(theme, fg), colour(theme, bg)), min })).filter(
        (p) => p.ratio < p.min,
      );
      expect(failing).toEqual([]);
    });

    it(`hold every control and graphic pair to 3:1 in ${theme}`, () => {
      const failing = UI_PAIRS.map(([fg, bg, min]) => ({ pair: `${fg} on ${bg}`, ratio: contrast(colour(theme, fg), colour(theme, bg)), min })).filter(
        (p) => p.ratio < p.min,
      );
      expect(failing).toEqual([]);
    });
  }

  it('grounds light in white and dark in a true near-black', () => {
    expect(colour('light', 'canvas').l).toBe(1);
    expect(colour('dark', 'canvas').l).toBeLessThan(0.16);
    expect(colour('light', 'ink').l).toBeLessThan(0.2);
  });

  it('gives every sticker field and colour job a dark value of its own', () => {
    const dark = block(SITE, ":root[data-theme='dark']");
    for (const s of STICKERS) expect(dark[`--color-sticker-${s}`], s).toBeDefined();
    for (const j of JOBS) for (const step of ['', '-strong', '-soft', '-ink', '-strong-ink']) expect(dark[`--color-${j}${step}`], `${j}${step}`).toBeDefined();
  });

  it('reads a pair the way a browser paints it', () => {
    const white = parseOklch('oklch(100% 0 0)')!;
    const black = parseOklch('oklch(0% 0 0)')!;
    expect(contrast(white, black)).toBeCloseTo(21, 1);
    expect(contrast(white, white)).toBe(1);
    expect(parseOklch('oklch(0.5 0.1 120 / 50%)')).toEqual({ l: 0.5, c: 0.1, h: 120, alpha: 0.5 });
    expect(parseOklch('#fff')).toBeUndefined();
  });
});
