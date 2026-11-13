// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type RenderOutput, type RenderRequest, type RenderSystem } from './types';
import { bundledFfmpeg } from '../ffmpeg-bin';
import { clickPcm, wavBytes } from '../render/audio';
import { decodeFrames, encodeFrames } from '../render/encode';
import { wavPathFor } from '../render/paths';
import { applyCutShift, durationFrames, parseRenderGolden, type RenderGolden } from '../render/schema';
import { paintFrame } from '../render/strip';

const SAMPLE_RATE = 48000;

function paintAll(golden: RenderGolden): Buffer[] {
  const frames: Buffer[] = [];
  for (const clip of golden.clips) {
    for (let offset = 0; offset < clip.frames; offset += 1) {
      frames.push(
        paintFrame({
          width: golden.width,
          height: golden.height,
          cellSize: golden.cellSize,
          frame: clip.inFrame + offset,
          clipId: clip.clipId,
          color: clip.color,
        }),
      );
    }
  }
  return frames;
}

export function syntheticRenderSystem(): RenderSystem {
  return {
    async render(request: RenderRequest): Promise<RenderOutput> {
      const bins = bundledFfmpeg();
      if (bins === undefined) throw new Error('ffmpeg is not available');
      const parsed = parseRenderGolden(request.timeline, request.goldenId);
      const golden =
        request.cutShiftFrames === undefined ? parsed : applyCutShift(parsed, request.cutShiftFrames);
      const frames = paintAll(golden);
      await encodeFrames(bins.ffmpeg, frames, {
        width: golden.width,
        height: golden.height,
        frameRate: golden.frameRate,
        outPath: request.outPath,
      });
      const pcm = clickPcm({
        sampleRate: SAMPLE_RATE,
        durationFrames: durationFrames(golden),
        fps: golden.frameRate.numerator / golden.frameRate.denominator,
        beats: golden.beats,
      });
      const wavPath = wavPathFor(request.outPath);
      mkdirSync(dirname(wavPath), { recursive: true });
      writeFileSync(wavPath, wavBytes(pcm, SAMPLE_RATE));
      return { videoPath: request.outPath };
    },
  };
}

export { decodeFrames };
