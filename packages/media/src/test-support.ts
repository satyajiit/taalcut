// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic reels for vision and audio tests, a stand-in parent process for
 * process-lifetime tests, and the test runs' FFmpeg check (test-support-ffmpeg.ts).
 * Not part of the public API: tests import this file, and dependency-cruiser
 * keeps it out of the app.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { aacEncoder } from './audio-codec';
import { detectEncoders } from './encoders';
import { NoEncoder } from './errors';
import { runFfmpeg, type MediaContext } from './ffmpeg';
import { even } from './normalise/size';
import { ffmpegEncoderName, softwareEncoderFor, SOFTWARE_VIDEOTOOLBOX_H264 } from './software-encoders';

export {
  provideTestFfmpeg,
  TEST_FFMPEG_CHECK_MS,
  testFfmpegFor,
  type TestFfmpeg,
} from './test-support-ffmpeg';

/** CPU-only fixture encode: tests that refuse hardware still need a real input file, with no colour defaults. */
export function softwareH264FixtureFlags(platform: NodeJS.Platform = process.platform): string[] {
  const encoder = softwareEncoderFor('h264', platform)!;
  return [
    '-c:v',
    ffmpegEncoderName(encoder),
    ...(encoder === SOFTWARE_VIDEOTOOLBOX_H264 ? ['-require_sw', '1'] : []),
  ];
}

export interface SyntheticOverlay {
  readonly png: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly frames?: number;
}

export interface SyntheticClick {
  readonly frame: number;
  readonly frequency?: number;
}

export interface SyntheticReelSpec {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly cuts?: readonly number[];
  readonly overlays?: readonly SyntheticOverlay[];
  readonly clicks?: readonly SyntheticClick[];
  readonly silence?: boolean;
}

const COLOURS = ['red', 'lime', 'blue', 'yellow', 'magenta', 'cyan'] as const;

function cutsOf(frames: number, cuts: readonly number[] | undefined): number[] {
  const points = [...new Set((cuts ?? []).map((cut) => Math.floor(cut)))]
    .filter((cut) => cut > 0 && cut < frames)
    .sort((a, b) => a - b);
  return [0, ...points, frames];
}

export async function buildSyntheticReel(
  spec: SyntheticReelSpec,
  ctx: MediaContext,
  options: { readonly out: string; readonly signal?: AbortSignal },
): AsyncResult<{ readonly frames: number }> {
  const fps = Math.max(1, Math.round(spec.fps));
  const frames = Math.max(1, Math.floor(spec.frames));
  const width = even(spec.width);
  const height = even(spec.height);
  const bounds = cutsOf(frames, spec.cuts);
  const found = await detectEncoders(ctx, options.signal ? { signal: options.signal } : {});
  if (!found.ok) return found;
  const encoder = ['libopenh264', 'h264_videotoolbox'].find((name) =>
    found.value.encoders.some((item) => item.name === name),
  );
  if (!encoder) return err(NoEncoder({ codec: 'h264' }, { detail: 'no H.264 encoder for a synthetic reel' }));
  const duration = (frames / fps).toFixed(6);
  const inputs: string[] = [];
  const filters: string[] = [];
  bounds.slice(0, -1).forEach((start, index) => {
    const end = bounds[index + 1] ?? frames;
    const seconds = ((end - start) / fps).toFixed(6);
    const colour = COLOURS[index % COLOURS.length];
    inputs.push('-f', 'lavfi', '-i', `color=c=${colour}:s=${width}x${height}:r=${fps}:d=${seconds}`);
  });
  const segments = bounds.length - 1;
  const concatIn = Array.from({ length: segments }, (_, index) => `[${index}:v]`).join('');
  filters.push(`${concatIn}concat=n=${segments}:v=1:a=0[v0]`);
  let video = 'v0';
  const overlays = spec.overlays ?? [];
  overlays.forEach((overlay, index) => {
    const input = segments + index;
    const hold = Math.max(1, overlay.frames ?? 1);
    inputs.push('-loop', '1', '-t', duration, '-i', overlay.png);
    const next = `v${index + 1}`;
    const from = Math.max(0, overlay.frame);
    const enable = `between(n\\,${from}\\,${from + hold - 1})`;
    filters.push(`[${video}][${input}:v]overlay=${overlay.x}:${overlay.y}:enable='${enable}'[${next}]`);
    video = next;
  });
  const wantAudio = spec.silence === true || (spec.clicks?.length ?? 0) > 0;
  let audioMap: string[] = [];
  if (wantAudio) {
    const base = segments + overlays.length;
    const clicks = spec.clicks ?? [];
    clicks.forEach((click, index) => {
      const frequency = click.frequency ?? 1000;
      const delay = Math.max(0, Math.round((click.frame / fps) * 1000));
      inputs.push(
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${frequency}:sample_rate=48000:duration=0.04,adelay=${delay}:all=1,apad=whole_dur=${duration}`,
      );
      filters.push(`[${base + index}:a]aformat=channel_layouts=mono[c${index}]`);
    });
    if (spec.silence || clicks.length === 0) {
      inputs.push('-f', 'lavfi', '-i', `aevalsrc=0:s=48000:d=${duration}`);
      filters.push(`[${base + clicks.length}:a]aformat=channel_layouts=mono[bed]`);
    }
    const mix = [...clicks.map((_, index) => `[c${index}]`), ...(spec.silence || clicks.length === 0 ? ['[bed]'] : [])];
    filters.push(mix.length === 1 ? `${mix[0]}anull[a]` : `${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0[a]`);
    audioMap = ['-map', '[a]'];
  }
  const audioFlags: string[] = [];
  if (wantAudio) {
    const audio = await aacEncoder(ctx, options.signal);
    if (!audio.ok) return audio;
    audioFlags.push('-c:a', audio.value, '-b:a', '128k');
  }
  const encoded = await runFfmpeg(
    ctx,
    [
      '-y',
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      `[${video}]`,
      ...audioMap,
      '-c:v',
      encoder,
      '-b:v',
      '1000000',
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(fps),
      ...(encoder === 'libopenh264' ? [] : ['-bf', '0']),
      '-r',
      String(fps),
      '-fps_mode',
      'cfr',
      '-frames:v',
      String(frames),
      ...audioFlags,
      '-movflags',
      '+faststart',
      options.out,
    ],
    { timeoutMs: 180_000, ...(options.signal ? { signal: options.signal } : {}) },
  );
  if (!encoded.ok) return encoded;
  return ok({ frames });
}

/**
 * A stand-in parent for process-lifetime tests (IX-F7): `script` run by node through tsx, and the first line it
 * prints, parsed as JSON. `child` is there at once, so a test can clean it up even if that line never comes. `first`
 * rejects if the script closes before printing ('close' comes after the last output, so a script that prints and
 * exits is still read).
 */
export function standInParent<T>(
  script: string,
  cwd: string,
  args: readonly string[] = [],
): { child: ChildProcess; first: Promise<T> } {
  const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const line = new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout }).once('line', resolve);
    child.once('close', (code) =>
      reject(new Error(`${basename(script)} closed with ${code} before printing`)),
    );
  });
  return { child, first: line.then((text) => JSON.parse(text) as T) };
}
