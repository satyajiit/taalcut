// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Upright SDR frames on the plan's grid, one at a time. `frames` selects
 * indexes; `every` keeps every n-th grid frame; `fps` replaces the grid rate.
 * With a `range`, indexes count from its start (the range seeks first). Raw
 * sizes match the graph's even dimensions so the splitter stays aligned; a
 * `{ width, height }` size is exact (a model's input grid), a number is the
 * long side. A hardware decoder that won't start reads them again on the
 * software route, unless frames already went out (IX2-F6).
 */
import { FrameRate, ok, type AsyncResult } from '@taalcut/core';
import type { ToneMapChoice } from '../backends';
import { onDecodeRoute } from '../decode-routes/software-retry';
import { decodeHoldsVideoSession } from '../decode-routes/video-session';
import type { MediaContext } from '../ffmpeg';
import { appendVideo, selectFrames } from '../normalise/filters';
import { selectedFrames } from '../normalise/frame-select';
import { graphInputArgs, normalisationGraph, type GraphRange } from '../normalise/graph';
import { outputSize } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';
import { runFfmpegRaw } from '../run-raw';
import { splitJpeg, splitRaw } from './split';

export interface SampledFrame {
  readonly index: number;
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface SampleFramesOptions {
  readonly fps?: number;
  readonly frames?: readonly number[];
  /** Every n-th grid frame from the range's start (n ≥ 1); ignored with `frames`. */
  readonly every?: number;
  readonly size: number | { readonly width: number; readonly height: number };
  /** Default 180 s. */
  readonly timeoutMs?: number;
  readonly format: 'rgb24' | 'gray8' | 'jpeg';
  readonly range?: GraphRange;
  readonly onFrame: (frame: SampledFrame) => void;
  readonly signal?: AbortSignal;
}

export async function sampleFrames(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  options: SampleFramesOptions,
): AsyncResult<{ readonly frames: number; readonly width: number; readonly height: number }> {
  return onDecodeRoute(source, ctx, options.signal, (plan, toneMap, counted) =>
    sampleOnRoute(path, plan, toneMap, ctx, { ...options, onFrame: counted(options.onFrame) }),
  );
}

async function sampleOnRoute(
  path: string,
  plan: NormalisationPlan,
  toneMap: ToneMapChoice,
  ctx: MediaContext,
  options: SampleFramesOptions,
): AsyncResult<{ readonly frames: number; readonly width: number; readonly height: number }> {
  const box =
    typeof options.size === 'number'
      ? { longSide: options.size }
      : { width: options.size.width, height: options.size.height, exact: true };
  const pixels = outputSize(plan, box);
  const fps = options.fps === undefined ? undefined : FrameRate.of(Math.max(1, Math.round(options.fps)));
  let graph = normalisationGraph(plan, {
    route: plan.decode,
    toneMap,
    size: box,
    ...(fps ? { fps } : {}),
    ...(options.range ? { range: options.range } : {}),
    // Raw frames convert on one thread where they reach the CPU at their size (IX2-F15).
    ...(options.format === 'jpeg' ? {} : { repeatable: true }),
  });
  const picked = options.frames;
  const every = Math.max(1, Math.round(options.every ?? 1));
  if (picked && picked.length > 0) graph = appendVideo(graph, selectFrames(picked));
  else if (every > 1) graph = appendVideo(graph, `select='not(mod(n\\,${every}))',setpts=N/FRAME_RATE/TB`);
  const indexes = picked && picked.length > 0 ? selectedFrames(picked).sort((a, b) => a - b) : [];
  let seen = 0;
  const deliver = (data: Buffer) => {
    const index = indexes.length > 0 ? (indexes[seen] ?? -1) : seen * every;
    seen += 1;
    options.onFrame({ index, data, width: pixels.width, height: pixels.height });
  };
  const channels = options.format === 'gray8' ? 1 : 3;
  const onStdout =
    options.format === 'jpeg'
      ? splitJpeg(deliver)
      : splitRaw(pixels.width * pixels.height * channels, deliver);
  const pix = options.format === 'gray8' ? 'gray' : 'rgb24';
  const tail =
    options.format === 'jpeg'
      ? ['-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1']
      : ['-f', 'rawvideo', '-pix_fmt', pix, 'pipe:1'];
  const encoded = await runFfmpegRaw(ctx, ['-y', ...graphInputArgs(path, plan, graph, true), ...tail], {
    holdsVideoSession: decodeHoldsVideoSession(plan.decode),
    onStdout,
    timeoutMs: options.timeoutMs ?? 180_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!encoded.ok) return encoded;
  return ok({ frames: seen, width: pixels.width, height: pixels.height });
}
