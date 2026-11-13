// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-G2 option 2, measured before it is built: one VideoToolbox session per asset for all of `vision.embed`'s
 * frames (a prototype binary over the mac helper's decode code, `--session-proto <binary>`), writing NV12 at the
 * embedder's size, then one CPU FFmpeg turning those into rgb24 the way FFmpeg's own route converts its
 * downloaded frames. The rgb24 frames are compared byte for byte with today's read.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as media from '@taalcut/media';
import type { SampledFrame } from '../../src/media/frames';
import type { EmbedRequest } from './requests';
import { compareFrames } from './helper-read';
import { timed } from './timing';

export interface SessionProtoRun {
  /** The prototype's own wall time (open, session, every window), without its process start. */
  readonly decodeMs: number;
  readonly openMs: number;
  readonly sessionMs: number;
  readonly decoded: number;
  /** The CPU FFmpeg's NV12 → rgb24 run, process start included. */
  readonly convertMs: number;
  /** The whole thing from this process: spawning the prototype included. */
  readonly wallMs: number;
  /** Frames byte-identical to today's read, of how many; the largest byte difference otherwise. */
  readonly identical: number;
  readonly compared: number;
  readonly maxDiff: number;
}

const DIGITS = /^[0-9a-z]+$/;

/** The colour tags FFmpeg's route gives its downloaded frames, from the plan's probe. */
export function colourArgs(plan: media.NormalisationPlan): string[] {
  const { range, space, primaries, transfer } = plan.source.colour;
  const tag = (flag: string, value: string | undefined) =>
    value && value !== 'unknown' && DIGITS.test(value.replace(/[-_]/g, '')) ? [flag, value] : [];
  return [
    ...['-color_range', range === 'pc' ? 'pc' : 'tv'],
    ...tag('-colorspace', space),
    ...tag('-color_primaries', primaries),
    ...tag('-color_trc', transfer),
  ];
}

export async function sessionProto(
  ctx: media.MediaContext,
  binary: string,
  read: {
    readonly request: EmbedRequest;
    readonly size: { readonly width: number; readonly height: number };
    /** Today's frames of the same round. */
    readonly today: readonly SampledFrame[];
  },
  scratch: string,
): Promise<SessionProtoRun> {
  const { request, size, today } = read;
  const nv12 = join(scratch, 'proto.nv12');
  const rgb = join(scratch, 'proto.rgb');
  const rate = request.plan.frameRate.output;
  const frames = [...new Set(request.frames)].sort((a, b) => a - b);
  const run = await timed(async () => {
    const decoded = await media.runProcess(binary, [
      request.path,
      String(rate.num),
      String(rate.den),
      String(request.plan.rotation),
      String(size.width),
      String(size.height),
      nv12,
      String(media.WINDOW_GAP_SECONDS),
      frames.join(','),
    ]);
    if (!decoded.ok)
      throw new Error(`proto ${request.file}: ${decoded.error.code} ${decoded.error.detail ?? ''}`);
    const convert = await timed(() =>
      media.runProcess(ctx.binaries.ffmpeg, [
        ...['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'nv12'],
        ...['-video_size', `${size.width}x${size.height}`, '-framerate', '1', ...colourArgs(request.plan)],
        ...['-i', nv12, '-f', 'rawvideo', '-pix_fmt', 'rgb24', rgb],
      ]),
    );
    if (!convert.value.ok) throw new Error(`convert ${request.file}: ${convert.value.error.code}`);
    return {
      report: JSON.parse(decoded.value.stdout.toString('utf8')) as Record<string, number>,
      convertMs: convert.ms,
    };
  });
  const bytes = await readFile(rgb);
  const frameBytes = size.width * size.height * 3;
  await rm(nv12, { force: true });
  await rm(rgb, { force: true });
  const { report, convertMs } = run.value;
  return {
    decodeMs: report.totalMs ?? 0,
    openMs: report.openMs ?? 0,
    sessionMs: report.sessionMs ?? 0,
    decoded: report.decoded ?? 0,
    convertMs,
    wallMs: run.ms,
    // The prototype's frames in today's order, as frames to compare.
    ...compareFrames(
      today,
      today.map((frame, k) => ({ ...frame, data: bytes.subarray(k * frameBytes, (k + 1) * frameBytes) })),
    ),
  };
}
