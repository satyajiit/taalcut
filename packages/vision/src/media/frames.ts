// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frames on a video's grid, for every vision pass, through media's
 * normalisation plan and `sampleFrames`: VideoToolbox decode and scale,
 * upright (rotation and mirroring), HDR tone-mapped, on the plan's
 * constant-rate grid, a still on its pipe demuxer. The grid is the plan's
 * output rate, so shots, analyses and embeddings all count frames on it.
 *
 * Vision asks in its own terms: every n-th frame, a window of the grid, or
 * explicit frames (grouped into seeks no more than 2 s apart, so three
 * frames of an hour-long file don't decode the hour). Frames stream to
 * `onFrame`, or come back as a list without one.
 */
import {
  CancelledError,
  err,
  FrameRate,
  ok,
  RationalTime,
  ValidationError,
  type AsyncResult,
} from '@taalcut/core';
import {
  planNormalisation,
  probeMedia,
  sampleFrames as sampleGrid,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';

/** What a pass needs to know about the video: its upright size, grid and media's plan. */
export interface VideoSource {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly rate: FrameRate;
  /** Frames on the grid, when known. */
  readonly frameCount?: number;
  readonly plan: NormalisationPlan;
}

export interface SampledFrame {
  /** Index on the source's grid. */
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** rgb24 (3 bytes per pixel) or gray (1 byte per pixel), row-major. */
  readonly data: Uint8Array;
}

export type FrameFormat = 'rgb24' | 'gray';

export interface SampleOptions {
  /** Exactly this size (a model's input grid may differ from the picture's aspect). */
  readonly size: { readonly width: number; readonly height: number };
  readonly format: FrameFormat;
  /** Every n-th grid frame of the whole file (n ≥ 1): indexes are multiples of n. */
  readonly every?: number;
  /** Explicit grid indices instead of `every`. */
  readonly frames?: readonly number[];
  /** With `every`: only grid frames in [start, end). */
  readonly window?: { readonly start: number; readonly end: number };
  readonly signal?: AbortSignal;
  readonly onFrame?: (frame: SampledFrame) => void;
}

const TIMEOUT_MS = 30 * 60_000;
/** Explicit frames closer than this share one seek. */
const WINDOW_GAP_SECONDS = 2;

/** The probe's upright size and media's plan; a still gets a grid of 1/1 and one frame. */
export async function probeSource(
  ctx: MediaContext,
  path: string,
  signal?: AbortSignal,
): AsyncResult<VideoSource> {
  if (signal?.aborted) return err(CancelledError());
  const probe = await probeMedia(path, ctx, signal ? { signal } : {});
  if (!probe.ok) return probe;
  if (!probe.value.video) return err(ValidationError({ field: 'path' }, { detail: 'no video stream' }));
  const planned = planNormalisation(probe.value);
  if (!planned.ok) return planned;
  return ok(videoSourceOf(probe.value.path, planned.value));
}

/** The source a plan describes (normalise's stored plan: no probe needed). */
export function videoSourceOf(path: string, plan: NormalisationPlan): VideoSource {
  const still = plan.kind === 'image';
  return {
    path,
    width: plan.source.displayWidth || plan.source.width,
    height: plan.source.displayHeight || plan.source.height,
    rate: still ? FrameRate.of(1) : plan.frameRate.output,
    frameCount: still ? 1 : Math.max(1, plan.frames),
    plan,
  };
}

/** A size with the source's aspect, `longSide` on the long edge, both sides even. Never upscales. */
export function fitLongSide(
  width: number,
  height: number,
  longSide: number,
): { width: number; height: number } {
  const scale = Math.min(1, longSide / Math.max(width, height));
  const even = (n: number) => Math.max(2, 2 * Math.round((n * scale) / 2));
  return { width: even(width), height: even(height) };
}

interface Pass {
  /** Grid frame the pass's range starts on (0: no range). */
  readonly start: number;
  /** Frames on the grid after `start`; undefined runs to the end. */
  readonly length?: number;
  readonly every?: number;
  /** Explicit frames, relative to `start`. */
  readonly frames?: readonly number[];
}

/** Groups sorted frames into runs that one seek can cover. */
function windows(frames: readonly number[], rate: FrameRate): number[][] {
  const gap = (WINDOW_GAP_SECONDS * rate.num) / rate.den;
  const groups: number[][] = [];
  for (const frame of frames) {
    const current = groups[groups.length - 1];
    if (current && frame - (current[current.length - 1] as number) <= gap) current.push(frame);
    else groups.push([frame]);
  }
  return groups;
}

function passesFor(source: VideoSource, options: SampleOptions): Pass[] {
  if (options.frames) {
    const sorted = [...new Set(options.frames.filter((f) => Number.isInteger(f) && f >= 0))].sort(
      (a, b) => a - b,
    );
    if (source.plan.kind === 'image') return sorted.includes(0) ? [{ start: 0, frames: [0] }] : [];
    return windows(sorted, source.rate).map((group) => {
      const first = group[0] as number;
      const last = group[group.length - 1] as number;
      return { start: first, length: last - first + 1, frames: group.map((f) => f - first) };
    });
  }
  const every = Math.max(1, Math.round(options.every ?? 1));
  if (source.plan.kind === 'image') return [{ start: 0 }];
  const window = options.window;
  if (!window) return [{ start: 0, every }];
  // Indexes stay multiples of `every`, as a pass over the whole file reads them.
  const start = Math.ceil(Math.max(0, window.start) / every) * every;
  if (start >= window.end) return [];
  return [{ start, length: window.end - start, every }];
}

/**
 * Streams frames to `onFrame` (and returns them unless `onFrame` is given,
 * so a long pass keeps memory flat). Indices are grid frames.
 */
export async function sampleFrames(
  ctx: MediaContext,
  source: VideoSource,
  options: SampleOptions,
): AsyncResult<SampledFrame[]> {
  if (options.signal?.aborted) return err(CancelledError());
  const collected: SampledFrame[] = [];
  const sink = (frame: SampledFrame) => (options.onFrame ? options.onFrame(frame) : collected.push(frame));
  const rate = source.plan.frameRate.output;
  for (const pass of passesFor(source, options)) {
    if (options.signal?.aborted) return err(CancelledError());
    const range =
      source.plan.kind === 'video' && (pass.start > 0 || pass.length !== undefined)
        ? {
            start: RationalTime.of(pass.start, rate),
            ...(pass.length !== undefined ? { duration: RationalTime.of(pass.length, rate) } : {}),
          }
        : undefined;
    const run = await sampleGrid(source.path, source.plan, ctx, {
      size: options.size,
      format: options.format === 'gray' ? 'gray8' : 'rgb24',
      ...(pass.frames ? { frames: pass.frames } : {}),
      ...(pass.every ? { every: pass.every } : {}),
      ...(range ? { range } : {}),
      timeoutMs: TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      onFrame: (frame) => {
        if (frame.index < 0 || (pass.length !== undefined && frame.index >= pass.length)) return;
        sink({ index: pass.start + frame.index, width: frame.width, height: frame.height, data: frame.data });
      },
    });
    if (!run.ok) return run;
  }
  return ok(collected);
}
