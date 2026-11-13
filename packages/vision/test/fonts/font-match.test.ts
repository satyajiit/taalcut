// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Ten fixtures drawn by the fake renderer (not Core Text, no network).
 * Each bundled file must rank first against its own rendering.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CAPTION_FONTS, err, ok, type AsyncResult } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fontFile } from '../../src/fonts/catalogue';
import { FontMatchWithheld, FontRenderFailed } from '../../src/fonts/errors';
import { matchFonts, toFontMatch, type FontSuggestionList } from '../../src/fonts/font-match';
import {
  type TextRenderRequest,
  type TextRenderResult,
  type TextRenderer,
} from '../../src/fonts/text-renderer';

const FIXTURES: readonly { readonly id: string; readonly text: string }[] = [
  { id: 'notoSans', text: 'Hello' },
  { id: 'poppins', text: 'Caption' },
  { id: 'montserrat', text: 'Style' },
  { id: 'anton', text: 'TITLE' },
  { id: 'bebasNeue', text: 'SALE' },
  { id: 'inter', text: 'Inter face' },
  { id: 'sourceSans3', text: 'Source' },
  { id: 'lora', text: 'Serif' },
  { id: 'mukta', text: 'नमस्ते' },
  { id: 'hind', text: 'हिंदी' },
];

/**
 * Grayscale depends on a hash of the font bytes plus the string, so two files differ
 * and the same file+string is stable. Vertical stripes keep every ink row equal, so
 * x-height alignment of a face against itself stays at scale 1.
 */
function createFakeTextRenderer(): { readonly renderer: TextRenderer; readonly calls: { n: number } } {
  const calls = { n: 0 };
  const renderer: TextRenderer = {
    async render(request: TextRenderRequest, signal?: AbortSignal): AsyncResult<TextRenderResult> {
      calls.n += 1;
      if (signal?.aborted) return err(FontRenderFailed(undefined, { detail: 'aborted' }));
      if (request.pixelHeight < 24 || request.pixelHeight > 256) {
        return err(FontRenderFailed(undefined, { detail: 'pixelHeight out of range' }));
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(request.fontFile);
      } catch {
        return err(FontRenderFailed(undefined, { detail: 'font file unreadable' }));
      }
      const digest = createHash('sha256').update(bytes).update('\0').update(request.string).digest();
      const seed = (digest.readUInt32BE(0) ^ digest.readUInt32BE(4)) >>> 0;
      const pad = 2;
      const cols = Math.min(64, Math.max(16, 8 + Array.from(request.string).length * 2));
      const width = cols + pad * 2;
      const height = request.pixelHeight;
      const bg = request.polarity === 'darkOnLight' ? 255 : 0;
      const ink = 255 - bg;
      const gray = new Uint8Array(width * height);
      gray.fill(bg);
      for (let col = 0; col < cols; col++) {
        if (!columnOn(seed, col, cols)) continue;
        for (let row = 0; row < height - pad * 2; row++) gray[(pad + row) * width + (pad + col)] = ink;
      }
      const inkHeight = height - pad * 2;
      return ok({
        gray,
        width,
        height,
        ascent: inkHeight,
        descent: 0,
        xHeight: inkHeight,
        inkBox: { x: pad, y: pad, width: cols, height: inkHeight },
      });
    },
  };
  return { renderer, calls };
}

function columnOn(seed: number, col: number, cols: number): boolean {
  if (col === 0 || col === cols - 1) return true;
  let x = Math.imul(seed ^ col, 0x9e3779b9) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return (x & 1) === 1;
}

describe('matchFonts', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ranks the drawing font first on each of 10 fixtures and does not fetch', async () => {
    const { renderer } = createFakeTextRenderer();
    const winners: { id: string; score: number }[] = [];
    for (const fixture of FIXTURES) {
      const drawn = await renderer.render({
        string: fixture.text,
        fontFile: fontFile(fixture.id),
        pixelHeight: 48,
        polarity: 'darkOnLight',
      });
      if (!drawn.ok) throw new Error(drawn.error.code);
      const matched = await matchFonts(
        {
          text: fixture.text,
          ocrConfidence: 0.95,
          crop: { gray: drawn.value.gray, width: drawn.value.width, height: drawn.value.height },
        },
        { renderer },
      );
      if (!matched.ok) throw new Error(matched.error.code);
      const top = matched.value.ranking[0];
      if (!top) throw new Error('empty ranking');
      expect(top.family, fixture.id).toBe(fixture.id);
      expect(top.score).toBe(1);
      winners.push({ id: top.family, score: top.score });
      const devanagari = fixture.id === 'mukta' || fixture.id === 'hind';
      expect(matched.value.script).toBe(devanagari ? 'devanagari' : 'latin');
      expect(matched.value.ranking.length).toBe(devanagari ? 7 : 13);
    }
    expect(winners).toHaveLength(10);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('stores inter, the honest winner, with the best caption font for captions to draw', async () => {
    const { renderer } = createFakeTextRenderer();
    const drawn = await renderer.render({
      string: 'Inter face',
      fontFile: fontFile('inter'),
      pixelHeight: 48,
      polarity: 'darkOnLight',
    });
    if (!drawn.ok) throw new Error(drawn.error.code);
    const matched = await matchFonts(
      {
        text: 'Inter face',
        ocrConfidence: 0.95,
        crop: { gray: drawn.value.gray, width: drawn.value.width, height: drawn.value.height },
      },
      { renderer },
    );
    if (!matched.ok) throw new Error(matched.error.code);
    expect(matched.value.ranking[0]?.family).toBe('inter');
    expect(matched.value.ranking[0]?.captionFont).toBe(false);
    const stored = toFontMatch(matched.value);
    if (!stored) throw new Error('toFontMatch returned null');
    const bestCaption = matched.value.ranking.find((row) => row.captionFont);
    expect(stored.family).toBe('inter');
    expect(stored.score).toBeCloseTo(1, 6);
    expect(stored.captionFont).toBe('notoSans');
    expect(stored.captionFont).toBe(bestCaption?.family);
    expect(CAPTION_FONTS.some((id) => id === stored.captionFont)).toBe(true);
    // The top five of every face, best first, the winner included.
    expect(stored.ranking.map((row) => row.family)).toEqual(
      matched.value.ranking.slice(0, 5).map((row) => row.family),
    );
    expect(stored.metric).toBe('ssim');
  });

  it('stores a caption font winner as its own caption font', () => {
    const list: FontSuggestionList = {
      script: 'latin',
      sampleText: 'Hello',
      ocrConfidence: 0.9,
      ranking: [
        { family: 'poppins', familyName: 'Poppins', score: 0.9, captionFont: true },
        { family: 'inter', familyName: 'Inter', score: 0.8, captionFont: false },
        { family: 'notoSans', familyName: 'Noto Sans', score: 0.7, captionFont: true },
      ],
    };
    expect(toFontMatch(list)).toMatchObject({ family: 'poppins', captionFont: 'poppins', score: 0.9 });
  });

  it('returns null when the ranking has no caption font', () => {
    const list: FontSuggestionList = {
      script: 'latin',
      sampleText: 'Inter',
      ocrConfidence: 0.9,
      ranking: [{ family: 'inter', familyName: 'Inter', score: 0.4, captionFont: false }],
    };
    expect(toFontMatch(list)).toBeNull();
  });

  it('withholds a low-confidence string without rendering', async () => {
    const { renderer, calls } = createFakeTextRenderer();
    const crop = { gray: new Uint8Array(40 * 48), width: 40, height: 48 };
    const withheld = await matchFonts({ text: 'Hello', ocrConfidence: 0.5, crop }, { renderer });
    expect(withheld.ok).toBe(false);
    if (withheld.ok) return;
    expect(FontMatchWithheld.is(withheld.error)).toBe(true);
    expect(withheld.error.params).toEqual({ ocrConfidence: 0.5 });
    expect(calls.n).toBe(0);
  });

  it('withholds a crop shorter than 32 px without rendering', async () => {
    const { renderer, calls } = createFakeTextRenderer();
    const crop = { gray: new Uint8Array(40 * 31), width: 40, height: 31 };
    const withheld = await matchFonts({ text: 'Hello', ocrConfidence: 0.95, crop }, { renderer });
    expect(withheld.ok).toBe(false);
    if (withheld.ok) return;
    expect(FontMatchWithheld.is(withheld.error)).toBe(true);
    expect(calls.n).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('loads the catalogue from the fonts directory it is given', async () => {
    const { renderer, calls } = createFakeTextRenderer();
    const crop = { gray: new Uint8Array(40 * 48).fill(255), width: 40, height: 48 };
    const missing = await matchFonts(
      { text: 'Hello', ocrConfidence: 0.95, crop },
      { renderer, fontsDir: '/nonexistent/vision-fonts' },
    );
    expect(missing.ok ? '' : missing.error.code).toBe('vision.font_render_failed');
    expect(calls.n).toBe(0);
  });
});
