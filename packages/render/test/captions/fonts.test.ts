// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The curated fonts: pinned files match the lock, coverage.json matches the files, stacks and lookup. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTION_FONTS, newId } from '@taalcut/core';
import coverage from '../../fonts/coverage.json';
import {
  CAPTION_FONT_FILES,
  createCompositionFonts,
  fileForWeight,
  FONT_CATEGORIES,
  FONT_CATEGORY,
  fontCovers,
  fontFacesFor,
  fontStack,
  resolveFontDir,
} from '../../src/captions/fonts';
import { fontFor } from '../../src/captions/style';
import { captionToolModule } from '../../src/tools/caption-tools';
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
    // About 14.5 MB with the COLRv1 emoji font (5 MB) and TXT1's six faces (2.3 MB).
    expect(total).toBeLessThan(15_000_000);
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

  it('TXT1: has a serif, a light serif, a condensed face with weights, two scripts and a typewriter face', () => {
    expect(FONT_CATEGORY).toMatchObject({
      playfairDisplay: 'serif',
      cormorantGaramond: 'serif',
      oswald: 'condensed',
      caveat: 'script',
      dancingScript: 'script',
      courierPrime: 'mono',
    });
    // Every face is in a category the list names, and no category is empty.
    for (const font of CAPTION_FONTS) expect(FONT_CATEGORIES, font).toContain(FONT_CATEGORY[font]);
    for (const category of FONT_CATEGORIES)
      expect(
        CAPTION_FONTS.some((font) => FONT_CATEGORY[font] === category),
        category,
      ).toBe(true);
    // The weights each file serves, as its own fvar axis has them.
    expect(fileForWeight('playfairDisplay', 900)).toMatchObject({
      entry: { file: 'PlayfairDisplay-Variable.ttf' },
      weight: 900,
    });
    expect(fileForWeight('playfairDisplay', 300)).toMatchObject({ weight: 400 });
    expect(fileForWeight('cormorantGaramond', 300)).toMatchObject({
      entry: { file: 'CormorantGaramond-Variable.ttf' },
      weight: 300,
    });
    expect(fileForWeight('cormorantGaramond', 900)).toMatchObject({ weight: 700 });
    expect(fileForWeight('oswald', 200)).toMatchObject({
      entry: { file: 'Oswald-Variable.ttf' },
      weight: 200,
    });
    expect(fileForWeight('oswald', 800)).toMatchObject({ weight: 700 });
    expect(fileForWeight('caveat', 700)).toMatchObject({
      entry: { file: 'Caveat-Variable.ttf' },
      weight: 700,
    });
    expect(fileForWeight('dancingScript', 600)).toMatchObject({
      entry: { file: 'DancingScript-Variable.ttf' },
      weight: 600,
    });
    expect(fileForWeight('courierPrime', 400).entry.file).toBe('CourierPrime-Regular.ttf');
    expect(fileForWeight('courierPrime', 800).entry.file).toBe('CourierPrime-Bold.ttf');
    // Latin faces: another script falls through the stack to the Noto fallbacks.
    expect(fontStack('playfairDisplay')).toEqual([
      'Playfair Display',
      'Noto Sans',
      'Noto Sans Devanagari',
      'Noto Color Emoji',
    ]);
    expect(fontCovers('courierPrime', 'क'.codePointAt(0)!)).toBe(false);
    // A category's face for a script: its own first face in Latin; the nearest category with one in Devanagari.
    expect(fontFor('serif', 'latin')).toBe('playfairDisplay');
    expect(fontFor('script', 'latin')).toBe('caveat');
    expect(fontFor('mono', 'latin')).toBe('courierPrime');
    expect(fontFor('condensed', 'latin')).toBe('anton');
    expect(fontFor('serif', 'devanagari')).toBe('mukta');
    expect(fontFor('script', 'devanagari')).toBe('baloo2');
    expect(fontFor('mono', 'devanagari')).toBe('notoSans');
  });

  it('TXT1: captions.setStyle takes the six new faces, at 1.1.0; the other caption tools are as they were', () => {
    const tools = captionToolModule().tools;
    const setStyle = tools.find((tool) => tool.name === 'captions.setStyle')!;
    expect(setStyle.version).toBe('1.1.0');
    const ids = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
    for (const font of [
      'playfairDisplay',
      'cormorantGaramond',
      'oswald',
      'caveat',
      'dancingScript',
      'courierPrime',
    ])
      expect(setStyle.input.safeParse({ ...ids, style: { font } }).success, font).toBe(true);
    expect(setStyle.input.safeParse({ ...ids, style: { font: 'comicSans' } }).success).toBe(false);
    const others = tools.filter((tool) => tool.name !== 'captions.setStyle');
    expect(others.map((tool) => tool.version)).toEqual(['1.0.0', '1.0.0', '1.0.0']);
  });
});
