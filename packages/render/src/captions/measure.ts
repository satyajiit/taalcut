// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * createTextMeasurer: shaped text widths with harfbuzzjs over the bundled
 * fonts, the shaping engine Chrome itself uses. Text is split into runs the
 * way Chrome falls back: each grapheme goes to the first font in the stack
 * that has every code point it needs (emoji graphemes to the emoji font),
 * and each run is shaped on its own. A first guess for cue grouping; the DOM
 * probe in the real render is the authority (qa-gate.md).
 *
 * harfbuzzjs instantiates its WASM on import, so it is imported here, on
 * first use, never when the package loads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as harfbuzz from 'harfbuzzjs';
import type { CaptionFontId, TextMeasure, TextMeasurer } from '../types';
import { fileForWeight, fontCovers, stackKeys, type FontFileEntry, type FontKey } from './fonts';
import { codepoints, graphemes, isEmojiGrapheme, isIgnorable } from './text';

type HarfBuzz = typeof harfbuzz;
type HbFont = InstanceType<HarfBuzz['Font']>;

interface LoadedFont {
  readonly font: HbFont;
  readonly upem: number;
  /** Ascender and descender in font units (descender positive, below the baseline). */
  readonly ascender: number;
  readonly descender: number;
}

export interface MeasuredRun {
  readonly text: string;
  readonly font: FontKey;
  readonly width: number;
}

/** A TextMeasurer that also reports its runs, for tests and the measurement comparison. */
export interface DetailedTextMeasurer extends TextMeasurer {
  runs(text: string, font: CaptionFontId, weight: number, sizePx: number): readonly MeasuredRun[];
}

/** Which font in the stack draws a grapheme. */
export function fontForGrapheme(grapheme: string, stack: readonly FontKey[]): FontKey {
  const needed = codepoints(grapheme).filter((cp) => !isIgnorable(cp));
  if (needed.length === 0) return stack[0]!;
  if (isEmojiGrapheme(grapheme) && needed.every((cp) => fontCovers('notoColorEmoji', cp)))
    return 'notoColorEmoji';
  const full = stack.find((font) => needed.every((cp) => fontCovers(font, cp)));
  if (full) return full;
  return stack.find((font) => fontCovers(font, needed[0]!)) ?? stack[0]!;
}

const SCRIPT_TESTS: readonly [string, RegExp][] = [
  ['Latn', /\p{Script=Latin}/u],
  ['Deva', /\p{Script=Devanagari}/u],
  ['Taml', /\p{Script=Tamil}/u],
  ['Arab', /\p{Script=Arabic}/u],
  ['Cyrl', /\p{Script=Cyrillic}/u],
  ['Grek', /\p{Script=Greek}/u],
];

/** A grapheme's script, or null for spaces, punctuation and emoji (they join the run around them). */
export function scriptOfGrapheme(grapheme: string): string | null {
  return SCRIPT_TESTS.find(([, test]) => test.test(grapheme))?.[0] ?? null;
}

/**
 * Runs the way Chrome itemises a line: by script first (so Devanagari inside a Latin line still gets
 * Indic shaping), then by the font that draws each grapheme. Common characters join the run before them.
 */
export function splitRuns(
  text: string,
  stack: readonly FontKey[],
  language: string,
): { text: string; font: FontKey }[] {
  const runs: { text: string; font: FontKey; script: string | null }[] = [];
  for (const grapheme of graphemes(text, language)) {
    const font = fontForGrapheme(grapheme, stack);
    const script = scriptOfGrapheme(grapheme);
    const last = runs[runs.length - 1];
    if (last && last.font === font && (script === null || last.script === null || last.script === script)) {
      last.text += grapheme;
      last.script ??= script;
    } else {
      runs.push({ text: grapheme, font, script });
    }
  }
  return runs.map(({ text: runText, font }) => ({ text: runText, font }));
}

export async function createTextMeasurer(
  fontDir: string | { readonly dir: string },
  options: { readonly language?: string } = {},
): Promise<DetailedTextMeasurer> {
  const dir = typeof fontDir === 'string' ? fontDir : fontDir.dir;
  const hb: HarfBuzz = await import('harfbuzzjs');
  const faces = new Map<string, InstanceType<HarfBuzz['Face']>>();
  const fonts = new Map<string, LoadedFont>();
  const language = options.language ?? 'en';

  function load(entry: FontFileEntry, weight: number): LoadedFont {
    const key = `${entry.file}@${weight}`;
    const cached = fonts.get(key);
    if (cached) return cached;
    let face = faces.get(entry.file);
    if (!face) {
      face = new hb.Face(new hb.Blob(new Uint8Array(readFileSync(join(dir, entry.file)))));
      faces.set(entry.file, face);
    }
    const font = new hb.Font(face);
    if ('wght' in face.getAxisInfos()) font.setVariations([new hb.Variation('wght', weight)]);
    const extents = font.hExtents();
    const loaded = { font, upem: face.upem, ascender: extents.ascender, descender: -extents.descender };
    fonts.set(key, loaded);
    return loaded;
  }

  function shapeWidth(text: string, font: FontKey, weight: number): { width: number; loaded: LoadedFont } {
    const { entry, weight: applied } = fileForWeight(font, weight);
    const loaded = load(entry, applied);
    const buffer = new hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(loaded.font, buffer);
    let advance = 0;
    for (const position of buffer.getGlyphPositions()) advance += position.xAdvance;
    return { width: advance / loaded.upem, loaded };
  }

  function runs(text: string, font: CaptionFontId, weight: number, sizePx: number): MeasuredRun[] {
    return splitRuns(text, stackKeys(font), language).map((run) => ({
      text: run.text,
      font: run.font,
      width: shapeWidth(run.text, run.font, weight).width * sizePx,
    }));
  }

  return {
    runs,
    measure(text: string, font: CaptionFontId, weight: number, sizePx: number): TextMeasure {
      // The line box takes the primary font's metrics plus those of every fallback the text uses.
      const primary = load(fileForWeight(font, weight).entry, fileForWeight(font, weight).weight);
      let ascent = primary.ascender / primary.upem;
      let descent = primary.descender / primary.upem;
      let width = 0;
      for (const run of splitRuns(text, stackKeys(font), language)) {
        const shaped = shapeWidth(run.text, run.font, weight);
        width += shaped.width;
        ascent = Math.max(ascent, shaped.loaded.ascender / shaped.loaded.upem);
        descent = Math.max(descent, shaped.loaded.descender / shaped.loaded.upem);
      }
      return { width: width * sizePx, ascent: ascent * sizePx, descent: descent * sizePx };
    },
  };
}
