// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Contact sheets: a grid of frames as one JPEG. The frames come from media's
 * `sampleFrames` (frames.ts); the grid is laid out here rather than with
 * media's `contactSheet` (select and tile), because a contact strip shows a
 * frame in two rows when candidates are close, a still among video frames
 * has another size, and the sheet must fit a byte cap: FFmpeg encodes the
 * JPEG from a short-lived raw file, stepping quality down until it fits.
 */
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult, type TileAnnotation } from '@taalcut/core';
import {
  annotateRgbTile,
  FfmpegFailed,
  mediaEnv,
  OutputTooLarge,
  runProcess,
  type MediaContext,
} from '@taalcut/media';
import type { SampledFrame } from './frames';

export interface RgbImage {
  readonly width: number;
  readonly height: number;
  /** rgb24, row-major. */
  readonly rgb: Uint8Array;
}

/**
 * Lays tiles out row by row, `columns` wide; a null tile (a frame past the
 * end) stays black. Each tile is drawn centred in its cell, so frames of
 * another size (a still among video frames) still fit. Optional Set-of-Mark
 * `annotations` burn badges, borders and boxes onto each tile before blitting.
 */
export function composeGrid(
  tiles: readonly (SampledFrame | null)[],
  columns: number,
  cell: { readonly width: number; readonly height: number },
  annotations?: readonly (TileAnnotation | null | undefined)[],
  compute: Pick<MediaContext, 'onComputeFallback'> = {},
): RgbImage {
  const cols = Math.max(1, Math.min(columns, tiles.length || 1));
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const width = cols * cell.width;
  const height = rows * cell.height;
  const rgb = new Uint8Array(width * height * 3);
  tiles.forEach((tile, i) => {
    if (!tile || tile.data.length < tile.width * tile.height * 3) return;
    const annotation = annotations?.[i];
    let sourceData = tile.data;
    if (annotation) {
      const copy = new Uint8Array(tile.data.subarray(0, tile.width * tile.height * 3));
      annotateRgbTile(copy, tile.width, tile.height, annotation, compute.onComputeFallback);
      sourceData = copy;
    }
    const left = (i % cols) * cell.width + Math.max(0, Math.floor((cell.width - tile.width) / 2));
    const top = Math.floor(i / cols) * cell.height + Math.max(0, Math.floor((cell.height - tile.height) / 2));
    const w = Math.min(tile.width, cell.width);
    const h = Math.min(tile.height, cell.height);
    for (let y = 0; y < h; y++) {
      const from = y * tile.width * 3;
      rgb.set(sourceData.subarray(from, from + w * 3), ((top + y) * width + left) * 3);
    }
  });
  return { width, height, rgb };
}

export interface EncodeJpegOptions {
  /** A folder for the short-lived raw file. */
  readonly tempDir: string;
  /** The largest JPEG accepted; quality steps down to fit. */
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

/** FFmpeg's mjpeg quality scale (2 best, 31 worst): the steps tried in order. */
const QUALITY_STEPS = [4, 6, 9, 13, 18, 25, 31] as const;

export async function encodeJpeg(
  ctx: MediaContext,
  image: RgbImage,
  options: EncodeJpegOptions,
): AsyncResult<{ readonly jpeg: Buffer; readonly quality: number }> {
  if (options.signal?.aborted) return err(CancelledError());
  const raw = join(options.tempDir, `sheet-${randomUUID()}.rgb`);
  await writeFile(raw, image.rgb);
  try {
    const run = ctx.runner ?? runProcess;
    let smallest: number | undefined;
    for (const quality of QUALITY_STEPS) {
      const result = await run(
        ctx.binaries.ffmpeg,
        [
          ...['-hide_banner', '-nostdin', '-loglevel', 'error'],
          ...['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${image.width}x${image.height}`],
          ...['-i', `file:${raw}`, '-frames:v', '1', '-q:v', String(quality)],
          ...['-pix_fmt', 'yuvj420p', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'],
        ],
        { env: mediaEnv(ctx), timeoutMs: 60_000, ...(options.signal ? { signal: options.signal } : {}) },
      );
      if (!result.ok) return result;
      if (result.value.exitCode !== 0) {
        const exitCode = result.value.exitCode ?? -1;
        return err(FfmpegFailed({ exitCode }, { detail: result.value.stderrTail.trimEnd().slice(-2000) }));
      }
      const jpeg = result.value.stdout;
      if (jpeg.length <= options.maxBytes) return ok({ jpeg, quality });
      smallest = jpeg.length;
    }
    return err(
      OutputTooLarge(
        { limitBytes: options.maxBytes },
        { detail: `sheet is ${String(smallest)} bytes at the lowest quality` },
      ),
    );
  } finally {
    await rm(raw, { force: true });
  }
}
