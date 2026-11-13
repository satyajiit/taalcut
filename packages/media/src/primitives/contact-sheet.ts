// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One JPEG grid of chosen frames, and which frame each tile is. */
import { stat } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { reportDecodeRoute } from '../compute-report';
import { retryOnSoftware } from '../decode-routes/software-retry';
import { decodeHoldsVideoSession } from '../decode-routes/video-session';
import { FfmpegFailed } from '../errors';
import { runFfmpeg, type MediaContext } from '../ffmpeg';
import { appendVideo, selectFrames } from '../normalise/filters';
import { graphInputArgs, normalisationGraph } from '../normalise/graph';
import { resolveTone } from '../normalise/session';
import { outputSize } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';

export interface ContactSheetOptions {
  readonly frames: readonly number[];
  readonly columns: number;
  readonly tileLongSide: number;
  readonly out: string;
  readonly signal?: AbortSignal;
}

export interface ContactTile {
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export async function contactSheet(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  options: ContactSheetOptions,
): AsyncResult<{
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly tiles: readonly ContactTile[];
}> {
  const tone = await resolveTone(source, ctx, options.signal);
  if (!tone.ok) return tone;
  const plan = tone.value.plan;
  reportDecodeRoute(ctx, plan.decode);
  const columns = Math.max(1, Math.floor(options.columns));
  const frames = options.frames.length > 0 ? options.frames : [0];
  const tile = outputSize(plan, { longSide: options.tileLongSide });
  const rows = Math.ceil(frames.length / columns);
  const encoded = await retryOnSoftware(plan, ctx, (onRoute) => {
    const graph = appendVideo(
      normalisationGraph(onRoute, {
        route: onRoute.decode,
        toneMap: tone.value.tone,
        size: { width: tile.width, height: tile.height },
      }),
      `${selectFrames(frames)},tile=${columns}x${rows}`,
    );
    return runFfmpeg(
      ctx,
      ['-y', ...graphInputArgs(path, onRoute, graph, true), '-q:v', '3', '-update', '1', options.out],
      {
        holdsVideoSession: decodeHoldsVideoSession(onRoute.decode),
        timeoutMs: 180_000,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
  });
  if (!encoded.ok) return encoded;
  const tiles = frames.map((frame, index) => ({
    frame,
    x: (index % columns) * tile.width,
    y: Math.floor(index / columns) * tile.height,
    width: tile.width,
    height: tile.height,
  }));
  try {
    const bytes = (await stat(options.out)).size;
    return ok({ width: columns * tile.width, height: rows * tile.height, bytes, tiles });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'contact sheet missing';
    return err(FfmpegFailed({ exitCode: -1 }, { detail }));
  }
}
