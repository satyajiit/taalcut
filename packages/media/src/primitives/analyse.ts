// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One decode: scene scores, black and freeze intervals. The analysis filters
 * run after the GPU download; they have no VideoToolbox implementation, so
 * the CPU choice is recorded once per process. Flat frames are kept
 * (`sc_pass=1`). A missing freeze_end runs to the clip end.
 *
 * Samples are `fps` a second (default 10), or with `every`, every n-th frame
 * of the plan's own grid (1: each frame, for cuts to the frame); then a
 * sample's time is its count from the range's start over the grid rate
 * divided by `every`, so `index = round(timeSec · rate) · every`. A hardware
 * decoder that won't start runs it again on the software route, unless
 * samples already went out (IX2-F6).
 */
import { FrameRate, RationalTime, ok, type AsyncResult } from '@taalcut/core';
import type { ToneMapChoice } from '../backends';
import { reportAnalysisFilters } from '../compute-report';
import { onDecodeRoute } from '../decode-routes/software-retry';
import { decodeHoldsVideoSession } from '../decode-routes/video-session';
import type { MediaContext } from '../ffmpeg';
import { appendVideo } from '../normalise/filters';
import { graphInputArgs, normalisationGraph, type GraphRange } from '../normalise/graph';
import { outputSize } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';
import { runFfmpegRaw } from '../run-raw';
import {
  parseBlackdetect,
  parseFreezedetect,
  parseSceneScores,
  type SceneScore,
  type TimeInterval,
} from './parsers';
import { splitRaw } from './split';

const ANALYSIS = 'scdet=threshold=0:sc_pass=1,metadata=print,blackdetect,freezedetect';

export interface AnalyseOptions {
  readonly fps?: number;
  /** Every n-th frame of the plan's grid instead of `fps`. */
  readonly every?: number;
  /** Default 180 s. */
  readonly timeoutMs?: number;
  readonly size?: number;
  readonly range?: GraphRange;
  readonly thumbnails?: boolean;
  /** With `thumbnails`: each sample's gray pixels (`index` counts samples from the range's start). */
  readonly onSample?: (sample: {
    readonly index: number;
    readonly data: Buffer;
    readonly width: number;
    readonly height: number;
  }) => void;
  readonly signal?: AbortSignal;
}

export interface AnalyseResult {
  readonly scenes: readonly SceneScore[];
  readonly black: readonly TimeInterval[];
  readonly freeze: readonly TimeInterval[];
}

export async function analyseVideo(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  options: AnalyseOptions = {},
): AsyncResult<AnalyseResult> {
  // The analysis filters run on the CPU whatever the route (one record per process).
  reportAnalysisFilters(ctx);
  const { onSample } = options;
  return onDecodeRoute(source, ctx, options.signal, (plan, toneMap, counted) =>
    analyseOnRoute(
      path,
      plan,
      toneMap,
      ctx,
      onSample ? { ...options, onSample: counted(onSample) } : options,
    ),
  );
}

async function analyseOnRoute(
  path: string,
  plan: NormalisationPlan,
  toneMap: ToneMapChoice,
  ctx: MediaContext,
  options: AnalyseOptions,
): AsyncResult<AnalyseResult> {
  const size = { longSide: options.size ?? 256 };
  const pixels = outputSize(plan, size);
  const every = options.every === undefined ? undefined : Math.max(1, Math.round(options.every));
  const fps = every === undefined ? FrameRate.of(Math.max(1, Math.round(options.fps ?? 10))) : undefined;
  const select =
    every !== undefined && every > 1 ? `select='not(mod(n\\,${every}))',setpts=N/FRAME_RATE/TB,` : '';
  const graph = appendVideo(
    normalisationGraph(plan, {
      route: plan.decode,
      toneMap,
      size,
      ...(fps ? { fps } : {}),
      ...(options.range ? { range: options.range } : {}),
      // The analysis frames convert on one thread where they reach the CPU at their size (IX2-F15).
      repeatable: true,
    }),
    `${select}${ANALYSIS}`,
  );
  const log: Buffer[] = [];
  let index = 0;
  const onStdout = options.thumbnails
    ? splitRaw(pixels.width * pixels.height, (data) => {
        options.onSample?.({ index, data, width: pixels.width, height: pixels.height });
        index += 1;
      })
    : undefined;
  const tail = options.thumbnails ? ['-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'] : ['-f', 'null', '-'];
  const encoded = await runFfmpegRaw(
    ctx,
    ['-y', '-loglevel', 'info', ...graphInputArgs(path, plan, graph, true), ...tail],
    {
      holdsVideoSession: decodeHoldsVideoSession(plan.decode),
      ...(onStdout ? { onStdout } : {}),
      onStderr: (chunk) => log.push(chunk),
      timeoutMs: options.timeoutMs ?? 180_000,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (!encoded.ok) return encoded;
  const text = Buffer.concat(log).toString('utf8');
  const endSec = RationalTime.toSeconds(options.range?.duration ?? plan.duration);
  return ok({
    scenes: parseSceneScores(text),
    black: parseBlackdetect(text),
    freeze: parseFreezedetect(text, endSec),
  });
}
