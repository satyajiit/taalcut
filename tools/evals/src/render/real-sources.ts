// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Source clips for rendering a golden through the real engine: one portrait
 * 360×640 video per golden clip whose frame n carries the Gray-code strip of
 * (n, clipId) across the top band (40 cells of 9 px, 36 rows), on the clip's
 * colour, with a click at every golden beat that falls inside the clip. The
 * export scales it to 1080×1920 with fit cover (exactly 3×), so the strip
 * comes out as 27 px cells that survive H.264. Under the band a bar sweeps
 * across so no stretch reads as frozen to QA. The clicks last 50 ms: at 10 ms
 * the peak-to-loudness ratio is too high for −14 LUFS under the true-peak cap,
 * loudnorm falls back to dynamic mode and its start-up gain smears the click at
 * t = 0 into a second onset. Encoded with media's working H.264 encoder (ADR
 * 0002: VideoToolbox on a Mac, NVENC with an NVIDIA GPU, else OpenH264) at a
 * high bitrate; frames are streamed, never held all at once.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectWorkingEncoder, videoEncodeFlags, type MediaContext } from '@taalcut/media';
import { clickPcm, wavBytes } from './audio';
import { type RenderClip, type RenderGolden } from './schema';
import { toGray } from './strip';

export const SOURCE_WIDTH = 360;
export const SOURCE_HEIGHT = 640;
const CELL = SOURCE_WIDTH / 40;
const BAND_ROWS = 4 * CELL;
/** The moving bar: clear of the band (and its H.264 bleed), 4 cells wide, 3 px a frame. */
const BAR_TOP = BAND_ROWS + 2 * CELL;
const BAR_WIDTH = 4 * CELL;
const BAR_STEP = 3;
const CLICK_SECONDS = 0.05;
/** Media past the clip's last frame: the conform's tail frame and a margin. */
export const SOURCE_HANDLE_FRAMES = 30;
const SAMPLE_RATE = 48_000;

function hexRgb(color: string): [number, number, number] {
  const hex = color.slice(1);
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

function background(color: string): Buffer {
  const [r, g, b] = hexRgb(color);
  const frame = Buffer.alloc(SOURCE_WIDTH * SOURCE_HEIGHT * 3);
  for (let pixel = 0; pixel < SOURCE_WIDTH * SOURCE_HEIGHT; pixel++) {
    frame[pixel * 3] = r;
    frame[pixel * 3 + 1] = g;
    frame[pixel * 3 + 2] = b;
  }
  return frame;
}

/** Black on a light colour, white on a dark one. */
function barLuma(color: string): number {
  const [r, g, b] = hexRgb(color);
  return 0.299 * r + 0.587 * g + 0.114 * b > 128 ? 0 : 255;
}

/** The base frame with frame n's strip in its top band and the bar at its frame-n position. */
function paint(base: Buffer, frame: number, clipId: number, bar: number): Buffer {
  const out = Buffer.from(base);
  const left = ((frame * BAR_STEP) % (SOURCE_WIDTH + BAR_WIDTH)) - BAR_WIDTH;
  const from = Math.max(0, left);
  const to = Math.min(SOURCE_WIDTH, left + BAR_WIDTH);
  if (to > from)
    for (let y = BAR_TOP; y < SOURCE_HEIGHT; y++)
      out.fill(bar, (y * SOURCE_WIDTH + from) * 3, (y * SOURCE_WIDTH + to) * 3);
  const frameGray = toGray(frame);
  const clipGray = toGray(clipId) & 0xff;
  for (let cell = 0; cell < 40; cell++) {
    const bit = cell < 32 ? (frameGray >>> cell) & 1 : (clipGray >>> (cell - 32)) & 1;
    const luma = bit === 1 ? 255 : 0;
    for (let y = 0; y < BAND_ROWS; y++)
      out.fill(luma, (y * SOURCE_WIDTH + cell * CELL) * 3, (y * SOURCE_WIDTH + (cell + 1) * CELL) * 3);
  }
  return out;
}

/** Source frames whose clicks sound at the golden's beats inside this clip (output frame → source frame). */
function clipBeats(golden: RenderGolden, clipIndex: number): number[] {
  let start = 0;
  for (const clip of golden.clips.slice(0, clipIndex)) start += clip.frames;
  const clip = golden.clips[clipIndex]!;
  return golden.beats
    .filter((beat) => beat >= start && beat < start + clip.frames)
    .map((beat) => clip.inFrame + (beat - start));
}

function encode(ctx: MediaContext, args: string[], frames: Iterable<Buffer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ctx.binaries.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `ffmpeg exited ${code ?? 'null'}: ${Buffer.concat(stderr).toString('utf8').slice(-600)}`,
            ),
          ),
    );
    child.stdin.on('error', () => undefined);
    const iterator = frames[Symbol.iterator]();
    const pump = () => {
      for (;;) {
        const next = iterator.next();
        if (next.done) {
          child.stdin.end();
          return;
        }
        if (!child.stdin.write(next.value)) {
          child.stdin.once('drain', pump);
          return;
        }
      }
    };
    pump();
  });
}

/** Writes `<dir>/clip-<index>.mp4` for one golden clip; returns its path and length in frames. */
export async function writeSourceClip(
  ctx: MediaContext,
  dir: string,
  golden: RenderGolden,
  clipIndex: number,
): Promise<{ path: string; frames: number }> {
  mkdirSync(dir, { recursive: true });
  const clip: RenderClip = golden.clips[clipIndex]!;
  const frames = clip.inFrame + clip.frames + SOURCE_HANDLE_FRAMES;
  const fps = golden.frameRate.numerator / golden.frameRate.denominator;
  const wav = join(dir, `clip-${clipIndex}.wav`);
  writeFileSync(
    wav,
    wavBytes(
      clickPcm({
        sampleRate: SAMPLE_RATE,
        durationFrames: frames,
        fps,
        beats: clipBeats(golden, clipIndex),
        clickSeconds: CLICK_SECONDS,
      }),
      SAMPLE_RATE,
    ),
  );
  const path = join(dir, `clip-${clipIndex}.mp4`);
  const base = background(clip.color);
  const bar = barLuma(clip.color);
  function* painted() {
    for (let frame = 0; frame < frames; frame++) yield paint(base, frame, clip.clipId, bar);
  }
  const rate = `${golden.frameRate.numerator}/${golden.frameRate.denominator}`;
  const encoder = await selectWorkingEncoder(ctx, 'h264');
  if (!encoder.ok) throw new Error(`no H.264 encoder: ${encoder.error.code}`);
  await encode(
    ctx,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${SOURCE_WIDTH}x${SOURCE_HEIGHT}`,
      '-r',
      rate,
      '-i',
      'pipe:0',
      '-i',
      wav,
      '-map',
      '0:v',
      '-map',
      '1:a',
      ...videoEncodeFlags(
        encoder.value.encoder,
        16_000_000,
        Math.round(golden.frameRate.numerator / golden.frameRate.denominator),
      ),
      '-c:a',
      'aac',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '2',
      path,
    ],
    painted(),
  );
  return { path, frames };
}
