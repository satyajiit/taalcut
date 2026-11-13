// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 400 px long side. Video picks the most representative (FFmpeg's
 * `thumbnail` filter) of its poster candidates: since IX2-T2 the first
 * keyframe at or after 10, 30, 50, 70 and 90 percent, decoded alone, or the
 * exact frames at those points when the clip has too few keyframes
 * (poster-frames.ts). The candidates are written as raw yuv420p and a second
 * FFmpeg run with no video decode picks and encodes one. Stills are the one
 * decoded picture.
 */
import { randomUUID } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ok, type AsyncResult } from '@taalcut/core';
import { reportAnalysisFilters, reportDecodeRoute } from '../compute-report';
import type { DecodeProfile } from '../decode-routes/select-route';
import { retryOnSoftware } from '../decode-routes/software-retry';
import { decodeHoldsVideoSession } from '../decode-routes/video-session';
import { runFfmpeg, type MediaContext } from '../ffmpeg';
import { frameFileError, removeFrameFiles } from '../frame-sets/frame-files';
import { fileInput } from '../input';
import { graphInputArgs, normalisationGraph } from '../normalise/graph';
import { resolveTone } from '../normalise/session';
import { outputSize } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';
import { posterFrames, type PosterFrameOptions, type PosterSource } from './poster-frames';

export const THUMB_LONG_SIDE = 400;

type Made = {
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** Where a video's candidates came from; stills have none. */
  readonly source?: PosterSource;
};

export interface ThumbnailOptions {
  readonly signal?: AbortSignal;
  readonly profile?: DecodeProfile;
  /** Tests and the T1 bench: how the candidates are read (`PosterFrameOptions.route`). */
  readonly route?: PosterFrameOptions['route'];
}

/** The candidates, written to one raw file next to `out`, then picked and encoded without a decode. */
async function videoThumbnail(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  out: string,
  options: ThumbnailOptions,
): AsyncResult<Made> {
  const { signal } = options;
  const dir = dirname(out);
  const size = { longSide: THUMB_LONG_SIDE };
  const candidates = await posterFrames(path, plan, ctx, {
    size,
    dir,
    ...(options.profile ? { profile: options.profile } : {}),
    ...(signal ? { signal } : {}),
    ...(options.route ? { route: options.route } : {}),
  });
  if (!candidates.ok) return candidates;
  const { frames, source } = candidates.value;
  if (frames.length === 0) return frameFileError(undefined, 'no thumbnail frames decoded');
  const pixels = outputSize(plan, size);
  const raw = join(dir, `${randomUUID()}.yuv`);
  try {
    await writeFile(raw, Buffer.concat(frames));
    reportAnalysisFilters(ctx);
    const picked = await runFfmpeg(
      ctx,
      [
        ...['-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${pixels.width}x${pixels.height}`],
        ...['-framerate', '1', '-i', fileInput(raw)],
        ...['-vf', `thumbnail=n=${frames.length}`, '-frames:v', '1', '-q:v', '2', '-update', '1', out],
      ],
      // Picks among raw frames already read, on the CPU: no video session.
      { holdsVideoSession: false, timeoutMs: 60_000, ...(signal ? { signal } : {}) },
    );
    if (!picked.ok) return picked;
    return ok({ width: pixels.width, height: pixels.height, bytes: (await stat(out)).size, source });
  } catch (cause) {
    return frameFileError(cause, 'thumbnail frames unreadable');
  } finally {
    await removeFrameFiles([raw]);
  }
}

export async function makeThumbnail(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  out: string,
  options: ThumbnailOptions = {},
): AsyncResult<Made> {
  if (source.kind === 'video') return videoThumbnail(path, source, ctx, out, options);
  const { signal } = options;
  const tone = await resolveTone(source, ctx, signal);
  if (!tone.ok) return tone;
  const plan = tone.value.plan;
  reportDecodeRoute(ctx, plan.decode);
  const size = { longSide: THUMB_LONG_SIDE };
  const picture = ['-frames:v', '1', '-q:v', '2', '-update', '1', out];
  const encoded = await retryOnSoftware(plan, ctx, (onRoute) => {
    const graph = normalisationGraph(onRoute, { route: onRoute.decode, toneMap: tone.value.tone, size });
    return runFfmpeg(ctx, ['-y', ...graphInputArgs(path, onRoute, graph, true), ...picture], {
      holdsVideoSession: decodeHoldsVideoSession(onRoute.decode),
      timeoutMs: 120_000,
      ...(signal ? { signal } : {}),
    });
  });
  if (!encoded.ok) return encoded;
  const pixels = outputSize(plan, size);
  try {
    return ok({ width: pixels.width, height: pixels.height, bytes: (await stat(out)).size });
  } catch (cause) {
    return frameFileError(cause, 'thumbnail missing');
  }
}
