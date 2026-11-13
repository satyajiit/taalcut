// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The curated fonts: pinned files match the lock, coverage.json matches the files, stacks and lookup. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTION_FONTS } from '@taalcut/core';
import coverage from '../../fonts/coverage.json';
import {
  CAPTION_FONT_FILES,
  createCompositionFonts,
  fileForWeight,
  fontCovers,
  fontFacesFor,
  fontStack,
  resolveFontDir,
} from '../../src/captions/fonts';
import { FONTS_DIR, testMeasurer } from '../support/fonts';

describe('bundled caption fonts', () => {
  it('every pinned file is present with its size and sha256, and is OFL-1.1 with its licence text', () => {
    let total = 0;
    for (const entry of CAPTION_FONT_FILES) {
      const data = readFileSync(join(FONTS_DIR, entry.file));
      total += data.length;
      expect(data.length, entry.file).toBe(entry.size);
      expect(createHash('sha256').update(data).digest('hex'), entry.file).toBe(entry.sha256);
      expect(entry.spdx).toBe('OFL-1.1');
      expect(readFileSync(join(FONTS_DIR, entry.licenceFile), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    }
    // About 12 MB with the COLRv1 emoji font.
    expect(total).toBeLessThan(13_000_000);
  });

  it('has a file for every curated font, and coverage.json was generated from these very files', () => {
    const fonts = coverage.fonts as Record<string, { files: { file: string; sha256: string }[] }>;
    for (const font of [...CAPTION_FONTS, 'notoColorEmoji']) {
      const files = CAPTION_FONT_FILES.filter((entry) => entry.fontId === font);
      expect(files.length, font).toBeGreaterThan(0);
      expect(fonts[font]?.files).toEqual(files.map((entry) => ({ file: entry.file, sha256: entry.sha256 })));
    }
  });

  it('knows what each font covers', () => {
    expect(fontCovers('mukta', 'क'.codePointAt(0)!)).toBe(true);
    expect(fontCovers('montserrat', 'क'.codePointAt(0)!)).toBe(false);
    expect(fontCovers('notoColorEmoji', '😀'.codePointAt(0)!)).toBe(true);
    expect(fontCovers('notoSans', 'த'.codePointAt(0)!)).toBe(false);
    for (const font of CAPTION_FONTS)
      for (const char of 'ñãõçâêô¿¡') expect(fontCovers(font, char.codePointAt(0)!), font).toBe(true);
  });

  it('ends every stack in the Noto fallbacks and lists their faces', () => {
    expect(fontStack('anton')).toEqual(['Anton', 'Noto Sans', 'Noto Sans Devanagari', 'Noto Color Emoji']);
    expect(fontStack('notoSans')).toEqual(['Noto Sans', 'Noto Sans Devanagari', 'Noto Color Emoji']);
    const faces = fontFacesFor(['poppins']);
    expect(faces.map((face) => face.file)).toEqual(
      expect.arrayContaining(['Poppins-ExtraBold.ttf', 'NotoSans-Variable.ttf', 'Noto-COLRv1.ttf']),
    );
    expect(faces.some((face) => face.family === 'Anton')).toBe(false);
  });

  it('picks the file CSS font matching would pick', () => {
    expect(fileForWeight('poppins', 800).entry.file).toBe('Poppins-ExtraBold.ttf');
    expect(fileForWeight('mukta', 600).entry.file).toBe('Mukta-Bold.ttf');
    expect(fileForWeight('hind', 800).entry.file).toBe('Hind-Bold.ttf');
    expect(fileForWeight('hind', 300).entry.file).toBe('Hind-Regular.ttf');
    expect(fileForWeight('poppins', 450).entry.file).toBe('Poppins-Regular.ttf');
    expect(fileForWeight('baloo2', 900)).toMatchObject({ weight: 800 });
    expect(fileForWeight('montserrat', 650)).toMatchObject({
      entry: { file: 'Montserrat-Variable.ttf' },
      weight: 650,
    });
  });

  it('resolves the font folder: explicit, bundled, then the checkout', async () => {
    expect(resolveFontDir({ development: true })).toEqual({ ok: true, value: FONTS_DIR });
    expect(resolveFontDir({ bundledDir: FONTS_DIR, development: false })).toEqual({
      ok: true,
      value: FONTS_DIR,
    });
    const missing = resolveFontDir({ explicit: '/nonexistent', development: false });
    expect(missing).toMatchObject({ ok: false, error: { code: 'render.font_missing' } });
    const fonts = createCompositionFonts(FONTS_DIR, await testMeasurer());
    expect(fonts.dir).toBe(FONTS_DIR);
    expect(fonts.stack('mukta')[0]).toBe('Mukta');
    expect(fonts.faces(['mukta']).length).toBeGreaterThan(3);
  });
});
