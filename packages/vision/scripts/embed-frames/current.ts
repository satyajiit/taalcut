// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Today's `vision.embed` frame read, measured (IX2-G1): the stage's own path (a frame source over the
 * original with normalise's plan, a fresh frame cache, `frames()` at the embedder's index size), every
 * FFmpeg run timed, and the parts of one run taken apart on the same file: spawning FFmpeg, opening the
 * file and the decoder for one frame, decoding the GOP up to a frame, and scaling and downloading frames.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RationalTime } from '@taalcut/core';
import * as media from '@taalcut/media';
import type { FrameSize } from '../../src/media/frame-source';
import type { SampledFrame } from '../../src/media/frames';
import { openFrameSource } from '../../src/media/media-frame-source';
import type { EmbedRequest } from './requests';
import { keyframeBefore, keyframesOf, timed, timingContext, type ProcessTiming } from './timing';

export interface CurrentRead {
  readonly ms: number;
  readonly runs: readonly ProcessTiming[];
  readonly frames: readonly SampledFrame[];
}

/**
 * One read the stage's way, through a frame source with a private cache that goes when it closes; with
 * `decodeService`, as the jobs process reads with the decode service on (IX2-G3).
 */
export async function currentRead(
  ctx: media.MediaContext,
  request: EmbedRequest,
  size: FrameSize,
  scratch: string,
  decodeService?: media.DecodeService,
): Promise<CurrentRead> {
  const runs: ProcessTiming[] = [];
  const counted = timingContext(ctx, runs);
  const read = await timed(async () => {
    const opened = await openFrameSource(
      { media: counted, tempDir: scratch, ...(decodeService ? { decodeService } : {}) },
      { path: request.path, plan: request.plan },
    );
    if (!opened.ok) throw new Error(`open ${request.file}: ${opened.error.code}`);
    try {
      return await opened.value.frames({ size, format: 'rgb24', frames: request.frames });
    } finally {
      await opened.value.close();
    }
  });
  if (!read.value.ok) throw new Error(`frames ${request.file}: ${read.value.error.code}`);
  return { ms: read.ms, runs, frames: read.value.value };
}

export interface WindowShape {
  readonly first: number;
  readonly last: number;
  /** Frames the decoder decodes for the window: from the keyframe the seek lands on to its last frame. */
  readonly decoded: number;
  /** Frames it writes. */
  readonly out: number;
}

/** The seek windows the read makes (decode-frame-sets.ts), with what each one decodes. */
export async function windowShapes(ctx: media.MediaContext, request: EmbedRequest): Promise<WindowShape[]> {
  const rate = request.plan.frameRate.output;
  const keyframes = await keyframesOf(
    ctx,
    request.path,
    request.plan,
    RationalTime.toSeconds(request.plan.start),
  );
  const unique = [...new Set(request.frames)];
  return media.seekWindows(unique, rate.num / rate.den).map((window) => {
    // The seek is half a frame before the window (rangeSeek): a window that starts on a keyframe lands on the one before.
    const from = window.first > 0 ? keyframeBefore(keyframes, window.first - 1) : 0;
    const out = unique.filter((f) => f >= window.first && f <= window.last).length;
    return { first: window.first, last: window.last, decoded: window.last - from + 1, out };
  });
}

export interface RunParts {
  /** `ffmpeg -version`: the process alone. */
  readonly spawnMs: number;
  /** Frame 0 alone at the embedder's size: spawn, open, the decoder session, one keyframe, scale, download. */
  readonly oneFrameMs: number;
  /** Frames 0–29 decoded, the last one written. */
  readonly gopOneOutMs: number;
  /** Frames 0–29 decoded, all 30 written. */
  readonly gopAllOutMs: number;
}

async function decodeOnce(
  ctx: media.MediaContext,
  request: EmbedRequest,
  size: FrameSize,
  frames: readonly number[],
  dir: string,
): Promise<number> {
  await mkdir(dir, { recursive: true });
  const target: media.GraphSize =
    'longSide' in size
      ? { longSide: size.longSide }
      : { width: size.width, height: size.height, exact: true };
  const run = await timed(() =>
    media.decodeFrameSets(request.path, request.plan, ctx, {
      sets: [{ set: 'g1', size: target, format: 'rgb24', frames }],
      dir,
    }),
  );
  await rm(dir, { recursive: true, force: true });
  if (!run.value.ok) throw new Error(`decode ${request.file}: ${run.value.error.code}`);
  return run.ms;
}

/** The parts of one FFmpeg run on this file, each measured once (the caller repeats). */
export async function runParts(
  ctx: media.MediaContext,
  request: EmbedRequest,
  size: FrameSize,
  scratch: string,
): Promise<RunParts> {
  const spawn = await timed(() => (ctx.runner ?? media.runProcess)(ctx.binaries.ffmpeg, ['-version']));
  if (!spawn.value.ok) throw new Error(`ffmpeg -version: ${spawn.value.error.code}`);
  const dir = join(scratch, 'parts');
  const gop = Array.from({ length: 30 }, (_, i) => i);
  return {
    spawnMs: spawn.ms,
    oneFrameMs: await decodeOnce(ctx, request, size, [0], dir),
    gopOneOutMs: await decodeOnce(ctx, request, size, [29], dir),
    gopAllOutMs: await decodeOnce(ctx, request, size, gop, dir),
  };
}
