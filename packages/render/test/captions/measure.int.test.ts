// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shaping matches Chrome (SPEC section 14, P2-M5): harfbuzzjs widths over
 * the bundled fonts are within 1 px of what the pinned headless shell lays
 * out for the golden strings in every language. Needs the shell; skips with
 * a message without it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPTION_FONT_FILES } from '../../src/captions/fonts';
import type { CaptionFontId } from '../../src/types';
import { FONTS_DIR, GOLDEN, testMeasurer } from '../support/fonts';
import { findTestShell } from '../support/shell';

const shell = findTestShell('measure.int');

const CASES: readonly {
  font: CaptionFontId;
  weight: number;
  size: number;
  texts: (keyof typeof GOLDEN)[];
}[] = [
  { font: 'poppins', weight: 800, size: 72, texts: ['en', 'es', 'pt', 'hi', 'hinglish', 'emoji'] },
  { font: 'mukta', weight: 700, size: 72, texts: ['hi', 'hinglish', 'en', 'emoji'] },
  { font: 'hind', weight: 600, size: 64, texts: ['hi', 'pt'] },
  { font: 'notoSans', weight: 400, size: 64, texts: ['en', 'es', 'pt', 'hinglish'] },
  { font: 'notoSansDevanagari', weight: 700, size: 80, texts: ['hi'] },
  { font: 'montserrat', weight: 600, size: 70, texts: ['en', 'es', 'hinglish'] },
  { font: 'baloo2', weight: 700, size: 72, texts: ['hi', 'en'] },
  { font: 'anton', weight: 400, size: 96, texts: ['en', 'pt'] },
  { font: 'bebasNeue', weight: 400, size: 96, texts: ['es'] },
];

function fontFaces(): string {
  return CAPTION_FONT_FILES.map((entry) => {
    const url = pathToFileURL(join(FONTS_DIR, entry.file)).href;
    return `@font-face { font-family: "${entry.family}"; src: url("${url}"); font-weight: ${entry.weight}; }`;
  }).join('\n');
}

/** Runs in the page (a string, as in engine/capture.ts, since this package has no DOM types): Chrome's width. */
const measureScript = (font: string, text: string) => `(async () => {
  const font = ${JSON.stringify(font)}, text = ${JSON.stringify(text)};
  await document.fonts.load(font, text);
  const span = document.createElement('span');
  span.style.font = font;
  span.textContent = text;
  document.body.append(span);
  const width = span.getBoundingClientRect().width;
  span.remove();
  return width;
})()`;

describe.skipIf(!shell.path)('harfbuzzjs measurement against the pinned shell', () => {
  let browser: Browser;
  let dir: string;
  let page: Awaited<ReturnType<Browser['newPage']>>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-measure-'));
    await writeFile(
      join(dir, 'index.html'),
      `<!doctype html><meta charset="utf-8"><style>${fontFaces()}\nspan{white-space:pre;display:inline-block}</style><body></body>`,
    );
    browser = await puppeteer.launch({
      executablePath: shell.path!,
      headless: true,
      args: ['--allow-file-access-from-files', '--no-first-run', '--font-render-hinting=none'],
    });
    page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, 'index.html')).href);
  });

  afterAll(async () => {
    await browser?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('every golden string is within 1 px of Chrome in every curated font', async () => {
    const measurer = await testMeasurer();
    const stack = (font: CaptionFontId) =>
      [font, 'notoSans', 'notoSansDevanagari']
        .map((key) => CAPTION_FONT_FILES.find((entry) => entry.fontId === key)!.family)
        .concat('Noto Color Emoji')
        .map((family) => `"${family}"`)
        .join(', ');
    for (const { font, weight, size, texts } of CASES) {
      for (const key of texts) {
        const text = GOLDEN[key];
        const chrome = (await page.evaluate(
          measureScript(`${weight} ${size}px ${stack(font)}`, text),
        )) as number;
        const ours = measurer.measure(text, font, weight, size).width;
        const label = `${font} ${weight} ${size}px ${key}: chrome ${chrome.toFixed(2)}, harfbuzz ${ours.toFixed(2)}`;
        expect(Math.abs(chrome - ours), label).toBeLessThanOrEqual(1);
      }
    }
  });
});
