// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The first keyframe at or after each target time, decoded alone (IX2-T2):
 * one keyframe-only run per window (keyframe-windows.ts), each writing its
 * picked frames to a raw file in `dir`. Distinct keyframes only, so a file
 * whose keyframes are far apart gives fewer frames than targets; the caller
 * decides whether that is enough. A route whose decoder can't skip to
 * keyframes gives `undefined`, and the caller reads exact frames instead. A
 * hardware decoder that won't start reads them again on the software route
 * (decode-routes/software-retry.ts, IX2-F6).
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ok, RationalTime, type AsyncResult } from '@taalcut/core';
import type { ToneMapChoice } from '../backends';
import { reportDecodeRoute } from '../compute-report';
import { decodeRouteFor, type DecodeProfile } from '../decode-routes/select-route';
import { retryOnSoftware } from '../decode-routes/software-retry';
import type { MediaContext } from '../ffmpeg';
import { frameFileArgs } from '../frame-sets/decode-frame-sets';
import { indexFrameFile, withoutFiles, type FrameFile } from '../frame-sets/frame-files';
import type { GraphSize } from '../normalise/graph';
import { resolveTone } from '../normalise/session';
import { outputSize } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';
import { runFfmpegRaw } from '../run-raw';
import { keyframeArgs } from './keyframe-graph';
import { firstAtOrAfter, keyframeWindows } from './keyframe-windows';

export interface DecodeKeyframesOptions {
  /** Seconds from the start of the file. */
  readonly targets: readonly number[];
  readonly size: GraphSize;
  /** Where the raw yuv420p files are written; the caller deletes them. */
  readonly dir: string;
  readonly profile?: DecodeProfile;
  readonly signal?: AbortSignal;
  /** Per FFmpeg run. Default 2 minutes. */
  readonly timeoutMs?: number;
  /** Tests and the T1 bench: targets closer than this share a run (default `KEYFRAME_WINDOW_GAP_SECONDS`). */
  readonly gapSeconds?: number;
}

export interface DecodedKeyframes {
  /** One file per run, frames in time order. */
  readonly files: readonly FrameFile[];
  /** Frames over all files. */
  readonly count: number;
  /** How many FFmpeg runs read them. */
  readonly runs: number;
}

const TIMEOUT_MS = 120_000;

export async function decodeKeyframes(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  options: DecodeKeyframesOptions,
): AsyncResult<DecodedKeyframes | undefined> {
  if (source.kind !== 'video') return ok(undefined);
  const tone = await resolveTone(source, ctx, options.signal);
  if (!tone.ok) return tone;
  if (!decodeRouteFor(tone.value.plan, options.profile).honoursSkipFrame) return ok(undefined);
  reportDecodeRoute(ctx, tone.value.plan.decode);
  return retryOnSoftware(tone.value.plan, ctx, (plan) =>
    keyframesOnRoute(path, plan, tone.value.tone, ctx, options),
  );
}

/** Every window's keyframe-only run on the plan's route; a failed run's files are removed. */
async function keyframesOnRoute(
  path: string,
  plan: NormalisationPlan,
  toneMap: ToneMapChoice,
  ctx: MediaContext,
  options: DecodeKeyframesOptions,
): AsyncResult<DecodedKeyframes> {
  const route = decodeRouteFor(plan, options.profile);
  const pixels = outputSize(plan, options.size);
  const windows = keyframeWindows(options.targets, {
    duration: RationalTime.toSeconds(plan.duration),
    ...(options.gapSeconds !== undefined ? { gapSeconds: options.gapSeconds } : {}),
  });
  const files: FrameFile[] = [];
  const written: string[] = [];
  let count = 0;
  for (const window of windows) {
    const out = join(options.dir, `${randomUUID()}.raw`);
    written.push(out);
    const args = [
      '-y',
      ...keyframeArgs(path, plan, {
        route,
        toneMap,
        size: options.size,
        window,
        pick: [firstAtOrAfter(window.targets)],
      }),
      // A run ends at its last target's keyframe; when targets share one, at the end of its stretch.
      ...['-frames:v', String(window.targets.length), '-fps_mode', 'passthrough'],
      ...frameFileArgs('yuv420p'),
      out,
    ];
    const run = await runFfmpegRaw(ctx, args, {
      holdsVideoSession: route.holdsVideoSession,
      timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!run.ok) return withoutFiles(written, run);
    const indexed = await indexFrameFile({
      set: 'keyframes',
      path: out,
      format: 'yuv420p',
      width: pixels.width,
      height: pixels.height,
      frames: window.targets.map((_, k) => count + k),
    });
    if (!indexed.ok) return withoutFiles(written, indexed);
    files.push(indexed.value);
    count += indexed.value.slots.length;
  }
  return ok({ files, count, runs: windows.length });
}
