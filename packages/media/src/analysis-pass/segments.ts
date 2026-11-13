// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One long file, several decodes at once (IX-D7): the analysis pass of a
 * long video split into time segments that run side by side, then stitched
 * into the result one pass would give.
 *
 * - Each segment after the first starts `preRoll` frames early, so its first
 *   own frame is scored against the frames before it (scdet looks two back,
 *   the coarse branch two samples back) and the caller's per-frame
 *   statistics have their previous frame and sample; outputs before a
 *   segment's own start are dropped (the frame files keep them: the cache
 *   indexes by frame, so a frame read twice is the same frame).
 * - Segment starts and the pre-roll are multiples of `align` (every branch's
 *   `every`), so every branch keeps the whole file's multiples.
 * - blackdetect and freezedetect report every run (`d=0`); a run across an
 *   edge is seen by both segments and merged, then each detector's minimum
 *   (the caller's `detectMinSeconds`, FFmpeg's 2 s by default) applies, which
 *   is what one pass with those minimums reports.
 * Segments run at most `parallel` at a time; every FFmpeg run still waits for
 * a hardware session slot (the session cap), and the caller sizes `parallel`
 * from the video class budget.
 */
import { ok, type AsyncResult, type Result } from '@taalcut/core';
import type { MediaContext } from '../ffmpeg';
import type { TimeInterval } from '../primitives/parsers';
import type { NormalisationPlan } from '../normalise/types';
import { detectMinimums } from './pass-common';
import {
  runAnalysisPass,
  type AnalysisPassOptions,
  type AnalysisPassResult,
  type PassFrame,
  type SceneSample,
} from './run-pass';
import type { RgbBatch, RgbStream } from './rgb-stream';

export interface PassSegment {
  /** First frame of the segment's own range. */
  readonly start: number;
  /** One past its last frame. */
  readonly end: number;
  /** First frame it decodes (start − pre-roll, never below 0). */
  readonly from: number;
}

/** Below this a video is analysed in one pass (IX-D7's threshold: 10 minutes). */
export const SEGMENT_MIN_SECONDS = 600;
/** Segments are at least this long, so the pre-roll and the seek stay a small share. */
export const SEGMENT_SECONDS = 300;
/** FFmpeg's blackdetect and freezedetect default minimum. */
const DETECT_SECONDS = 2;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function lcm(values: readonly number[]): number {
  return values.reduce((acc, v) => (acc * Math.max(1, v)) / gcd(acc, Math.max(1, v)), 1);
}

/** Splits `frames` into up to `count` aligned segments of at least `minFrames`, each with its pre-roll. */
export function passSegments(
  frames: number,
  options: { count: number; minFrames: number; align: number; preRoll: number },
): PassSegment[] {
  const align = Math.max(1, options.align);
  const count = Math.max(1, Math.min(options.count, Math.floor(frames / Math.max(1, options.minFrames))));
  const preRoll = Math.ceil(options.preRoll / align) * align;
  const starts = Array.from({ length: count }, (_, i) => Math.round((i * frames) / count / align) * align);
  return starts.map((start, i) => ({
    start,
    end: starts[i + 1] ?? frames,
    from: Math.max(0, start - preRoll),
  }));
}

/**
 * Merges runs that overlap (a run across an edge is seen by both segments: the later one from its pre-roll)
 * and keeps those of at least `min` seconds. Runs that only touch stay apart, as one pass reports them.
 */
export function stitchIntervals(runs: readonly TimeInterval[], min: number): TimeInterval[] {
  const sorted = [...runs].sort((a, b) => a.startSec - b.startSec);
  const merged: { startSec: number; endSec: number }[] = [];
  for (const run of sorted) {
    const last = merged[merged.length - 1];
    if (last && run.startSec < last.endSec) last.endSec = Math.max(last.endSec, run.endSec);
    else merged.push({ ...run });
  }
  return merged.filter((run) => run.endSec - run.startSec >= min - 1e-6);
}

/** A segmented pass's RGB stream: each segment's frames, pre-roll included, in order, tagged with the segment. */
export interface SegmentRgbStream extends Omit<RgbStream, 'onFrames'> {
  readonly onFrames: (batch: RgbBatch, segment: number) => Promise<void>;
}

export interface SegmentedPassOptions extends Omit<AnalysisPassOptions, 'onFrame' | 'window' | 'rgbStream'> {
  readonly segments: readonly PassSegment[];
  /** Segments decoding at once. */
  readonly parallel: number;
  /** Every decoded frame, pre-roll included, tagged with its segment (segments interleave). */
  readonly onFrame?: (frame: PassFrame, segment: number) => void;
  readonly rgbStream?: SegmentRgbStream;
}

const own = (samples: readonly SceneSample[], segment: PassSegment) =>
  samples.filter((s) => s.index >= segment.start && s.index < segment.end);

export async function runSegmentedPass(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: SegmentedPassOptions,
): AsyncResult<AnalysisPassResult> {
  const { segments, onFrame, rgbStream, parallel, ...rest } = options;
  const results: Result<AnalysisPassResult>[] = new Array(segments.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < segments.length; i = next++) {
      const segment = segments[i];
      if (!segment) return;
      results[i] = await runAnalysisPass(path, plan, ctx, {
        ...rest,
        window: { from: segment.from, frames: segment.end - segment.from },
        detectMinSeconds: 0,
        ...(onFrame ? { onFrame: (frame: PassFrame) => onFrame(frame, i) } : {}),
        ...(rgbStream
          ? { rgbStream: { ...rgbStream, onFrames: (batch: RgbBatch) => rgbStream.onFrames(batch, i) } }
          : {}),
      });
      if (!results[i]?.ok) return;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, segments.length)) }, worker));
  const failed = results.find((result) => result !== undefined && !result.ok);
  if (failed && !failed.ok) return failed;
  const done = segments.flatMap((segment, i) => {
    const result = results[i];
    return result?.ok ? [{ segment, pass: result.value }] : [];
  });
  const passes = done.map((d) => d.pass);
  const minimums = detectMinimums(rest.detectMinSeconds);
  return ok({
    fine: done.flatMap(({ segment, pass }) => own(pass.fine, segment)),
    coarse: done.flatMap(({ segment, pass }) => own(pass.coarse, segment)),
    black: stitchIntervals(
      passes.flatMap((p) => p.black),
      minimums.black ?? DETECT_SECONDS,
    ),
    freeze: stitchIntervals(
      passes.flatMap((p) => p.freeze),
      minimums.freeze ?? DETECT_SECONDS,
    ),
    frames: Math.max(0, ...passes.map((p) => p.frames)),
    files: passes.flatMap((p) => p.files),
  });
}
