// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The CPU FFmpeg that reads the decode service's analysis frames (helper-pass.ts): raw NV12 from a FIFO,
 * tagged with the stream's range, on the pass's grid, through the branches FFmpeg's own route runs after
 * its download: every frame to scdet, blackdetect and freezedetect (and as gray to stdout), every
 * `coarseEvery`-th to scdet again, and the small RGB stream's tap (IX2-C3) as on FFmpeg's route. It decodes
 * nothing, so it holds no hardware session.
 */
import type { AsyncResult, FrameRate } from '@taalcut/core';
import type { MediaContext } from '../ffmpeg';
import { pickFilters } from '../frame-sets/branch-graph';
import { fileInput } from '../input';
import { CONVERT_ONE_THREAD, ONE_THREAD_SCALES } from '../normalise/one-thread';
import type { ProcessOutput } from '../process/runner';
import { filterPathArg } from '../primitives/filter-path';
import { splitRaw } from '../primitives/split';
import { runFfmpegRaw } from '../run-raw';
import type { HelperPassPlan } from './helper-eligible';
import { DETECT_LINES, detectorFilters, SCDET } from './pass-common';
import type { DetectMinimum, PassFrame } from './pass-types';
import type { StreamPart } from './rgb-stream';
import { lineFilter } from './scene-file';

export interface ReaderSpec {
  readonly fifo: string;
  readonly fineFile: string;
  readonly coarseFile: string;
  /** 0: no coarse branch. */
  readonly coarseEvery: number;
  readonly rate: FrameRate;
  readonly detectMinSeconds?: DetectMinimum;
  /** Gray frames to stdout (for `onFrame`), else the analysis branch ends in a null output. */
  readonly grayOut: boolean;
  /** The small RGB stream's tap and output (none without a stream). */
  readonly stream: Pick<StreamPart, 'taps' | 'outputArgs'>;
}

type ReaderUse = Pick<HelperPassPlan, 'analysis' | 'range'>;

export function readerArgs(use: ReaderUse, spec: ReaderSpec): string[] {
  const { width, height } = use.analysis;
  const taps = spec.stream.taps;
  const fine = [
    // With a tap, the analysis path converts on its own, after the split: a gray output would otherwise turn
    // the frames gray before it, the tap's included (branch-graph.ts).
    ...(taps.length > 0 ? [CONVERT_ONE_THREAD] : []),
    SCDET,
    `metadata=mode=print:file=${filterPathArg(spec.fineFile)}`,
    ...detectorFilters(spec.detectMinSeconds),
  ].join(',');
  const coarse =
    spec.coarseEvery > 0
      ? [
          ...pickFilters({ every: spec.coarseEvery }),
          SCDET,
          `metadata=mode=print:file=${filterPathArg(spec.coarseFile)}`,
        ].join(',')
      : undefined;
  const tapChains = taps.map((tap) => [...pickFilters(tap.pick), ...tap.filters].join(',') || 'null');
  const chains = [fine, ...(coarse ? [coarse] : []), ...tapChains];
  const splits = chains.map((_, i) => `[s${i}]`).join('');
  const graph =
    chains.length > 1
      ? [`[0:v]split=${chains.length}${splits}`, ...chains.map((chain, i) => `[s${i}]${chain}[o${i}]`)].join(
          ';',
        )
      : `[0:v]${fine}[o0]`;
  const analysisOut = spec.grayOut ? ['-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'] : ['-f', 'null', '-'];
  return [
    '-y',
    '-loglevel',
    'info',
    ...['-protocol_whitelist', 'file', '-f', 'rawvideo', '-pixel_format', 'nv12'],
    ...['-video_size', `${width}x${height}`, '-framerate', `${spec.rate.num}/${spec.rate.den}`],
    ...['-color_range', use.range === 'full' ? 'pc' : 'tv', '-i', fileInput(spec.fifo)],
    // The frames only convert here (and the tap squeezes them small): on one thread, so they repeat (IX2-F15).
    ...['-filter_complex', `${ONE_THREAD_SCALES}${graph}`],
    ...['-map', '[o0]', '-fps_mode', 'passthrough', ...analysisOut],
    ...(coarse ? ['-map', '[o1]', '-fps_mode', 'passthrough', '-f', 'null', '-'] : []),
    ...spec.stream.outputArgs(taps.length > 0 ? `[o${chains.length - 1}]` : undefined),
  ];
}

export interface RunningReader {
  /** The reader's exit: at the FIFO's end, or when stopped. */
  readonly done: AsyncResult<ProcessOutput>;
  /** Gray frames handed to `onFrame` so far. */
  delivered(): number;
  /** blackdetect's and freezedetect's lines. */
  detections(): string;
  /** Ends a reader still waiting on a FIFO nobody opened (it would wait for ever). */
  stop(): void;
}

export interface ReaderRun {
  readonly from: number;
  readonly onFrame?: (frame: PassFrame) => void;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

/** Starts the reader; its gray frames go to `onFrame` numbered from `from`, the whole file's grid. */
export function startReader(
  ctx: MediaContext,
  use: ReaderUse,
  spec: ReaderSpec,
  run: ReaderRun,
): RunningReader {
  const { width, height } = use.analysis;
  let frames = 0;
  const onFrame = run.onFrame;
  const onStdout = onFrame
    ? splitRaw(width * height, (data) => {
        onFrame({ index: run.from + frames, width, height, data });
        frames += 1;
      })
    : undefined;
  const log = lineFilter(DETECT_LINES);
  const reader = new AbortController();
  const stop = () => reader.abort();
  run.signal?.addEventListener('abort', stop, { once: true });
  const done = runFfmpegRaw(ctx, readerArgs(use, spec), {
    // Raw frames from the helper's FIFO, filtered on the CPU: the helper holds the decoder session, not this run.
    holdsVideoSession: false,
    ...(onStdout ? { onStdout } : {}),
    onStderr: (chunk: Buffer) => log.push(chunk),
    timeoutMs: run.timeoutMs,
    signal: reader.signal,
  }).finally(() => run.signal?.removeEventListener('abort', stop));
  return { done, delivered: () => frames, detections: () => log.text(), stop };
}
