// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The plain functions templates' breakdown asked vision for (templates SPEC,
 * "Requests to other lanes"): path in, numbers out, for the jobs process.
 * None calls a language or vision model.
 */
import {
  CancelledError,
  err,
  type FrameRate,
  ok,
  RationalTime,
  type AsyncResult,
  type RationalTime as Time,
  type Result,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { VISION_CONFIG } from '../config';
import type { VisionEmbedder } from '../embed/embedder';
import { fitLongSide, probeSource, sampleFrames } from '../media/frames';
import { sceneScores, type SceneSample } from '../media/scene';
import { downsample, phaseShift } from '../quality/shift';
import { recognizeWithReuse } from '../ocr/reuse';
import { servedLanguages } from '../ocr/shot-text';
import type { OcrEngine, OcrPage } from '../ocr/types';
import { frameVectors } from '../shots/confirm';
import { ocrFrame } from './overlays';

/** scdet score and MAFD for every frame of the grid (256 px), optionally only frames [start, end). */
export async function sceneScoresOf(
  path: string,
  deps: { readonly media: MediaContext },
  options: {
    readonly range?: { readonly start: number; readonly end: number };
    readonly signal?: AbortSignal;
  } = {},
): AsyncResult<{ readonly frameRate: FrameRate; readonly samples: SceneSample[] }> {
  const source = await probeSource(deps.media, path, options.signal);
  if (!source.ok) return source;
  const samples = await sceneScores(deps.media, source.value, {
    every: 1,
    longSide: VISION_CONFIG.cuts.longSide,
    ...(options.range ? { window: options.range } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!samples.ok) return samples;
  const inRange = (s: SceneSample) =>
    !options.range || (s.index >= options.range.start && s.index < options.range.end);
  return ok({ frameRate: source.value.rate, samples: samples.value.filter(inRange) });
}

/** Unit vectors of the frames at `times` (nearest grid frame), in order; null past the end. */
export async function frameEmbeddings(
  path: string,
  deps: { readonly media: MediaContext; readonly embedder: VisionEmbedder },
  times: readonly Time[],
  options: { readonly signal?: AbortSignal } = {},
): AsyncResult<(Float32Array | null)[]> {
  const source = await probeSource(deps.media, path, options.signal);
  if (!source.ok) return source;
  const frames = times.map((time) => RationalTime.toFrames(time, source.value.rate));
  const vectors = await frameVectors(frames, source.value, deps, options.signal);
  if (!vectors.ok) return vectors;
  return ok(frames.map((frame) => vectors.value.get(frame) ?? null));
}

/** OCR pages at `fps` samples a second (1280 px long side), unchanged frames reusing the last result. */
export async function ocrFrames(
  path: string,
  deps: { readonly media: MediaContext; readonly ocr: OcrEngine },
  options: { readonly fps: number; readonly languages: readonly string[]; readonly signal?: AbortSignal },
): AsyncResult<OcrPage[]> {
  const served = await servedLanguages(deps.ocr, options.languages);
  if (!served.ok) return served;
  if (served.value.length === 0) return ok([]);
  const source = await probeSource(deps.media, path, options.signal);
  if (!source.ok) return source;
  const fps = source.value.rate.num / source.value.rate.den;
  const every = Math.max(1, Math.round(fps / Math.max(0.1, options.fps)));
  const count = source.value.frameCount ?? 1;
  const size = fitLongSide(source.value.width, source.value.height, VISION_CONFIG.breakdown.ocrLongSide);
  const pages: OcrPage[] = [];
  let succeededChunks = 0;
  let lastError: Result<OcrPage[]> | undefined;
  for (let start = 0; start < count; start += every * 16) {
    if (options.signal?.aborted) return err(CancelledError());
    const frames: number[] = [];
    for (let f = start; f < Math.min(count, start + every * 16); f += every) frames.push(f);
    const chunk = await sampleFrames(deps.media, source.value, {
      size,
      format: 'rgb24',
      frames,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!chunk.ok) return chunk;
    const read = await recognizeWithReuse(deps.ocr, chunk.value.map(ocrFrame), {
      languages: served.value,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!read.ok) {
      if (CancelledError.is(read.error)) return read;
      lastError = read;
      continue;
    }
    succeededChunks += 1;
    pages.push(...read.value);
  }
  if (succeededChunks === 0 && lastError) return lastError;
  return ok(pages);
}

/** OCR of a still image (or a video's first frame), at up to 1920 px on the long side. */
export async function ocrImage(
  path: string,
  deps: { readonly media: MediaContext; readonly ocr: OcrEngine },
  options: { readonly languages: readonly string[]; readonly signal?: AbortSignal },
): AsyncResult<OcrPage> {
  const served = await servedLanguages(deps.ocr, options.languages);
  if (!served.ok) return served;
  if (served.value.length === 0) return ok({ frame: 0, observations: [] });
  const source = await probeSource(deps.media, path, options.signal);
  if (!source.ok) return source;
  const frames = await sampleFrames(deps.media, source.value, {
    size: fitLongSide(source.value.width, source.value.height, IMAGE_LONG_SIDE),
    format: 'rgb24',
    frames: [0],
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!frames.ok) return frames;
  const frame = frames.value[0];
  if (!frame) return ok({ frame: 0, observations: [] });
  const pages = await deps.ocr.recognize([ocrFrame(frame)], {
    languages: served.value,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!pages.ok) return pages;
  return ok(pages.value[0] ?? { frame: 0, observations: [] });
}

/** Stills are read larger than video frames: a screenshot's small print needs it. */
const IMAGE_LONG_SIDE = 1920;
/** Phase correlation works on power-of-two squares. */
const MOTION_SIZE = 64;

export interface MotionSample {
  /** Grid frame of the later of the two samples compared. */
  readonly frame: number;
  /** Global motion as a fraction of the frame width per second. */
  readonly speed: number;
  /** The shift between the two samples on a 64-px grid (right and down positive). */
  readonly dx: number;
  readonly dy: number;
  /** Correlation peak 0–1: low means no clear global motion (a cut, a flat frame). */
  readonly peak: number;
}

/**
 * Global motion over `ranges` (grid frames [start, end); default: the whole
 * file) at `rate` samples a second: the full grid around cuts, about 10 a
 * second elsewhere, as the caller chooses. Phase correlation on 64×64 gray
 * thumbnails (quality/shift.ts).
 */
export async function motionCurve(
  path: string,
  deps: { readonly media: MediaContext },
  options: {
    readonly rate: number;
    readonly ranges?: readonly { readonly start: number; readonly end: number }[];
    readonly signal?: AbortSignal;
  },
): AsyncResult<MotionSample[]> {
  const source = await probeSource(deps.media, path, options.signal);
  if (!source.ok) return source;
  const fps = source.value.rate.num / source.value.rate.den;
  const every = Math.max(1, Math.round(fps / Math.max(0.1, options.rate)));
  const count = source.value.frameCount ?? 1;
  const ranges = options.ranges ?? [{ start: 0, end: count }];
  const size = fitLongSide(source.value.width, source.value.height, 128);
  const out: MotionSample[] = [];
  for (const range of ranges) {
    const frames: number[] = [];
    for (let f = Math.max(0, range.start); f < Math.min(count, range.end); f += every) frames.push(f);
    if (frames.length < 2) continue;
    const thumbs = await sampleFrames(deps.media, source.value, {
      size,
      format: 'gray',
      frames,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!thumbs.ok) return thumbs;
    let previous: { frame: number; grid: Float32Array } | undefined;
    for (const thumb of thumbs.value) {
      const grid = downsample(thumb.data, thumb.width, thumb.height, MOTION_SIZE);
      if (previous) {
        const shift = phaseShift(previous.grid, grid, MOTION_SIZE);
        const seconds = ((thumb.index - previous.frame) * source.value.rate.den) / source.value.rate.num;
        const speed = Math.hypot(shift.dx, shift.dy) / MOTION_SIZE / Math.max(seconds, 1e-6);
        out.push({ frame: thumb.index, speed, dx: shift.dx, dy: shift.dy, peak: shift.peak });
      }
      previous = { frame: thumb.index, grid };
    }
  }
  return ok(out);
}
