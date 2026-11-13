// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FFmpeg for integration tests, found the way a development build finds it
 * (TAALCUT_FFMPEG_DIR, else tools/ffmpeg/dist checked against its
 * BUILDINFO.json; never PATH), and lavfi fixtures made at test time in a
 * temp folder. The check runs once per test run, before any file starts
 * (ffmpeg-setup.ts; media's test-support-ffmpeg.ts), and each suite reads its
 * answer: without FFmpeg the suites skip with a message, as media's do, and any
 * other failure of the check has already stopped the run.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EncoderSelection,
  runFfmpeg,
  runProcess,
  ToneMapSelection,
  VideoBackendSelection,
  type MediaContext,
  type ResolvedFfmpeg,
} from '@taalcut/media';
import { testFfmpegFor } from '@taalcut/media/test-support';
import { inject } from 'vitest';
import { FIXTURE_H264 } from './host-video';

export interface TestMedia {
  readonly binaries?: ResolvedFfmpeg;
  readonly skipReason: string;
}

export async function findTestMedia(suite: string): Promise<TestMedia> {
  const { binaries, skip } = testFfmpegFor(inject('testFfmpeg'), suite);
  return binaries ? { binaries, skipReason: '' } : { skipReason: skip };
}

/**
 * A context that remembers what a MediaService does (LNX1-RND): the machine's proven hw-video rows (each row's
 * device trial), the working encoder and the tone-map route, so a suite asks once and plans like the app.
 */
export function mediaContext(binaries: ResolvedFfmpeg): MediaContext {
  return {
    binaries,
    videoBackends: new VideoBackendSelection(),
    encoders: new EncoderSelection(),
    toneMaps: new ToneMapSelection(),
  };
}

export async function tempDir(prefix: string): Promise<{ dir: string; dispose(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), `taalcut-render-${prefix}-`));
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}

/** Runs ffmpeg with overwrite on; throws with the stderr tail when it fails (fixtures must exist). */
export async function ffmpeg(ctx: MediaContext, args: readonly string[]): Promise<void> {
  const result = await runFfmpeg(ctx, ['-y', ...args], { timeoutMs: 180_000 });
  if (!result.ok) throw new Error(`ffmpeg failed: ${result.error.code} ${result.error.detail ?? ''}`);
}

/** ffprobe's JSON for a file. */
export async function probeJson(
  ctx: MediaContext,
  path: string,
  entries: string,
): Promise<Record<string, unknown>> {
  const result = await runProcess(
    ctx.binaries.ffprobe,
    ['-v', 'error', '-count_packets', '-show_entries', entries, '-of', 'json', path],
    {
      timeoutMs: 60_000,
    },
  );
  if (!result.ok) throw new Error(`ffprobe failed: ${result.error.code}`);
  return JSON.parse(result.value.stdout.toString('utf8')) as Record<string, unknown>;
}

/** A solid-colour clip with a 1 kHz tone (or silence) at `rate`, H.264 (FIXTURE_H264). */
export async function colourClip(
  ctx: MediaContext,
  out: string,
  options: { colour: string; frames: number; rate: string; size?: string; tone?: number | null },
): Promise<void> {
  const size = options.size ?? '1080x1920';
  const audio =
    options.tone === null
      ? ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
      : ['-f', 'lavfi', '-i', `sine=f=${options.tone ?? 1000}:r=48000`];
  await ffmpeg(ctx, [
    '-f',
    'lavfi',
    '-i',
    `color=c=${options.colour}:s=${size}:r=${options.rate}`,
    ...audio,
    '-frames:v',
    String(options.frames),
    '-c:v',
    FIXTURE_H264,
    '-b:v',
    '8M',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    out,
  ]);
}

/**
 * A region of frame `frame` (0-based) of a video as rgb24, decoded in software for exactness; `scale` shrinks
 * it first by area (1×1 is the region's mean colour).
 */
export async function frameRegion(
  ctx: MediaContext,
  path: string,
  frame: number,
  region: { x: number; y: number; width: number; height: number },
  scale?: { width: number; height: number },
): Promise<Uint8Array> {
  const shrink = scale ? `,scale=${scale.width}:${scale.height}:flags=area` : '';
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `select=eq(n\\,${frame}),crop=${region.width}:${region.height}:${region.x}:${region.y}${shrink}`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { timeoutMs: 60_000, maxStdoutBytes: 64 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error(`frame read failed: ${result.error.code}`);
  return new Uint8Array(result.value.stdout);
}

/** Mean RGB of a small patch of frame `frame` (0-based) of a video. */
export async function patchColour(
  ctx: MediaContext,
  path: string,
  frame: number,
  patch: { x: number; y: number; size?: number } = { x: 10, y: 10 },
): Promise<[number, number, number]> {
  const size = patch.size ?? 4;
  const bytes = await frameRegion(
    ctx,
    path,
    frame,
    { x: patch.x, y: patch.y, width: size, height: size },
    { width: 1, height: 1 },
  );
  return [bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0];
}

/** Every frame's mean colour of a patch, in one decode. */
export async function patchColours(
  ctx: MediaContext,
  path: string,
  patch: { x: number; y: number; size?: number } = { x: 10, y: 10 },
): Promise<[number, number, number][]> {
  const size = patch.size ?? 4;
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `crop=${size}:${size}:${patch.x}:${patch.y},scale=1:1:flags=area`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { timeoutMs: 120_000, maxStdoutBytes: 64 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error(`frame read failed: ${result.error.code}`);
  const bytes = result.value.stdout;
  const colours: [number, number, number][] = [];
  for (let i = 0; i + 2 < bytes.length; i += 3) colours.push([bytes[i]!, bytes[i + 1]!, bytes[i + 2]!]);
  return colours;
}

/** The nearest of `palette` (name → RGB) to a measured colour. */
export function nearest(
  colour: readonly number[],
  palette: Readonly<Record<string, readonly number[]>>,
): string {
  let best = '';
  let bestDistance = Infinity;
  for (const [name, rgb] of Object.entries(palette)) {
    const distance = rgb.reduce((sum, value, index) => sum + (value - (colour[index] ?? 0)) ** 2, 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}
