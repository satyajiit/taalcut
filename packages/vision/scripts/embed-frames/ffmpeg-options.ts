// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-G2 option 3 on FFmpeg, measured on the same frames: wider seek windows (fewer FFmpeg runs, more of the
 * file decoded), and keyframe-only reads (the first keyframe at or after each frame, `-skip_frame nokey`, the
 * thumbnail's way: other frames than today's, so it is timed only).
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RationalTime } from '@taalcut/core';
import * as media from '@taalcut/media';
import type { EmbedRequest } from './requests';

type Size = { readonly width: number; readonly height: number };
import { ffmpegRuns, timed, timingContext, type ProcessTiming } from './timing';

export interface OptionRun {
  readonly ms: number;
  readonly ffmpeg: number;
  readonly frames: number;
}

/** Today's read with windows `gapSeconds` wide instead of 2 s (no cache: every frame decoded). */
export async function widerWindows(
  ctx: media.MediaContext,
  request: EmbedRequest,
  size: { width: number; height: number },
  gapSeconds: number,
  scratch: string,
): Promise<OptionRun> {
  const dir = join(scratch, `gap-${gapSeconds}`);
  await mkdir(dir, { recursive: true });
  const runs: ProcessTiming[] = [];
  const run = await timed(() =>
    media.decodeFrameSets(request.path, request.plan, timingContext(ctx, runs), {
      sets: [{ set: 'g2', size: { ...size, exact: true }, format: 'rgb24', frames: request.frames }],
      dir,
      windowGapSeconds: gapSeconds,
    }),
  );
  await rm(dir, { recursive: true, force: true });
  if (!run.value.ok) throw new Error(`gap ${gapSeconds} ${request.file}: ${run.value.error.code}`);
  const frames = run.value.value.reduce((n, file) => n + file.slots.length, 0);
  return { ms: run.ms, ffmpeg: ffmpegRuns(runs), frames };
}

/** The first keyframe at or after each frame, keyframes only (yuv420p at the same size). */
export async function keyframesOnly(
  ctx: media.MediaContext,
  request: EmbedRequest,
  size: { width: number; height: number },
  scratch: string,
): Promise<OptionRun> {
  const dir = join(scratch, 'keyframes');
  await mkdir(dir, { recursive: true });
  const rate = request.plan.frameRate.output;
  const targets = [...new Set(request.frames)].map((f) => RationalTime.toSeconds(RationalTime.of(f, rate)));
  const runs: ProcessTiming[] = [];
  const run = await timed(() =>
    media.decodeKeyframes(request.path, request.plan, timingContext(ctx, runs), {
      targets,
      size: { ...size, exact: true },
      dir,
    }),
  );
  await rm(dir, { recursive: true, force: true });
  if (!run.value.ok) throw new Error(`keyframes ${request.file}: ${run.value.error.code}`);
  return { ms: run.ms, ffmpeg: ffmpegRuns(runs), frames: run.value.value?.count ?? 0 };
}

export interface PassRun extends OptionRun {
  /** Bytes the kept frame sets take. */
  readonly bytes: number;
}

/**
 * Option 1's price: the analysis pass as `vision.shots` runs it (OCR frames kept: one a second at 1280 px), and
 * with embedder-size frames kept too, every `every`-th grid frame (`undefined`: none).
 */
export async function passWithEmbedFrames(
  ctx: media.MediaContext,
  request: EmbedRequest,
  sizes: { readonly embed: Size; readonly ocr: Size },
  every: number | undefined,
  scratch: string,
): Promise<PassRun> {
  const { embed: size, ocr } = sizes;
  const dir = join(scratch, `pass-${every ?? 0}`);
  await mkdir(dir, { recursive: true });
  const rate = request.plan.frameRate.output;
  const fps = rate.num / rate.den;
  const sets: media.PassFrameSet[] = [
    {
      set: 'ocr',
      size: { ...ocr, exact: true },
      format: 'rgb24',
      every: Math.max(1, Math.round(fps)),
      maxFrames: 1e6,
    },
    ...(every
      ? [{ set: 'embed', size: { ...size, exact: true }, format: 'rgb24' as const, every, maxFrames: 1e6 }]
      : []),
  ];
  const runs: ProcessTiming[] = [];
  const run = await timed(() =>
    media.runAnalysisPass(request.path, request.plan, timingContext(ctx, runs), {
      size: 256,
      coarseEvery: Math.max(1, Math.round(fps / 10)),
      frameSets: sets,
      dir,
    }),
  );
  await rm(dir, { recursive: true, force: true });
  if (!run.value.ok) throw new Error(`pass ${request.file}: ${run.value.error.code}`);
  const embed = run.value.value.files.filter((file) => file.set === 'embed');
  return {
    ms: run.ms,
    ffmpeg: ffmpegRuns(runs),
    frames: embed.reduce((n, file) => n + file.slots.length, 0),
    bytes: embed.reduce((n, file) => n + file.bytes, 0),
  };
}
