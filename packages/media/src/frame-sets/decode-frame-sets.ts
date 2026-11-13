// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Explicit grid frames at several sizes and formats, in as few decodes as
 * possible: the frames of every set are grouped into windows (frames closer
 * than 2 s share one seek, so three frames of an hour-long file don't decode
 * the hour), and each window is one FFmpeg run whose branches write each
 * set's frames to its own file in `dir` (frame-files.ts indexes them). The
 * caller keeps the files (a frame cache adopts them) or deletes them. A
 * hardware decoder that won't start runs the whole read again on the
 * software route (decode-routes/software-retry.ts, IX2-F6). With a decode
 * service (IX2-G3, service-frame-sets.ts) every set's frames come from one
 * decoder session instead, FFmpeg's seeks being the logged fallback.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ok, RationalTime, type AsyncResult } from '@taalcut/core';
import type { ToneMapChoice } from '../backends';
import { decodeRouteFor } from '../decode-routes/select-route';
import { onDecodeRoute } from '../decode-routes/software-retry';
import { serviceFor } from '../decode-service/switch';
import type { MediaContext } from '../ffmpeg';
import { outputSize } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';
import { runFfmpegRaw } from '../run-raw';
import { branchGraph, type GraphBranch } from './branch-graph';
import { indexFrameFile, withoutFiles, type FrameFile } from './frame-files';
import {
  FRAME_SETS_TIMEOUT_MS,
  frameFileArgs,
  seekWindows,
  type DecodeFrameSetsOptions,
} from './frame-set-request';
import { serviceFrameSets } from './service-frame-sets';

export {
  frameFileArgs,
  seekWindows,
  WINDOW_GAP_SECONDS,
  type DecodeFrameSetsOptions,
  type FrameSetRequest,
} from './frame-set-request';

export async function decodeFrameSets(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  options: DecodeFrameSetsOptions,
): AsyncResult<FrameFile[]> {
  const service = serviceFor(options.decodeService, 'frames');
  return onDecodeRoute(source, ctx, options.signal, async (plan, toneMap) => {
    // The decode service first (one decoder session for every frame, IX2-G3); FFmpeg's seeks when it declines
    // the picture or fails. On the software route (a hardware decoder that wouldn't start) it declines.
    const served = service
      ? await serviceFrameSets(path, plan, ctx, { ...options, decodeService: service })
      : undefined;
    return served ?? framesOnRoute(path, plan, toneMap, ctx, options);
  });
}

/** Every window's run on the plan's route; a failed run's files are removed. */
async function framesOnRoute(
  path: string,
  plan: NormalisationPlan,
  toneMap: ToneMapChoice,
  ctx: MediaContext,
  options: DecodeFrameSetsOptions,
): AsyncResult<FrameFile[]> {
  const route = decodeRouteFor(plan, options.profile);
  const still = plan.kind !== 'video';
  const rate = plan.frameRate.output;
  const all = options.sets.flatMap((set) => (still ? set.frames.filter((f) => f === 0) : set.frames));
  const files: FrameFile[] = [];
  const written: string[] = [];
  for (const window of seekWindows(all, rate.num / rate.den, options.windowGapSeconds)) {
    const inWindow = options.sets
      .map((set) => ({
        set,
        frames: [...new Set(set.frames)]
          .filter((f) => f >= window.first && f <= window.last)
          .sort((a, b) => a - b),
      }))
      .filter((entry) => entry.frames.length > 0);
    const branches: GraphBranch[] = inWindow.map((entry) => ({
      size: entry.set.size,
      pick: { frames: entry.frames.map((f) => f - window.first) },
    }));
    const range = still
      ? undefined
      : {
          start: RationalTime.of(window.first, rate),
          duration: RationalTime.of(window.last - window.first + 1, rate),
        };
    const graph = branchGraph(path, plan, {
      route,
      toneMap,
      branches,
      ...(range ? { range } : {}),
    });
    const outputs = inWindow.map((entry) => ({
      ...entry,
      path: join(options.dir, `${randomUUID()}.${entry.set.format === 'jpeg' ? 'mjpeg' : 'raw'}`),
    }));
    const args = [
      '-y',
      ...graph.args,
      ...outputs.flatMap((output, i) => [
        '-map',
        graph.outputs[i] as string,
        '-fps_mode',
        'passthrough',
        ...frameFileArgs(output.set.format, output.set.jpegQuality),
        output.path,
      ]),
    ];
    written.push(...outputs.map((output) => output.path));
    const run = await runFfmpegRaw(ctx, args, {
      holdsVideoSession: route.holdsVideoSession,
      timeoutMs: options.timeoutMs ?? FRAME_SETS_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!run.ok) return withoutFiles(written, run);
    for (const output of outputs) {
      const pixels = outputSize(plan, output.set.size);
      const indexed = await indexFrameFile({
        set: output.set.set,
        path: output.path,
        format: output.set.format,
        width: pixels.width,
        height: pixels.height,
        frames: output.frames,
      });
      if (!indexed.ok) return withoutFiles(written, indexed);
      files.push(indexed.value);
    }
  }
  return ok(files);
}
