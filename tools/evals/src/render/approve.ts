// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from '../files';
import { bundledFfmpeg } from '../ffmpeg-bin';
import { decodeFrames } from './encode';
import { framesToHash } from './check';
import { dHash, type HashSample } from './hash';
import { type RenderGolden } from './schema';

function contactPpm(frames: readonly Buffer[], width: number, height: number): Buffer {
  const header = Buffer.from(`P6\n${width * frames.length} ${height}\n255\n`, 'ascii');
  return Buffer.concat([header, ...frames]);
}

/** Decode, write hashes.json for the sampled frames, and a contact.ppm strip. */
export async function approveGolden(videoPath: string, golden: RenderGolden, outDir: string): Promise<string> {
  const bins = bundledFfmpeg();
  if (bins === undefined) throw new Error('ffmpeg is not available');
  const raw = await decodeFrames(bins.ffmpeg, videoPath, golden.width, golden.height);
  const frames: HashSample[] = framesToHash(golden).map((outputFrame) => {
    const rgb = raw[outputFrame];
    if (rgb === undefined) throw new Error(`Frame ${outputFrame} is missing from ${videoPath}`);
    return { outputFrame, dHash: dHash(rgb, golden.width, golden.height, golden.cellSize) };
  });
  mkdirSync(outDir, { recursive: true });
  const hashPath = join(outDir, 'hashes.json');
  writeJson(hashPath, { synthetic: golden.synthetic, frames });
  const sheet = frames.map((sample) => {
    const rgb = raw[sample.outputFrame];
    if (rgb === undefined) throw new Error(`Frame ${sample.outputFrame} is missing from ${videoPath}`);
    return rgb;
  });
  writeFileSync(join(outDir, 'contact.ppm'), contactPpm(sheet, golden.width, golden.height));
  return hashPath;
}
