// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `framePixels` for the FFmpeg stand-in analysers (BRK1-GFX): the frames asked for, scaled to fit, as RGB24 from
 * one decode. Tests, evals and local runs read overlay designs with it; the app uses media's raw sampler.
 * MATCH1: `grayFrames`, every frame as a small gray picture, for finding gradual transitions (gradual.ts).
 */
import { err, ok, UnknownError } from '@taalcut/core';
import type { BreakdownMedia } from '../breakdown/ports';
import { runProcess } from './run-process';

type FramePixels = NonNullable<BreakdownMedia['framePixels']>;
type GrayFrames = NonNullable<BreakdownMedia['grayFrames']>;

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

export function ffmpegFramePixels(bins: { readonly ffmpeg: string; readonly ffprobe: string }): FramePixels {
  return async (path, frames, { maxDimension, signal }) => {
    const probed = await runProcess(
      bins.ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
      signal,
    );
    if (!probed.ok) return probed;
    const [sourceWidth = 0, sourceHeight = 0] = probed.value.stdout.toString('utf8').trim().split(',').map(Number);
    if (!sourceWidth || !sourceHeight) return err(UnknownError(undefined, { detail: 'no video size' }));
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = even(sourceWidth * scale);
    const height = even(sourceHeight * scale);
    const sorted = [...new Set(frames)].sort((a, b) => a - b);
    if (sorted.length === 0) return ok([]);
    const select = sorted.map((frame) => `eq(n,${frame})`).join('+');
    const run = await runProcess(
      bins.ffmpeg,
      [
        ...['-v', 'error', '-i', path, '-vf', `select='${select}',scale=${width}:${height}`],
        ...['-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      ],
      signal,
    );
    if (!run.ok) return run;
    const size = width * height * 3;
    const count = Math.floor(run.value.stdout.length / size);
    if (count !== sorted.length)
      return err(UnknownError(undefined, { detail: `asked ${sorted.length} frames, got ${count}` }));
    const byFrame = new Map(
      sorted.map((frame, index) => [
        frame,
        { frame, width, height, rgb: new Uint8Array(run.value.stdout.subarray(index * size, (index + 1) * size)) },
      ]),
    );
    return ok(frames.flatMap((frame) => byFrame.get(frame) ?? []));
  };
}

async function videoSize(ffprobe: string, path: string, signal: AbortSignal) {
  const probed = await runProcess(
    ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
    signal,
  );
  if (!probed.ok) return probed;
  const [width = 0, height = 0] = probed.value.stdout.toString('utf8').trim().split(',').map(Number);
  return width && height ? ok({ width, height }) : err(UnknownError(undefined, { detail: 'no video size' }));
}

export function ffmpegGrayFrames(bins: { readonly ffmpeg: string; readonly ffprobe: string }): GrayFrames {
  return async (path, { longSide, signal }) => {
    const size = await videoSize(bins.ffprobe, path, signal);
    if (!size.ok) return size;
    const scale = Math.min(1, longSide / Math.max(size.value.width, size.value.height));
    const width = even(size.value.width * scale);
    const height = even(size.value.height * scale);
    const run = await runProcess(
      bins.ffmpeg,
      [
        ...['-v', 'error', '-i', path, '-vf', `scale=${width}:${height}:flags=area,format=gray`],
        ...['-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
      ],
      signal,
    );
    if (!run.ok) return run;
    const bytes = width * height;
    const count = Math.floor(run.value.stdout.length / bytes);
    const frames = Array.from(
      { length: count },
      (_, index) => new Uint8Array(run.value.stdout.subarray(index * bytes, (index + 1) * bytes)),
    );
    return ok({ width, height, frames });
  };
}
