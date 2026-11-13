// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFrames, syntheticRenderSystem } from '../../src/adapters/synthetic-render';
import { bundledFfmpeg } from '../../src/ffmpeg-bin';
import { cutsMatch } from '../../src/render/check';
import { parseRenderGolden, type RenderGolden } from '../../src/render/schema';
import { readStrip } from '../../src/render/strip';

const bins = bundledFfmpeg();

function probe(): RenderGolden {
  return parseRenderGolden({
    id: 'shift-probe',
    synthetic: true,
    note: 'Synthetic plan. Media is generated at test time.',
    frameRate: { numerator: 30, denominator: 1 },
    width: 80,
    height: 24,
    cellSize: 2,
    clips: [
      { clipId: 1, color: '#ff0000', inFrame: 0, frames: 6 },
      { clipId: 2, color: '#00ff00', inFrame: 100, frames: 6 },
    ],
    beats: [0, 6],
    overlays: [],
    captions: [],
  });
}

describe('one-frame cut shift', () => {
  it.skipIf(bins === undefined)(
    'fails cut timing when one cut moves by one frame',
    async () => {
      if (bins === undefined) return;
      const golden = probe();
      const dir = mkdtempSync(join(tmpdir(), 'taalcut-render-'));
      try {
        const system = syntheticRenderSystem();
        const cleanPath = join(dir, 'clean.mkv');
        const shiftedPath = join(dir, 'shifted.mkv');
        await system.render({ goldenId: golden.id, timeline: golden, outPath: cleanPath });
        const clean = await decodeFrames(bins.ffmpeg, cleanPath, golden.width, golden.height);
        const cleanRead = clean.map((frame) => readStrip(frame, golden.width, golden.height, golden.cellSize));
        expect(clean).toHaveLength(12);
        expect(cutsMatch(golden, cleanRead).pass).toBe(true);

        await system.render({
          goldenId: golden.id,
          timeline: golden,
          outPath: shiftedPath,
          cutShiftFrames: { clipIndex: 0, frames: 1 },
        });
        const shifted = await decodeFrames(bins.ffmpeg, shiftedPath, golden.width, golden.height);
        const shiftedRead = shifted.map((frame) => readStrip(frame, golden.width, golden.height, golden.cellSize));
        const failed = cutsMatch(golden, shiftedRead);
        expect(failed.pass).toBe(false);
        expect(failed.firstMismatch).toEqual({
          outputFrame: 6,
          expected: { frame: 100, clipId: 2 },
          actual: { frame: 6, clipId: 1 },
        });
        const landed = shiftedRead[7];
        expect(landed).toEqual({ frame: 100, clipId: 2 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
