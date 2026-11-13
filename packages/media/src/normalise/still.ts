// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One upright SDR JPEG. HEIC and HEIF (tiled grids included) always come
 * through here; JPEG and PNG only when the plan says they need a still.
 * The demuxer is left to sniff the file: this build has no HEIC muxer, and
 * forcing `-f heic` is not how the MOV demuxer reads a grid.
 */
import { stat } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { reportDecodeRoute } from '../compute-report';
import { retryOnSoftware } from '../decode-routes/software-retry';
import { decodeHoldsVideoSession } from '../decode-routes/video-session';
import { fileParams, StillDecodeFailed, UnsupportedMedia } from '../errors';
import { runFfmpeg, type MediaContext } from '../ffmpeg';
import { graphInputArgs, normalisationGraph } from './graph';
import { resolveTone } from './session';
import { uprightPixels } from './size';
import type { NormalisationPlan } from './types';

export interface StillOptions {
  readonly out: string;
  readonly signal?: AbortSignal;
}

export interface StillResult {
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export async function makeStill(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  options: StillOptions,
): AsyncResult<StillResult> {
  if (source.kind === 'audio') {
    return err(UnsupportedMedia(fileParams(path), { detail: 'no picture to decode' }));
  }
  const tone = await resolveTone(source, ctx, options.signal);
  if (!tone.ok) return tone;
  const plan = tone.value.plan;
  reportDecodeRoute(ctx, plan.decode);
  const encoded = await retryOnSoftware(plan, ctx, (onRoute) => {
    const graph = normalisationGraph(onRoute, { route: onRoute.decode, toneMap: tone.value.tone });
    return runFfmpeg(
      ctx,
      [
        '-y',
        ...graphInputArgs(path, onRoute, graph, true),
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-update',
        '1',
        options.out,
      ],
      {
        holdsVideoSession: decodeHoldsVideoSession(onRoute.decode),
        timeoutMs: 60_000,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
  });
  if (!encoded.ok) {
    if (encoded.error.code === 'media.cancelled' || encoded.error.code === 'media.timeout') return encoded;
    return err(StillDecodeFailed(fileParams(path), { detail: encoded.error.detail }));
  }
  const pixels = uprightPixels(plan);
  try {
    const bytes = (await stat(options.out)).size;
    return ok({ width: pixels.width, height: pixels.height, bytes });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'still output missing';
    return err(StillDecodeFailed(fileParams(path), { detail }));
  }
}
