// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen text for an asset's shots from its frame source: the `vision.ocr`
 * stage's read (IX-O5). The samples sit on the asset's one-a-second grid
 * (multiples of the frame rate), the frames the analysis pass keeps, so
 * reading them decodes nothing (IX-D2); a shot with no grid frame inside it
 * reads its best frame. Shots are read in windows and their text is
 * sample-grain (read-shots.ts): nothing reads more than the samples.
 */
import { ok, RationalTime, type AsyncResult, type OnScreenText, type TimeRange } from '@taalcut/core';
import { ocrSampling } from '../analysis/frame-pass';
import type { FrameSource } from '../media/frame-source';
import type { OcrMeter } from './meter';
import { readShotsText, type ReadShotsDeps, type ShotSpan } from './read-shots';
import { baseLanguage } from './text';
import type { OcrEngine } from './types';

/** At most this many texts per shot (core's analysis schema). */
const MAX_TEXTS = 200;

/** The requested languages the engine reads here (by base language), in the caller's order. */
export async function servedLanguages(ocr: OcrEngine, wanted: readonly string[]): AsyncResult<string[]> {
  const caps = await ocr.capabilities();
  if (!caps.ok) return caps;
  const served = new Set(caps.value.languages.map(baseLanguage));
  return ok(wanted.filter((language) => served.has(baseLanguage(language))));
}

/** Upright RGB frames at the OCR size, from the asset's frame source. */
export function ocrFramesOf(frames: FrameSource): ReadShotsDeps['frames'] {
  const { size } = ocrSampling(frames);
  return async (indexes, signal) => {
    const read = await frames.frames({ size, format: 'rgb24', frames: indexes }, signal);
    if (!read.ok) return read;
    return ok(read.value.map((f) => ({ index: f.index, width: f.width, height: f.height, rgb: f.data })));
  };
}

export interface ShotToRead {
  readonly shotId: string;
  readonly range: TimeRange;
  /** The analysis's best frame, relative to the shot's first frame: read when no grid frame falls inside it. */
  readonly bestFrame?: number;
}

export interface ShotTextRead {
  readonly shotId: string;
  readonly onScreenText: OnScreenText[];
}

/** A shot's grid frames on the source's grid. */
function spanOf(shot: ShotToRead, rate: FrameSource['video']['rate']): ShotSpan {
  const start = RationalTime.toFrames(shot.range.start, rate);
  const end = start + Math.max(1, RationalTime.toFrames(shot.range.duration, rate));
  const best = shot.bestFrame === undefined ? undefined : start + Math.min(end - start - 1, shot.bestFrame);
  return { start, end, ...(best !== undefined ? { bestFrame: best } : {}) };
}

/** Each shot's texts, in the order given; none when the engine reads none of the languages. */
export async function readShotText(
  shots: readonly ShotToRead[],
  frames: FrameSource,
  ocr: OcrEngine,
  languages: readonly string[],
  options: { readonly signal?: AbortSignal; readonly meter?: OcrMeter } = {},
): AsyncResult<ShotTextRead[]> {
  const usable = await servedLanguages(ocr, languages);
  if (!usable.ok) return usable;
  if (usable.value.length === 0 || shots.length === 0)
    return ok(shots.map((shot) => ({ shotId: shot.shotId, onScreenText: [] })));
  const rate = frames.video.rate;
  const read = await readShotsText(
    {
      rate,
      shots: shots.map((shot) => spanOf(shot, rate)),
      every: ocrSampling(frames).every,
      languages: usable.value,
    },
    { ocr, frames: ocrFramesOf(frames), ...(options.meter ? { meter: options.meter } : {}) },
    options.signal ? { signal: options.signal } : {},
  );
  if (!read.ok) return read;
  return ok(
    shots.map((shot, i) => ({
      shotId: shot.shotId,
      onScreenText: (read.value[i] ?? []).slice(0, MAX_TEXTS),
    })),
  );
}
