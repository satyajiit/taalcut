// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertLosslessEncode, runFfmpeg } from '../ffmpeg-run';

export async function encodeFrames(
  ffmpeg: string,
  frames: readonly Buffer[],
  spec: {
    width: number;
    height: number;
    frameRate: { numerator: number; denominator: number };
    outPath: string;
  },
): Promise<void> {
  assertLosslessEncode(
    'evals.render.ffv1',
    'The gray-code timing strip needs a lossless codec. VideoToolbox H.264 would change cell luma.',
  );
  const frameBytes = spec.width * spec.height * 3;
  for (const frame of frames) {
    if (frame.length !== frameBytes) {
      throw new Error(`frame is ${frame.length} bytes, expected ${frameBytes}`);
    }
  }
  mkdirSync(dirname(spec.outPath), { recursive: true });
  await runFfmpeg(
    ffmpeg,
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
      `${spec.width}x${spec.height}`,
      '-r',
      `${spec.frameRate.numerator}/${spec.frameRate.denominator}`,
      '-i',
      'pipe:0',
      '-c:v',
      'ffv1',
      spec.outPath,
    ],
    Buffer.concat(frames),
  );
}

export async function decodeFrames(
  ffmpeg: string,
  videoPath: string,
  width: number,
  height: number,
): Promise<Buffer[]> {
  const raw = await runFfmpeg(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    videoPath,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
  const frameBytes = width * height * 3;
  if (frameBytes <= 0) throw new Error('frame size must be positive');
  if (raw.length % frameBytes !== 0) {
    throw new Error(`Decoded ${raw.length} bytes is not a whole number of ${width}x${height} frames`);
  }
  const frames: Buffer[] = [];
  for (let offset = 0; offset < raw.length; offset += frameBytes) {
    frames.push(raw.subarray(offset, offset + frameBytes));
  }
  return frames;
}
