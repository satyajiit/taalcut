// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the mac helper's subject detection on the labelled frames, through the production path: each frame
 * becomes a one-second still clip, and render's `track.shot` client asks the helper for one detect sample of it
 * (detectHz 1, no tracker, short side 480 as render asks). Writes two prediction files: `helper` (the track's
 * heads) and `faces` (its face rectangles taken as heads: the baseline before FRM1).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, RationalTime } from '@taalcut/core';
import { createJsonLineSidecar, type JsonValue } from '@taalcut/media';
import { createSubjectTracker, type HelperRequester } from '@taalcut/render';
import { ffmpegBin, type BuiltFrame } from './build';
import type { FractionBox, FramePrediction } from './score';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const HELPER_BINARY = join(REPO, 'native/mac-helper/dist/taalcut-mac-helper');

export function readFrames(set: string): BuiltFrame[] {
  return (JSON.parse(readFileSync(join(set, 'frames.json'), 'utf8')) as { frames: BuiltFrame[] }).frames;
}

/** A one-second Motion JPEG clip of the still (even size), made once. */
function stillClip(set: string, frame: BuiltFrame): string {
  const dir = join(set, 'stills');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${frame.id}.mov`);
  if (existsSync(out)) return out;
  const args = ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', join(set, frame.file), '-t', '1', '-r', '30'];
  // Motion JPEG keeps the still's pixels and needs no hardware encoder session.
  args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj420p', '-y', out);
  const run = spawnSync(ffmpegBin().ffmpeg, args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`${frame.id}: ${run.stderr}`);
  return out;
}

export interface HelperPredictions {
  readonly helper: Record<
    string,
    FramePrediction & { readonly people: readonly FractionBox[]; readonly faceYaw: readonly number[] }
  >;
  readonly faces: Record<string, FramePrediction>;
  readonly ms: number;
}

export async function predictWithHelper(set: string, binary = HELPER_BINARY): Promise<HelperPredictions> {
  const frames = readFrames(set);
  const clips = frames.map((frame) => stillClip(set, frame));
  const sidecar = createJsonLineSidecar({
    command: binary,
    args: ['serve', '--services', 'track', '--allow-root', join(set, 'stills'), '--idle-exit', '60'],
    holdsVideoSession: true,
  });
  const ready = await sidecar.ready();
  if (!ready.ok) throw new Error(`helper did not start: ${JSON.stringify(ready.error)}`);
  const requester: HelperRequester = {
    request: (method, params, options) => sidecar.request(method, params as JsonValue, options),
  };
  const tracker = createSubjectTracker(requester);
  const helper: HelperPredictions['helper'] = {};
  const faces: HelperPredictions['faces'] = {};
  const rate = { num: 30, den: 1 };
  const started = Date.now();
  try {
    for (const [index, frame] of frames.entries()) {
      const tracked = await tracker.track({
        assetId: newId<'Asset'>(),
        contentHash: 'a'.repeat(64),
        path: clips[index]!,
        range: { start: RationalTime.of(0, rate), duration: RationalTime.of(30, rate) },
      });
      if (!tracked.ok) throw new Error(`${frame.id}: ${JSON.stringify(tracked.error)}`);
      const sample = tracked.value.track.samples.find((entry) => entry.source === 'detect');
      const faceBoxes = (sample?.faces ?? []).map((face) => face.box);
      helper[frame.id] = {
        heads: (sample?.heads ?? []).map((head) => head.box),
        faces: faceBoxes,
        people: (sample?.people ?? []).map((person) => person.box),
        faceYaw: (sample?.faces ?? []).map((face) => face.yaw),
      };
      faces[frame.id] = { heads: faceBoxes, faces: faceBoxes };
    }
  } finally {
    await sidecar.close();
  }
  const ms = Date.now() - started;
  writeFileSync(join(set, 'predictions.helper.json'), JSON.stringify(helper, null, 1));
  writeFileSync(join(set, 'predictions.faces.json'), JSON.stringify(faces, null, 1));
  return { helper, faces, ms };
}
