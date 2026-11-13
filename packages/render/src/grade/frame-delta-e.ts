// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ΔE00 between two video frames as files (SPEC P3.7): each frame decoded by FFmpeg (on the machine's hardware
 * decoder, media's hw-video rows: VideoToolbox, NVDEC; FFmpeg decodes in software when the row can't take the file) to full-range BT.709 R′G′B′ (zscale, exact) at a small size with an area filter, so the score is per pixel over
 * a downsampled grid (research: never the ΔE of a frame's average colour). Render's grade tests and the
 * `grade` eval share it.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { hwVideoBackend, machineVideoBackends, runFfmpeg, type MediaContext } from '@taalcut/media';
import { GradeFailed } from '../errors-phase3';
import { bt709ToRgbFilter } from './colour-filters';
import { frameDeltaE, type DeltaEStats } from './delta-e';

export interface DecodeFrameOptions {
  /** The grid the frame is scaled to (area filter). */
  readonly width: number;
  readonly height: number;
  /** Frame index in the file. Default 0. */
  readonly frame?: number;
  /** The file's YUV is full range (default limited, as every conformed segment is). */
  readonly fullRange?: boolean;
  readonly signal?: AbortSignal;
}

/**
 * One frame as rgb24 bytes (width × height × 3), full-range BT.709 R′G′B′: converted exactly by zscale at 16
 * bit, area-scaled in RGB, and rounded here (FFmpeg's 16 → 8 bit step may dither).
 */
export async function decodeRgbFrame(
  ctx: MediaContext,
  path: string,
  options: DecodeFrameOptions,
): AsyncResult<Uint8Array> {
  const deep = await decodeRgb48Frame(ctx, path, options);
  if (!deep.ok) return deep;
  return ok(Uint8Array.from(deep.value, (value) => Math.round(value / 257)));
}

/** The same frame at 16 bits per channel (0–65535), for expected values computed at full precision. */
export async function decodeRgb48Frame(
  ctx: MediaContext,
  path: string,
  options: DecodeFrameOptions,
): AsyncResult<Uint16Array> {
  const filter = [
    `select=eq(n\\,${options.frame ?? 0})`,
    bt709ToRgbFilter(options.fullRange ? 'full' : 'limited'),
    `scale=${options.width}:${options.height}:flags=area`,
    'format=rgb48le',
  ].join(',');
  const bytes = options.width * options.height * 6;
  const machine = await machineVideoBackends(ctx, options.signal);
  if (!machine.ok) return machine;
  const row = machine.value.backends.find((id) => hwVideoBackend(id).decode !== undefined);
  const run = await runFfmpeg(
    ctx,
    [
      ...(row ? ['-hwaccel', hwVideoBackend(row).decode!.hwaccel] : []),
      '-i',
      path,
      '-vf',
      filter,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb48le',
      '-',
    ],
    {
      // A hardware decode: never killed on a stop (IX3-K2).
      holdsVideoSession: row !== undefined,
      timeoutMs: 120_000,
      maxStdoutBytes: bytes + 1024,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (!run.ok) return run;
  const out = run.value.stdout;
  if (out.length !== bytes)
    return err(GradeFailed(undefined, { detail: `Decoded ${out.length} bytes, wanted ${bytes}` }));
  // Copy into an aligned buffer: the captured Buffer may sit at an odd offset in its pool.
  const copy = new Uint8Array(out);
  return ok(new Uint16Array(copy.buffer, 0, bytes / 2));
}

/** Per-pixel ΔE00 between the same frame of two files on a width × height grid. */
export async function filesDeltaE(
  ctx: MediaContext,
  one: string,
  two: string,
  options: DecodeFrameOptions,
): AsyncResult<DeltaEStats> {
  const first = await decodeRgbFrame(ctx, one, options);
  if (!first.ok) return first;
  const second = await decodeRgbFrame(ctx, two, options);
  if (!second.ok) return second;
  return ok(frameDeltaE(first.value, second.value));
}
