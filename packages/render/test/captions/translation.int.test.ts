// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Translated captions lay out (P3-V20, SPEC P3.9/P3.16): the golden caption tracks of the gate-8 suite
 * (languages.int.test.ts), translated by captions' applyTranslation from the recorded translator output
 * below into en, hi, es and pt-BR, then laid out by Chrome on each distinct caption layout geometry (canvas,
 * safe rect and caption anchor): captionGlyphs,
 * captionOverflow and captionSafeZone pass on every preset, and the Hindi track got a font that draws
 * Devanagari.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type CaptionTrack, type ExportPreset } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { createCompositionFonts } from '../../src/captions/fonts';
import { captionGlyphIssues } from '../../src/captions/glyphs';
import { layoutCue } from '../../src/captions/layout';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import { coversScript, scriptOf } from '../../src/captions/style';
import { translateTrack } from '../../src/captions/translation';
import { EXPORT_PRESETS } from '../../src/presets/presets.v1';
import { captionGlyphsCheck, captionOverflowCheck, captionSafeZoneCheck } from '../../src/qa/checks/captions';
import { FONTS_DIR, GOLDEN, testMeasurer } from '../support/fonts';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { goldenCaptionTrack, probeCaptionCues } from './caption-probe';
import { captionGeometryGroups } from './caption-presets';

const media = await findTestMedia('caption translations');
const shell = findTestShell('caption translations');
const RATE = FrameRate.of(30);
const WORD_FRAMES = 12;

/**
 * The recording: what a translator returned for each golden track, one text per cue in cue order (the
 * agent's translate step replays this instead of a model). The English and Spanish goldens are the sources.
 */
const RECORDING = {
  hi: { from: 'en', cues: ['पुराने बंदरगाह पर', 'सुबह की रोशनी'] },
  es: { from: 'en', cues: ['Luz de la mañana sobre', 'el viejo puerto'] },
  'pt-BR': { from: 'en', cues: ['Luz da manhã sobre', 'o velho porto'] },
  en: { from: 'es', cues: ['Where is the boy?', 'Tomorrow, yes!'] },
} as const;

/** A golden string as a caption track, as gate 8 builds it, in a Latin-only geometric font. */
const goldenTrack = (language: string, text: string, measurer: DetailedTextMeasurer) =>
  goldenCaptionTrack(language, text, measurer, { rate: RATE, wordFrames: WORD_FRAMES }, 'montserrat');

describe.skipIf(!media.binaries || !shell.path)('translated captions (P3-V20)', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let measurer: DetailedTextMeasurer;
  let still: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('caption-translations');
    measurer = await testMeasurer();
    still = join(work.dir, 'background.jpg');
    await ffmpeg(ctx, ['-f', 'lavfi', '-i', 'color=c=0x1e4d7a:s=1080x1920', '-frames:v', '1', still]);
  });
  afterAll(() => work?.dispose());

  /** Chrome's caption boxes at each cue's middle frame on `preset`'s composition, and its QA plan. */
  async function probe(track: CaptionTrack, frames: number, preset: ExportPreset, dir: string) {
    const probed = await probeCaptionCues({
      track,
      frames,
      rate: RATE,
      preset,
      still,
      workDir: dir,
      chromePath: shell.path!,
      ctx,
      options: {
        fonts: createCompositionFonts(FONTS_DIR, measurer),
        captionLayout: (text, style, safe, language, height) =>
          layoutCue(text, style, measurer, safe, language, height),
      },
    });
    return { boxes: [...probed.boxes.values()].flat(), qaPlan: probed.qaPlan };
  }

  const CANVASES = captionGeometryGroups(EXPORT_PRESETS);

  it.each(Object.entries(RECORDING))('%s', async (language, recorded) => {
    const { track, frames } = goldenTrack(
      recorded.from,
      recorded.from === 'en' ? GOLDEN.en : GOLDEN.es,
      measurer,
    );
    expect(recorded.cues).toHaveLength(track.cues.length);
    const translated = translateTrack(
      track,
      {
        language,
        cues: track.cues.map((cue, index) => ({ cueId: cue.id, text: recorded.cues[index] ?? '' })),
      },
      RATE,
    );
    if (!translated.ok) throw new Error(translated.error.code);
    const result = translated.value;
    expect(result.language).toBe(language);
    expect(coversScript(result.style.font, scriptOf(language))).toBe(true);
    if (language === 'hi') expect(result.style.font).not.toBe('montserrat');
    for (const cue of result.cues)
      for (const word of cue.words)
        expect(RationalTime.toFrames(word.range.duration, RATE)).toBeGreaterThanOrEqual(4);

    const timeline = makeTimeline({ rate: RATE, items: [{ kind: 'image', frames }], captions: result });
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    for (const canvas of CANVASES) {
      const { boxes, qaPlan } = await probe(
        result,
        frames,
        canvas.drawn,
        join(work.dir, `probe-${language}-${canvas.drawn.id}`),
      );
      expect(boxes).toHaveLength(result.cues.length);
      expect(boxes.every((box) => box.fontsReady)).toBe(true);
      expect(captionGlyphsCheck({ captions: result, target, boxes }, captionGlyphIssues).status).toBe('pass');
      for (const preset of canvas.checked) {
        const input = { plan: qaPlan, captions: result, boxes, safe: preset.safe, target };
        expect(captionOverflowCheck(input).status, `${language} overflow, ${preset.id}`).toBe('pass');
        expect(captionSafeZoneCheck(input).status, `${language} safe zone, ${preset.id}`).toBe('pass');
      }
    }
  });
});
