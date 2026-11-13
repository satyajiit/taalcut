// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: side-by-sides of clips whose aspect isn't the canvas's, reframed onto 9:16 the way assembly now asks
 * (`reframe: { mode: 'auto' }`): each clip is tracked on the mac helper, its crop planned by render's
 * `planVisualFraming`, and one picture a second drawn: the source with the crop (yellow) and the heads (green), and
 * the 9:16 output beside it. Clips are cut from the subjects set's CC-BY sources (Tears of Steel), so nothing of
 * anyone's own footage is used. `tsx src/subjects/reframe-proof.ts --set <set> --out <dir>`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, RationalTime, type ClipReframe, type FrameRate, type SubjectTrack } from '@taalcut/core';
import { createJsonLineSidecar, type JsonValue } from '@taalcut/media';
import { createSubjectTracker, cropAt, planVisualFraming } from '@taalcut/render';
import { ffmpegBin } from './build';
import { HELPER_BINARY } from './helper';

interface ProofClip {
  readonly id: string;
  readonly label: string;
  /** Seconds into the source. */
  readonly at: number;
  readonly seconds: number;
  /** A crop of the source (pixels), to make a clip of another aspect; none keeps the whole picture. */
  readonly crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/** Tears of Steel is 1280x534 (2.4:1) at 24 fps. */
const CLIPS: readonly ProofClip[] = [
  { id: 'scope-two-shot', label: '2.4:1 two people', at: 312, seconds: 6 },
  {
    id: 'landscape-169',
    label: '16:9 three people',
    at: 228,
    seconds: 6,
    crop: { x: 160, y: 0, width: 950, height: 534 },
  },
  {
    id: 'portrait-34',
    label: '3:4 one person walking',
    at: 286,
    seconds: 6,
    crop: { x: 400, y: 0, width: 400, height: 534 },
  },
];
const RATE: FrameRate = { num: 24, den: 1 };
const CANVAS = { width: 1080, height: 1920 };
const AUTO: ClipReframe = { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 };

const ffmpeg = (args: readonly string[]) => {
  const run = spawnSync(ffmpegBin().ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(run.stderr);
};

/** The clip as Motion JPEG (AVFoundation reads it; no hardware encoder session). */
function cutClip(set: string, out: string, clip: ProofClip): string {
  const path = join(out, `${clip.id}.mov`);
  const crop = clip.crop ? `crop=${clip.crop.width}:${clip.crop.height}:${clip.crop.x}:${clip.crop.y},` : '';
  ffmpeg([
    '-ss',
    String(clip.at),
    '-t',
    String(clip.seconds),
    '-i',
    join(set, 'sources/tos.mov'),
    '-an',
    '-vf',
    `${crop}scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    '-c:v',
    'mjpeg',
    '-q:v',
    '3',
    '-pix_fmt',
    'yuvj420p',
    '-y',
    path,
  ]);
  return path;
}

const px = (value: number) => Math.max(0, Math.round(value));
const box = (
  b: { x: number; y: number; width: number; height: number },
  w: number,
  h: number,
  colour: string,
  t: number,
) =>
  `drawbox=x=${px(b.x * w)}:y=${px(b.y * h)}:w=${px(b.width * w)}:h=${px(b.height * h)}:color=${colour}:t=${t}`;

/** The track sample nearest a time. */
function sampleNear(track: SubjectTrack, seconds: number) {
  let best = track.samples[0];
  for (const sample of track.samples)
    if (
      sample.heads &&
      Math.abs(RationalTime.toSeconds(sample.t) - seconds) <
        Math.abs(RationalTime.toSeconds(best!.t) - seconds)
    )
      best = sample;
  return best;
}

async function main(): Promise<void> {
  const arg = (name: string) => process.argv[process.argv.indexOf(`--${name}`) + 1]!;
  const set = arg('set');
  const out = arg('out');
  mkdirSync(join(out, 'clips'), { recursive: true });
  const sidecar = createJsonLineSidecar({
    command: HELPER_BINARY,
    args: ['serve', '--services', 'track', '--allow-root', join(out, 'clips'), '--idle-exit', '60'],
    holdsVideoSession: true,
  });
  const tracker = createSubjectTracker({
    request: (method, params, options) => sidecar.request(method, params as JsonValue, options),
  });
  const summary: Record<string, unknown>[] = [];
  try {
    for (const clip of CLIPS) {
      const path = cutClip(set, join(out, 'clips'), clip);
      const width = clip.crop?.width ?? 1280;
      const height = clip.crop?.height ?? 534;
      const frames = clip.seconds * 24;
      const started = Date.now();
      const tracked = await tracker.track({
        assetId: newId<'Asset'>(),
        contentHash: 'c'.repeat(64),
        path,
        range: { start: RationalTime.of(0, RATE), duration: RationalTime.of(frames, RATE) },
      });
      if (!tracked.ok) throw new Error(`${clip.id}: ${JSON.stringify(tracked.error)}`);
      const ms = Date.now() - started;
      const framing = planVisualFraming({
        visual: {
          kind: 'video',
          reframe: AUTO,
          visible: { start: 0, end: frames },
          cut: { start: 0, end: frames },
          sourceIn: RationalTime.zero(RATE),
          speed: null,
        },
        source: { width, height },
        canvas: CANVAS,
        safe: { x: 120, y: 288, width: 840, height: 1344 },
        captionBandTop: null,
        track: tracked.value.track,
        rate: RATE,
        canvasChanged: false,
      });
      if (framing.kind !== 'crop') throw new Error(`${clip.id}: ${framing.kind}`);
      const shots: string[] = [];
      for (let second = 0; second < clip.seconds; second += 1) {
        const frame = second * 24 + 12;
        const crop = cropAt(framing.keys, frame);
        const sample = sampleNear(tracked.value.track, frame / 24);
        const heads = (sample?.heads ?? []).map((head) => box(head.box, width, height, 'lime', 3));
        const people = (sample?.people ?? []).map((person) =>
          box(person.box, width, height, 'deepskyblue', 1),
        );
        const shot = join(out, `${clip.id}-${second}.png`);
        const window = `crop=${px(crop.width * width)}:${px(crop.height * height)}:${px(crop.x * width)}:${px(crop.y * height)}`;
        const left = [...people, ...heads, box(crop, width, height, 'yellow', 4), 'scale=-2:640'].join(',');
        ffmpeg([
          '-ss',
          String(frame / 24),
          '-i',
          path,
          '-frames:v',
          '1',
          '-filter_complex',
          `[0:v]split[a][b];[a]${left}[l];[b]${[...heads, window, 'scale=360:640'].join(',')}[r];[l][r]hstack=inputs=2`,
          '-y',
          shot,
        ]);
        shots.push(shot);
      }
      ffmpeg([
        ...shots.flatMap((shot) => ['-i', shot]),
        '-filter_complex',
        `${shots.map((_, index) => `[${index}:v]`).join('')}vstack=inputs=${shots.length}`,
        '-y',
        join(out, `${clip.id}.jpg`),
      ]);
      const detect = tracked.value.track.samples.filter((sample) => sample.source === 'detect');
      summary.push({
        clip: clip.id,
        label: clip.label,
        aspect: +(width / height).toFixed(3),
        reason: framing.reason,
        trackMs: ms,
        seconds: clip.seconds,
        detectSamples: detect.length,
        withHeads: detect.filter((sample) => (sample.heads ?? []).length > 0).length,
      });
      console.log(JSON.stringify(summary.at(-1)));
    }
  } finally {
    await sidecar.close();
  }
  writeFileSync(join(out, 'reframe-proof.json'), JSON.stringify(summary, null, 1));
}

main().catch((cause: unknown) => {
  console.error(cause);
  process.exitCode = 1;
});
