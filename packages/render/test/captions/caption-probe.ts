// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The caption suites' shared pieces (languages.int, translation.int, pop-room.int): a golden string as a caption
 * track built by the real cue builder, and Chrome's caption boxes at each cue's middle frame (or any frames) on a
 * preset's composition.
 */
import { join } from 'node:path';
import {
  newId,
  RationalTime,
  type CaptionStyle,
  type CaptionTrack,
  type ExportPreset,
  type FrameRate,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { buildCaptionCues } from '../../src/captions/cues';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import { matchCaptionStyle } from '../../src/captions/style';
import {
  compileComposition,
  type CompileOptions,
  type CompositionBundle,
} from '../../src/compile/composition';
import { writeBundle } from '../../src/engine/bundle-writer';
import { openCaptureSession } from '../../src/engine/capture';
import { presetFor } from '../../src/presets/presets.v1';
import type { ProbedTextBox, QaPlan } from '../../src/types';
import { makeTimeline, span } from '../support/timeline';

/** A word every `wordFrames`, grouped by the real cue builder on the requested fixture canvas. */
export function goldenCaptionTrack(
  language: string,
  text: string,
  measurer: DetailedTextMeasurer,
  timing: { readonly rate: FrameRate; readonly wordFrames: number },
  font?: CaptionStyle['font'],
  preset: ExportPreset = presetFor('device'),
): { track: CaptionTrack; frames: number } {
  const { safe, height } = preset;
  const matched = matchCaptionStyle(null, language, { safe, height });
  const style = font ? { ...matched, font } : matched;
  const words = text.split(' ').map((word, index) => ({
    text: word,
    range: span(index * timing.wordFrames, timing.wordFrames, timing.rate),
    confidence: 0.95,
  }));
  const frames = words.length * timing.wordFrames + 6;
  const cues = buildCaptionCues(words, style, measurer, safe, {
    language,
    rate: timing.rate,
    durationFrames: frames,
  });
  return { track: { enabled: true, language, style, styleSource: 'preset', cues }, frames };
}

/** A cue's middle frame. */
export const middleFrame = (cue: CaptionTrack['cues'][number], rate: FrameRate) =>
  RationalTime.toFrames(cue.range.start, rate) +
  Math.floor(RationalTime.toFrames(cue.range.duration, rate) / 2);

export interface CaptionProbeInput {
  readonly track: CaptionTrack;
  readonly frames: number;
  readonly rate: FrameRate;
  readonly preset: ExportPreset;
  /** The still under the captions. */
  readonly still: string;
  /** A folder the bundle goes in (one per call). */
  readonly workDir: string;
  readonly chromePath: string;
  readonly ctx: MediaContext;
  readonly options: Pick<CompileOptions, 'fonts' | 'captionLayout'>;
}

/** Chrome's caption boxes by cue at each cue's middle frame, and the composition's QA plan. */
export async function probeCaptionCues(
  input: CaptionProbeInput,
): Promise<{ boxes: Map<string, ProbedTextBox[]>; qaPlan: QaPlan }> {
  const { boxes, bundle } = await probeCaptionFrames(input, (cue) => [middleFrame(cue, input.rate)]);
  return { boxes, qaPlan: bundle.qaPlan };
}

/** Chrome's caption boxes by cue at the frames `framesOf` names for each cue, and the compiled composition. */
export async function probeCaptionFrames(
  input: CaptionProbeInput,
  framesOf: (cue: CaptionTrack['cues'][number]) => readonly number[],
): Promise<{ boxes: Map<string, ProbedTextBox[]>; bundle: CompositionBundle }> {
  const { track, rate } = input;
  const timeline = makeTimeline({ rate, items: [{ kind: 'image', frames: input.frames }], captions: track });
  const compiled = compileComposition(timeline, {
    variant: 'export',
    preset: input.preset,
    burnCaptions: true,
    media: () => ({ file: input.still, key: 'still', mediaStart: RationalTime.zero(rate), ext: 'jpg' }),
    ...input.options,
  });
  if (!compiled.ok) throw new Error(compiled.error.code);
  const dir = join(input.workDir, `probe-${newId()}`);
  await writeBundle(compiled.value, dir);
  const session = await openCaptureSession({
    dir,
    rate,
    width: input.preset.width,
    height: input.preset.height,
    chromePath: input.chromePath,
    browserGpu: 'hardware',
    binaries: input.ctx.binaries,
  });
  if (!session.ok) throw new Error(`${session.error.code}: ${session.error.detail ?? ''}`);
  try {
    const boxes = new Map<string, ProbedTextBox[]>();
    for (const cue of track.cues) {
      const found: ProbedTextBox[] = [];
      for (const frame of framesOf(cue)) {
        const probed = await session.value.probeText(frame);
        if (!probed.ok) throw new Error(probed.error.code);
        found.push(...probed.value.filter((box) => box.kind === 'caption'));
      }
      boxes.set(cue.id, found);
    }
    return { boxes, bundle: compiled.value };
  } finally {
    await session.value.close();
  }
}
