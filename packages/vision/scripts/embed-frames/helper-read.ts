// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-G4 on real footage (`--options helper --helper <binary>`): `vision.embed`'s read as the product makes it
 * with the decode service on (a frame source whose frame sets go to the mac helper's `decode.frames`, one CPU
 * FFmpeg converting), against today's FFmpeg read of the same frames in the same round: time, which route served
 * (FFmpeg runs, and whether any decoded on the hardware), and the frames byte for byte. One helper process per
 * asset, ready before the first round (the app's helper outlives its requests), run under `/usr/bin/time -l` so
 * its peak memory over the asset is known; `memoryOfToday` does the same for each FFmpeg run of today's read.
 */
import { readFile, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as media from '@taalcut/media';
import type { FrameSize } from '../../src/media/frame-source';
import type { SampledFrame } from '../../src/media/frames';
import { currentRead } from './current';
import type { EmbedRequest } from './requests';

const TIME = '/usr/bin/time';

/** Bytes from `/usr/bin/time -l`'s report(s) in `file`: the largest peak footprint and resident set. */
export async function peakMemory(file: string): Promise<{ footprint: number; resident: number }> {
  const text = await readFile(file, 'utf8').catch(() => '');
  const largest = (label: string) =>
    Math.max(0, ...[...text.matchAll(new RegExp(`(\\d+)\\s+${label}`, 'g'))].map((m) => Number(m[1])));
  return { footprint: largest('peak memory footprint'), resident: largest('maximum resident set size') };
}

/** Frames byte-identical to `today`'s, of how many, and the largest byte difference otherwise. */
export function compareFrames(today: readonly SampledFrame[], other: readonly SampledFrame[]) {
  let identical = 0;
  let maxDiff = 0;
  today.forEach((frame, k) => {
    const theirs = other[k];
    if (!theirs || theirs.index !== frame.index || theirs.data.length !== frame.data.length) {
      maxDiff = 255;
      return;
    }
    if (Buffer.compare(Buffer.from(frame.data), Buffer.from(theirs.data)) === 0) {
      identical += 1;
      return;
    }
    for (let i = 0; i < frame.data.length; i++)
      maxDiff = Math.max(maxDiff, Math.abs((frame.data[i] ?? 0) - (theirs.data[i] ?? 0)));
  });
  return { identical, compared: today.length, maxDiff };
}

export interface HelperRound {
  readonly ms: number;
  readonly ffmpeg: number;
  readonly hwaccel: number;
  readonly identical: number;
  readonly compared: number;
  readonly maxDiff: number;
}

export interface HelperSession {
  /** One round: the product's read of the request's frames, compared with today's frames of that round. */
  read(today: readonly SampledFrame[]): Promise<HelperRound>;
  /** Ends the helper (end of stdin, never a signal) and returns its peak memory. */
  close(): Promise<{ footprint: number; resident: number }>;
}

export async function helperSession(
  ctx: media.MediaContext,
  helper: string,
  request: EmbedRequest,
  size: FrameSize,
  scratch: string,
): Promise<HelperSession> {
  const memory = join(scratch, 'helper.time');
  await rm(memory, { force: true });
  const roots = [scratch, await realpath(dirname(request.path))];
  const sidecar = media.createJsonLineSidecar({
    command: TIME,
    args: [
      '-l',
      '-o',
      memory,
      helper,
      'serve',
      '--services',
      'decode',
      ...roots.flatMap((r) => ['--allow-root', r]),
    ],
    idleExitMs: 120_000,
    holdsVideoSession: true,
  });
  const started = await sidecar.ready();
  if (!started.ok)
    throw new Error(`helper ${request.file}: ${started.error.code} ${started.error.detail ?? ''}`);
  const service = media.createMacHelperDecodeService(sidecar);
  return {
    async read(today) {
      const read = await currentRead(ctx, request, size, scratch, service);
      const ffmpeg = read.runs.filter((run) => run.command.startsWith('ffmpeg'));
      return {
        ms: read.ms,
        ffmpeg: ffmpeg.length,
        hwaccel: ffmpeg.filter((run) => run.args.includes('-hwaccel')).length,
        ...compareFrames(today, read.frames),
      };
    },
    async close() {
      await service.close();
      return peakMemory(memory);
    },
  };
}

/** Today's read once more, each FFmpeg run under `/usr/bin/time -l`: the largest run's peak memory. */
export async function memoryOfToday(
  ctx: media.MediaContext,
  request: EmbedRequest,
  size: FrameSize,
  scratch: string,
): Promise<{ footprint: number; resident: number }> {
  const file = join(scratch, 'ffmpeg.time');
  await rm(file, { force: true });
  const inner = ctx.runner ?? media.runProcess;
  const wrapped: media.MediaContext = {
    ...ctx,
    runner: (command, args, options) =>
      command === ctx.binaries.ffmpeg
        ? inner(TIME, ['-l', '-a', '-o', file, command, ...args], options)
        : inner(command, args, options),
  };
  await currentRead(wrapped, request, size, scratch);
  return peakMemory(file);
}
