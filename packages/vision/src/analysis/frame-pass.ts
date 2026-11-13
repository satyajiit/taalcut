// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The asset's analysis, from one decode of its video (IX-D2): the frame
 * source's pass gives every frame's scene score, every n-th frame's score
 * against the previous sample (shot candidates), black and freeze intervals
 * and the gray frames, from which this computes what the old analyse pass
 * computed per frame: every frame's change from the one before (64×64), and
 * about 10 a second the full statistics, signals against the previous sample
 * and a dHash. The result is a cache document, so `vision.shots` (which runs
 * the pass) and `vision.analyse` (which reads it) share one decode; a stage
 * that finds no document runs the pass itself. The pass also keeps the
 * frames OCR reads (one a second at 1280 px) in the frame cache.
 *
 * blackdetect reports every run (IX3-D2): `black` keeps FFmpeg's 2 s minimum,
 * as `vision.analyse` has always read it (freezedetect keeps it itself), and
 * `blackRuns` holds every black run, however short, for the shots' fades.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { stitchIntervals } from '@taalcut/media';
import { z } from 'zod';
import { VISION_CONFIG } from '../config';
import type { FrameSource, PassRequest, PassStream } from '../media/frame-source';
import { fitLongSide } from '../media/frames';
import { dHash, frameStats, type FrameStats } from '../quality/frame-stats';
import { downsample } from '../quality/shift';
import { sampleSignals } from '../quality/shot-quality';

export const PASS_DOC = 'analysis-pass';
const VERSION = 1;
const q = VISION_CONFIG.quality;
/** FFmpeg's blackdetect default minimum: what `black` holds. */
const DETECT_SECONDS = 2;

const scoreSchema = z.tuple([z.number(), z.number()]);
const intervalSchema = z.object({ startSec: z.number(), endSec: z.number() });
const sampleSchema = z.object({
  index: z.int().nonnegative(),
  laplacianVariance: z.number(),
  mean: z.number(),
  std: z.number(),
  dark: z.number(),
  bright: z.number(),
  black: z.boolean(),
  shift: z.object({ x: z.number(), y: z.number() }).optional(),
  change: z.number().optional(),
  dHash: z.string().regex(/^[0-9a-f]{16}$/),
});

const passDocSchema = z.object({
  version: z.literal(VERSION),
  longSide: z.int().positive(),
  /** Statistics on every `every`-th frame. */
  every: z.int().positive(),
  /** `coarse[i]` is frame i × coarseEvery. */
  coarseEvery: z.int().positive(),
  frames: z.int().nonnegative(),
  /** [score, mafd] of every frame. */
  fine: z.array(scoreSchema),
  coarse: z.array(scoreSchema),
  black: z.array(intervalSchema),
  freeze: z.array(intervalSchema),
  /** Every black run, however short (IX3-D2); absent in a document left before it: not measured. */
  blackRuns: z.array(intervalSchema).optional(),
  samples: z.array(sampleSchema),
  /** Each frame's change from the frame before (64×64 thumbnails, 0–255); 0 for the first. */
  frameChange: z.array(z.number()),
});

export type PassAnalysis = z.output<typeof passDocSchema>;
export type PassSample = z.output<typeof sampleSchema>;

export interface PassParameters {
  readonly longSide: number;
  readonly every: number;
  readonly coarseEvery: number;
}

/** The pass's sampling for a source: 10 statistics samples and 10 shot candidates a second, at 256 px. */
export function passParameters(fps: number): PassParameters {
  return {
    longSide: q.longSide,
    every: Math.max(1, Math.round(fps / q.fps)),
    coarseEvery: Math.max(1, Math.round(fps / VISION_CONFIG.shots.fps)),
  };
}

function meanAbs(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return a.length > 0 ? sum / a.length : 0;
}

/** Per-frame statistics as the old analyse pass computed them, frame by frame. */
export function createPassStats(every: number) {
  const samples: PassSample[] = [];
  const frameChange: number[] = [];
  let previous: FrameStats | undefined;
  let previousThumb: Float32Array | undefined;
  return {
    samples,
    frameChange,
    push(frame: { index: number; width: number; height: number; data: Uint8Array }) {
      const thumb = downsample(frame.data, frame.width, frame.height, q.shiftSize);
      frameChange[frame.index] = previousThumb ? meanAbs(previousThumb, thumb) : 0;
      previousThumb = thumb;
      if (frame.index % every !== 0) return;
      const stats = frameStats(frame);
      samples.push({
        ...sampleSignals(stats, previous),
        dHash: dHash(frame.data, frame.width, frame.height),
      });
      previous = stats;
    },
  };
}

export interface AnalysisPassOptions {
  /** Keep the frames OCR reads (one a second at the OCR size) while the pass decodes. */
  readonly keepOcrFrames?: boolean;
  /** Segments of a long video decoded at once (IX-D7); 1 or absent: one pass. */
  readonly parallel?: number;
  /**
   * The shot-boundary model's frames, streamed while the pass decodes (IX2-C3). A kept document can't give
   * them, so a request with a stream always decodes (and leaves the document again).
   */
  readonly stream?: PassStream;
  readonly signal?: AbortSignal;
}

/** Each segment's statistics, joined: a segment's state starts in its pre-roll, its output is its own frames. */
function joinSegments(
  stats: ReadonlyMap<number, ReturnType<typeof createPassStats>>,
  segments: readonly { readonly start: number; readonly end: number }[],
): { samples: PassSample[]; frameChange: number[] } {
  const samples: PassSample[] = [];
  const frameChange: number[] = [];
  segments.forEach((segment, i) => {
    const part = stats.get(i);
    if (!part) return;
    samples.push(...part.samples.filter((s) => s.index >= segment.start && s.index < segment.end));
    for (let index = segment.start; index < Math.min(segment.end, part.frameChange.length); index++)
      frameChange[index] = part.frameChange[index] ?? 0;
  });
  return { samples, frameChange: Array.from(frameChange, (change) => change ?? 0) };
}

/** The OCR frames' size and spacing: what ocr/shot-text.ts reads (vision.ocr). */
export function ocrSampling(source: FrameSource): { size: { width: number; height: number }; every: number } {
  const { video } = source;
  return {
    size: fitLongSide(video.width, video.height, VISION_CONFIG.breakdown.ocrLongSide),
    every: Math.max(1, Math.round(video.rate.num / video.rate.den)),
  };
}

/** Scores at their place: entry i is frame i × step (a frame scdet printed nothing for scores 0). */
function byIndex(
  scores: readonly { index: number; score: number; mafd: number }[],
  step: number,
  length: number,
): [number, number][] {
  const out = Array.from({ length }, (): [number, number] => [0, 0]);
  for (const s of scores) {
    const at = s.index / step;
    if (Number.isInteger(at) && at >= 0 && at < length) out[at] = [s.score, s.mafd];
  }
  return out;
}

/** The asset's pass document from the cache, or the pass run now (and its document left for later stages). */
export async function analysisPass(
  source: FrameSource,
  options: AnalysisPassOptions = {},
): AsyncResult<PassAnalysis> {
  const fps = source.video.rate.num / source.video.rate.den;
  const params = passParameters(fps);
  // A document that can't be read is one that isn't there: the pass runs again. So does one from before every black
  // run was kept (no `blackRuns`): it would mark no fade on the scdet route, ever (IX3-F5, M3).
  const kept = await source.getDoc(PASS_DOC);
  const stored = passDocSchema.safeParse(kept.ok ? kept.value : undefined);
  if (
    !options.stream &&
    stored.success &&
    stored.data.blackRuns !== undefined &&
    stored.data.longSide === params.longSide &&
    stored.data.every === params.every &&
    stored.data.coarseEvery === params.coarseEvery
  )
    return ok(stored.data);
  const stats = new Map<number, ReturnType<typeof createPassStats>>();
  const ocr = ocrSampling(source);
  const request: PassRequest = {
    longSide: params.longSide,
    coarseEvery: params.coarseEvery,
    align: params.every,
    ...(options.parallel ? { parallel: options.parallel } : {}),
    ...(options.stream ? { stream: options.stream } : {}),
    onFrame: (frame, segment) => {
      const part = stats.get(segment) ?? createPassStats(params.every);
      stats.set(segment, part);
      part.push(frame);
    },
    ...(options.keepOcrFrames
      ? { keep: [{ size: ocr.size, format: 'rgb24' as const, every: ocr.every }] }
      : {}),
  };
  const run = await source.pass(request, options.signal);
  if (!run.ok) return run;
  const joined = joinSegments(stats, run.value.segments);
  const doc: PassAnalysis = {
    version: VERSION,
    ...params,
    frames: run.value.frames,
    fine: byIndex(run.value.fine, 1, run.value.frames),
    coarse: byIndex(run.value.coarse, params.coarseEvery, Math.ceil(run.value.frames / params.coarseEvery)),
    black: stitchIntervals(run.value.black, DETECT_SECONDS),
    freeze: [...run.value.freeze],
    blackRuns: [...run.value.black],
    samples: joined.samples,
    frameChange: joined.frameChange,
  };
  // Not kept (no room, a write error): a later stage runs the pass itself.
  await source.putDoc(PASS_DOC, doc);
  return ok(doc);
}
