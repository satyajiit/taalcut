// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OCR crop + string → every bundled face of that script, ranked by mean SSIM.
 * `toFontMatch` stores the honest winner of every face (round P3-3) and, beside it, the best caption font: the
 * face captions draw, because render bundles only CAPTION_FONTS.
 */
import {
  CancelledError,
  err,
  FONT_MATCH_FAMILIES,
  fontMatchSchema,
  isCaptionFont,
  ok,
  type AsyncResult,
  type FontMatch,
} from '@taalcut/core';
import { alignCrop, polarityOf } from './align';
import { loadCatalogue } from './catalogue';
import { FontMatchWithheld, FontRenderFailed } from './errors';
import { scriptOf, type FontScript } from './script';
import { meanSsim } from './ssim';
import { type TextRenderer } from './text-renderer';

const DEFAULT_MIN_CONFIDENCE = 0.8;
const DEFAULT_MIN_HEIGHT = 32;
const MIN_PIXEL_HEIGHT = 24;
const MAX_PIXEL_HEIGHT = 256;
const SAMPLE_CHARS = 80;

export interface FontMatchCrop {
  readonly gray: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface FontMatchInput {
  readonly text: string;
  readonly ocrConfidence: number;
  readonly crop: FontMatchCrop;
  readonly minOcrConfidence?: number;
  readonly minHeightPx?: number;
}

export interface FontMatchDeps {
  readonly renderer: TextRenderer;
  /** The bundled fonts directory. Default: the checkout's `packages/vision/fonts` (tests, development). */
  readonly fontsDir?: string;
}

export interface FontRankingRow {
  /** Catalogue id (`notoSans`), not the display name. */
  readonly family: string;
  readonly familyName: string;
  /** Raw mean SSIM. May be negative. No cutoff. */
  readonly score: number;
  readonly captionFont: boolean;
}

export interface FontSuggestionList {
  readonly script: FontScript;
  readonly sampleText: string;
  readonly ocrConfidence: number;
  readonly ranking: readonly FontRankingRow[];
}

function sampleText(text: string): string {
  let out = '';
  let n = 0;
  for (const ch of text) {
    if (n >= SAMPLE_CHARS) break;
    out += ch;
    n += 1;
  }
  return out;
}

function clampScore(score: number): number {
  if (score > 1) return 1;
  if (score < -1) return -1;
  return score;
}

/** Highest SSIM first. Ties prefer a caption font, then the id. */
function compareRank(a: FontRankingRow, b: FontRankingRow): number {
  if (a.score !== b.score) return a.score > b.score ? -1 : 1;
  if (a.captionFont !== b.captionFont) return a.captionFont ? -1 : 1;
  if (a.family < b.family) return -1;
  if (a.family > b.family) return 1;
  return 0;
}

function pixelHeightFor(cropHeight: number): number {
  return Math.min(MAX_PIXEL_HEIGHT, Math.max(MIN_PIXEL_HEIGHT, cropHeight));
}

/**
 * Rank every bundled face of the crop's script. Withheld (not guessed) when OCR
 * is under `minOcrConfidence` (default 0.8), the crop is shorter than
 * `minHeightPx` (default 32), or the string has no script.
 */
export async function matchFonts(
  input: FontMatchInput,
  deps: FontMatchDeps,
  signal?: AbortSignal,
): AsyncResult<FontSuggestionList> {
  const minConfidence = input.minOcrConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const minHeight = input.minHeightPx ?? DEFAULT_MIN_HEIGHT;
  const script = scriptOf(input.text);
  if (input.ocrConfidence < minConfidence || input.crop.height < minHeight || script === null) {
    return err(FontMatchWithheld({ ocrConfidence: input.ocrConfidence }));
  }
  const { gray, width, height } = input.crop;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || gray.length !== width * height) {
    return err(FontRenderFailed(undefined, { detail: 'crop buffer does not match its size' }));
  }
  const catalogue = loadCatalogue(deps.fontsDir);
  if (!catalogue.ok) return catalogue;
  if (signal?.aborted) return err(CancelledError());

  const polarity = polarityOf(input.crop);
  const pixelHeight = pixelHeightFor(height);
  const rows: FontRankingRow[] = [];
  for (const face of catalogue.value) {
    if (face.script !== script) continue;
    if (signal?.aborted) return err(CancelledError());
    const rendered = await deps.renderer.render(
      { string: input.text, fontFile: face.file, pixelHeight, polarity },
      signal,
    );
    if (!rendered.ok) return rendered;
    const image = rendered.value;
    if (image.width < 1 || image.height < 1 || image.gray.length !== image.width * image.height) {
      return err(FontRenderFailed(undefined, { detail: 'text.render returned a short buffer' }));
    }
    const aligned = alignCrop(input.crop, image, input.text, script);
    rows.push({
      family: face.id,
      familyName: face.family,
      score: meanSsim(aligned.crop, aligned.rendered),
      captionFont: face.captionFont,
    });
  }
  return ok({
    script,
    sampleText: sampleText(input.text),
    ocrConfidence: input.ocrConfidence,
    ranking: [...rows].sort(compareRank),
  });
}

const MATCH_FAMILIES: ReadonlySet<string> = new Set(FONT_MATCH_FAMILIES);

/**
 * The match a Style stores, parsed as a `FontMatch`: `family` is the best-ranked face of every face a match may
 * name (FONT_MATCH_FAMILIES) with its score, `ranking` the top five of them, and `captionFont` the best-ranked
 * caption font, which is what captions draw (`family` itself when it is one). Null when no caption font was
 * ranked, or the value is not in the schema.
 */
export function toFontMatch(list: FontSuggestionList): FontMatch | null {
  const faces = list.ranking.filter((row) => MATCH_FAMILIES.has(row.family));
  const winner = faces[0];
  const caption = faces.find((row) => row.captionFont && isCaptionFont(row.family));
  if (!winner || !caption) return null;
  const parsed = fontMatchSchema.safeParse({
    version: 1,
    family: winner.family,
    captionFont: caption.family,
    score: clampScore(winner.score),
    metric: 'ssim',
    script: list.script,
    ranking: faces.slice(0, 5).map((row) => ({ family: row.family, score: clampScore(row.score) })),
    sampleText: list.sampleText,
    ocrConfidence: list.ocrConfidence,
  });
  return parsed.success ? parsed.data : null;
}
