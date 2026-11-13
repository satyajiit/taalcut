// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bundled Regular OFL faces for font match. Outlines are unmodified, so a
 * Reserved Font Name is recorded and the file is still shipped: we did not
 * make a derivative.
 *
 * `captionFont` is true only for ids in core's CAPTION_FONTS. These eleven are
 * scored but cannot be stored on a Style until core extends that enum:
 * inter, sourceSans3, sourceSerif4, lora, merriweather, libreFranklin, nunito,
 * ibmPlexSans, tiroDevanagariHindi, martel, kalam.
 *
 * The fonts directory is a parameter: `packageFontsDir()` is the checkout's copy
 * (tests, development). Bundled code cannot find it from its own URL, so the
 * desktop passes the copy it ships, as it does for render's caption fonts.
 */
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, CAPTION_FONTS, err, ok, type Result } from '@taalcut/core';
import { FontRenderFailed } from './errors';
import { type FontScript } from './script';

/** packages/vision/fonts in a checkout. Not valid inside a bundle: pass the shipped directory there. */
export function packageFontsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fonts');
}

export interface CatalogueEntry {
  readonly id: string;
  readonly family: string;
  readonly script: FontScript;
  readonly file: string;
  readonly licenceFile: string;
  readonly captionFont: boolean;
}

/** A catalogue entry plus the Reserved Font Name scanned from its OFL header, if any. */
export interface FontFace extends CatalogueEntry {
  readonly reservedName: string | null;
}

interface Spec {
  readonly id: string;
  readonly family: string;
  readonly script: FontScript;
  readonly fileName: string;
}

const SPECS: readonly Spec[] = [
  { id: 'notoSans', family: 'Noto Sans', script: 'latin', fileName: 'NotoSans-Regular.ttf' },
  {
    id: 'notoSansDevanagari',
    family: 'Noto Sans Devanagari',
    script: 'devanagari',
    fileName: 'NotoSansDevanagari-Regular.ttf',
  },
  { id: 'poppins', family: 'Poppins', script: 'latin', fileName: 'Poppins-Regular.ttf' },
  { id: 'mukta', family: 'Mukta', script: 'devanagari', fileName: 'Mukta-Regular.ttf' },
  { id: 'hind', family: 'Hind', script: 'devanagari', fileName: 'Hind-Regular.ttf' },
  { id: 'baloo2', family: 'Baloo 2', script: 'devanagari', fileName: 'Baloo2-Regular.ttf' },
  { id: 'montserrat', family: 'Montserrat', script: 'latin', fileName: 'Montserrat-Regular.ttf' },
  { id: 'anton', family: 'Anton', script: 'latin', fileName: 'Anton-Regular.ttf' },
  { id: 'bebasNeue', family: 'Bebas Neue', script: 'latin', fileName: 'BebasNeue-Regular.ttf' },
  { id: 'inter', family: 'Inter', script: 'latin', fileName: 'Inter-Regular.ttf' },
  { id: 'sourceSans3', family: 'Source Sans 3', script: 'latin', fileName: 'SourceSans3-Regular.ttf' },
  { id: 'sourceSerif4', family: 'Source Serif 4', script: 'latin', fileName: 'SourceSerif4-Regular.ttf' },
  { id: 'lora', family: 'Lora', script: 'latin', fileName: 'Lora-Regular.ttf' },
  { id: 'merriweather', family: 'Merriweather', script: 'latin', fileName: 'Merriweather-Regular.ttf' },
  { id: 'libreFranklin', family: 'Libre Franklin', script: 'latin', fileName: 'LibreFranklin-Regular.ttf' },
  { id: 'nunito', family: 'Nunito', script: 'latin', fileName: 'Nunito-Regular.ttf' },
  { id: 'ibmPlexSans', family: 'IBM Plex Sans', script: 'latin', fileName: 'IBMPlexSans-Regular.ttf' },
  {
    id: 'tiroDevanagariHindi',
    family: 'Tiro Devanagari Hindi',
    script: 'devanagari',
    fileName: 'TiroDevanagariHindi-Regular.ttf',
  },
  { id: 'martel', family: 'Martel', script: 'devanagari', fileName: 'Martel-Regular.ttf' },
  { id: 'kalam', family: 'Kalam', script: 'devanagari', fileName: 'Kalam-Regular.ttf' },
];

function isCaptionFont(id: string): boolean {
  for (const font of CAPTION_FONTS) if (font === id) return true;
  return false;
}

/** Paths only, under `fontsDir`. Missing files are reported by `loadCatalogue`. */
export function fontCatalogue(fontsDir: string = packageFontsDir()): readonly CatalogueEntry[] {
  return SPECS.map((spec) => ({
    id: spec.id,
    family: spec.family,
    script: spec.script,
    file: join(fontsDir, 'files', spec.fileName),
    licenceFile: join(fontsDir, 'licences', `OFL-${spec.id}.txt`),
    captionFont: isCaptionFont(spec.id),
  }));
}

/** Absolute path of a bundled face. Throws if `id` is not in the catalogue (a caller bug). */
export function fontFile(id: string, fontsDir: string = packageFontsDir()): string {
  const entry = fontCatalogue(fontsDir).find((face) => face.id === id);
  if (!entry) throw new RangeError(`No bundled font '${id}'`);
  return entry.file;
}

const QUOTED = /["'‘“]([^"'‘’“”]+)["'’”]/gu;

/** Names declared after the header's Reserved Font Name phrase, before the licence body. */
export function reservedNameOf(licence: string): string | null {
  const header = licence.split(/SIL Open Font License/i)[0] ?? licence;
  const at = header.search(/Reserved Font Name/i);
  if (at < 0) return null;
  const names: string[] = [];
  for (const match of header.slice(at).matchAll(QUOTED)) {
    const name = match[1]?.trim();
    if (name) names.push(name);
  }
  return names.length > 0 ? names.join(', ') : null;
}

function isSfnt(head: Buffer): boolean {
  const b0 = head[0] ?? -1;
  const b1 = head[1] ?? -1;
  const b2 = head[2] ?? -1;
  const b3 = head[3] ?? -1;
  if (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return true;
  const tag = String.fromCharCode(b0, b1, b2, b3);
  return tag === 'OTTO' || tag === 'true' || tag === 'typ1';
}

function sfntMagic(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(4);
    const n = readSync(fd, head, 0, 4, 0);
    return n === 4 && isSfnt(head);
  } finally {
    closeSync(fd);
  }
}

function fileSize(path: string): number | null {
  try {
    const info = statSync(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function checkFace(entry: CatalogueEntry): Result<FontFace> {
  const size = fileSize(entry.file);
  if (size === null) return err(FontRenderFailed(undefined, { detail: `missing font file: ${entry.id}` }));
  if (size < 1024) return err(FontRenderFailed(undefined, { detail: `trivial font file: ${entry.id}` }));
  try {
    if (!sfntMagic(entry.file))
      return err(FontRenderFailed(undefined, { detail: `not an sfnt font: ${entry.id}` }));
  } catch {
    return err(FontRenderFailed(undefined, { detail: `unreadable font file: ${entry.id}` }));
  }
  const licence = readText(entry.licenceFile);
  if (licence === null) return err(FontRenderFailed(undefined, { detail: `missing licence: ${entry.id}` }));
  if (!licence.includes('SIL Open Font License')) {
    return err(FontRenderFailed(undefined, { detail: `licence is not OFL: ${entry.id}` }));
  }
  return ok({ ...entry, reservedName: reservedNameOf(licence) });
}

/** Stat each file under `fontsDir`, check the sfnt magic, and read the OFL header. No glyph cache. */
export function loadCatalogue(fontsDir: string = packageFontsDir()): Result<readonly FontFace[]> {
  return all(fontCatalogue(fontsDir).map(checkFace));
}
