// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Twenty OFL Regular faces, nine of them caption fonts. */
import { readFileSync } from 'node:fs';
import { CAPTION_FONTS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { fontCatalogue, loadCatalogue, packageFontsDir } from '../../src/fonts/catalogue';

const FONT_CATALOGUE = fontCatalogue();

const EXTRA = [
  'inter',
  'sourceSans3',
  'sourceSerif4',
  'lora',
  'merriweather',
  'libreFranklin',
  'nunito',
  'ibmPlexSans',
  'tiroDevanagariHindi',
  'martel',
  'kalam',
] as const;

describe('font catalogue', () => {
  it('lists 20 faces, 9 of them caption fonts, each with an OFL file', () => {
    expect(FONT_CATALOGUE).toHaveLength(20);
    expect(new Set(FONT_CATALOGUE.map((face) => face.id)).size).toBe(20);
    const loaded = loadCatalogue();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(20);
    expect(loaded.value.filter((face) => face.captionFont)).toHaveLength(9);
    for (const face of loaded.value) {
      expect(face.captionFont).toBe(CAPTION_FONTS.some((id) => id === face.id));
      const licence = readFileSync(face.licenceFile, 'utf8');
      expect(licence).toContain('SIL Open Font License');
      expect(face.file.endsWith('.ttf') || face.file.endsWith('.otf')).toBe(true);
    }
    for (const id of CAPTION_FONTS) expect(FONT_CATALOGUE.some((face) => face.id === id)).toBe(true);
    for (const id of EXTRA) {
      const face = FONT_CATALOGUE.find((entry) => entry.id === id);
      expect(face?.captionFont).toBe(false);
    }
  });

  it('records a Reserved Font Name only when the OFL header declares one', () => {
    const loaded = loadCatalogue();
    if (!loaded.ok) throw new Error(loaded.error.code);
    const name = (id: string): string | null =>
      loaded.value.find((face) => face.id === id)?.reservedName ?? null;
    expect(name('lora')).toBe('Lora');
    expect(name('ibmPlexSans')).toBe('Plex');
    expect(name('sourceSans3')).toBe('Source');
    expect(name('sourceSerif4')).toBe('Source');
    expect(name('merriweather')).toBe('Merriweather');
    expect(name('martel')).toBe('Merriweather');
    expect(name('poppins')).toBeNull();
    expect(name('inter')).toBeNull();
  });

  it('reads the directory it is given and reports a missing one as a value', () => {
    const elsewhere = fontCatalogue('/opt/Taalcut.app/Contents/Resources/vision-fonts');
    expect(
      elsewhere.every((face) =>
        face.file.startsWith('/opt/Taalcut.app/Contents/Resources/vision-fonts/files/'),
      ),
    ).toBe(true);
    expect(fontCatalogue(packageFontsDir())).toEqual(FONT_CATALOGUE);
    const missing = loadCatalogue('/nonexistent/vision-fonts');
    expect(missing.ok ? '' : missing.error.code).toBe('vision.font_render_failed');
  });
});
