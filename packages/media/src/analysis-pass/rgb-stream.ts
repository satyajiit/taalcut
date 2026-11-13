// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The analysis pass's small RGB stream (IX2-C3): the shot-boundary model's input, every `every`-th grid frame
 * squeezed to exactly `width` × `height` (TransNetV2 reads 48×27, aspect ignored). It is a tap on the analysis
 * branch: the frames that branch already scaled and downloaded, picked and scaled on the CPU to the stream's size
 * with swscale's bicubic (what the model's own extraction, `ffmpeg -s 48x27`, uses) and converted to RGB24, an
 * odd height included. (A branch of its own scaled every 4K frame on the device a second time: the passes of
 * ix-v1's 4K HEVC clips took 5–6 s longer each.) FFmpeg writes the frames to a scratch file that frame-tail.ts
 * hands over while it grows.
 */
import type { GraphTap } from '../frame-sets/branch-graph';
import { ok } from '@taalcut/core';
import { tailFrames, type FrameBatch, type FrameTail } from './frame-tail';

/** Every `every`-th grid frame as exactly `width` × `height` RGB24, handed over in batches while the pass decodes. */
export interface RgbStream {
  readonly width: number;
  readonly height: number;
  readonly every: number;
  /** The next frames, in order; the stream reads on once this settles. */
  readonly onFrames: (batch: RgbBatch) => Promise<void>;
}

export interface RgbBatch {
  /** Grid frame of the first frame (the whole file's). */
  readonly index: number;
  /** Grid frames between two frames of the stream. */
  readonly every: number;
  readonly count: number;
  readonly width: number;
  readonly height: number;
  /** `count` frames of `width` × `height` × 3 bytes, back to back. */
  readonly data: Buffer;
}

/** Stream frames handed over at most at once, and how often the stream's file is looked at. */
const STREAM_BATCH = 50;
const STREAM_POLL_MS = 40;

function streamTap(stream: RgbStream): GraphTap {
  return {
    pick: { every: stream.every },
    filters: [`scale=${stream.width}:${stream.height}:flags=bicubic`, 'format=rgb24'],
  };
}

/** The stream's file read while FFmpeg writes it, each batch numbered on the whole file's grid. */
function streamTail(
  stream: RgbStream,
  path: string,
  from: number,
  signal: AbortSignal | undefined,
): FrameTail {
  const { width, height, every } = stream;
  return tailFrames(path, {
    bytesPerFrame: width * height * 3,
    batchFrames: STREAM_BATCH,
    pollMs: STREAM_POLL_MS,
    onFrames: (batch: FrameBatch) =>
      stream.onFrames({
        index: from + batch.first * every,
        every,
        count: batch.count,
        width,
        height,
        data: batch.data,
      }),
    ...(signal ? { signal } : {}),
  });
}

/** The stream's share of one pass: none, or its tap, its output, its scratch file and the reader of that file. */
export interface StreamPart {
  /** The taps to put on the analysis branch, every grid frame at the analysis size (empty without a stream). */
  readonly taps: readonly GraphTap[];
  /** FFmpeg's output arguments for that branch's label. */
  outputArgs(label: string | undefined): string[];
  /** Files to delete when the pass ends. */
  readonly scratch: readonly string[];
  /** Starts reading the file FFmpeg writes; the grid frame of the pass's first frame is `from`. */
  start(from: number, signal: AbortSignal | undefined): FrameTail;
}

const NO_STREAM: StreamPart = {
  taps: [],
  outputArgs: () => [],
  scratch: [],
  start: () => ({ stop: async () => undefined, finish: async () => ok(0) }),
};

export function streamPart(stream: RgbStream | undefined, path: string): StreamPart {
  if (!stream) return NO_STREAM;
  const every = { ...stream, every: Math.max(1, Math.round(stream.every)) };
  return {
    taps: [streamTap(every)],
    outputArgs: (label) =>
      label === undefined
        ? []
        : ['-map', label, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', path],
    scratch: [path],
    start: (from, signal) => streamTail(every, path, from, signal),
  };
}
