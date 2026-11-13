// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PP-OCR's recogniser runs (LNX1-ML): crops sorted by padded width, `recBatch` a run, readings back in detection
 * order. A frame of five lines of different lengths reads the same with every batch size, one crop a run included;
 * the scripted recogniser reads each crop from its own pixels, so padding can't change what it reads.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OnnxRuntime } from '../../src/onnx/ort';
import { createPaddleDevanagariOcr, recBatches } from '../../src/ocr/paddle/engine';
import { REC_HEIGHT } from '../../src/ocr/paddle/preprocess';
import type { OcrFrame } from '../../src/ocr/types';
import { fakeSession } from './helpers/fakes';

const LETTERS = ['क', 'ख', 'ग', 'घ', 'ङ'];
const CHARSET = Array.from({ length: 568 }, (_, i) => LETTERS[i] ?? `c${i}`);
const WIDTH = 960;
const HEIGHT = 540;
/** Five bands, top to bottom: their lengths give padded widths 1120, 320, 640, 320 and 1280. */
const BANDS = [700, 150, 400, 150, 820].map((length, k) => ({
  top: 40 + 95 * k,
  length,
  gray: 150 + 20 * k,
}));

function bandsFrame(): OcrFrame {
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (const band of BANDS)
    for (let y = band.top; y < band.top + 30; y++)
      rgb.fill(band.gray, (y * WIDTH + 60) * 3, (y * WIDTH + 60 + band.length) * 3);
  return { index: 0, width: WIDTH, height: HEIGHT, rgb };
}

/** The detector sees the bands; the recogniser reads each crop's brightest pixel as its band's letter. */
function bandsRuntime(runs: number[][]): OnnxRuntime {
  return {
    async openSession(path) {
      if (path.includes('det'))
        return ok(
          fakeSession('det_out', (feeds) => {
            const [, , h = 0, w = 0] = feeds['x']?.dims ?? [];
            const data = new Float32Array(h * w);
            const sy = h / HEIGHT;
            const sx = w / WIDTH;
            for (const band of BANDS)
              for (let y = Math.round(band.top * sy); y < Math.round((band.top + 30) * sy); y++)
                data.fill(0.9, y * w + Math.round(60 * sx), y * w + Math.round((60 + band.length) * sx));
            return { data, dims: [1, 1, h, w] };
          }),
        );
      return ok(
        fakeSession('rec_out', (feeds) => {
          const [n = 0, , , width = 0] = feeds['x']?.dims ?? [];
          runs.push([n, width]);
          const plane = REC_HEIGHT * width;
          const classes = CHARSET.length + 2;
          const data = new Float32Array(n * 2 * classes);
          for (let i = 0; i < n; i++) {
            const pixels = feeds['x']!.data.subarray(i * 3 * plane, i * 3 * plane + plane);
            const brightest = Math.max(...pixels);
            const gray = Math.round((brightest * 0.5 + 0.5) * 255);
            data[i * 2 * classes + 1 + Math.round((gray - 150) / 20)] = 1;
            data[(i * 2 + 1) * classes] = 1;
          }
          return { data, dims: [n, 2, classes] };
        }),
      );
    },
  };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-paddle-batches-'));
  await mkdir(join(dir, 'det'));
  await mkdir(join(dir, 'rec'));
  await writeFile(join(dir, 'charset.json'), JSON.stringify(CHARSET));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function read(recBatch: number) {
  const runs: number[][] = [];
  const engine = createPaddleDevanagariOcr({ onnx: bandsRuntime(runs), modelDir: dir, recBatch });
  const pages = await engine.recognize([bandsFrame()], { languages: ['hi'] });
  if (!pages.ok) throw new Error(pages.error.code);
  return { observations: pages.value[0]?.observations ?? [], runs };
}

describe('recBatches', () => {
  it('sorts by width, keeps detection order within a width, and cuts runs of `size`', () => {
    expect(recBatches([1120, 320, 640, 320, 1280], 2)).toEqual([[1, 3], [2, 0], [4]]);
    expect(recBatches([1120, 320, 640, 320, 1280], 8)).toEqual([[1, 3, 2, 0, 4]]);
    expect(recBatches([], 8)).toEqual([]);
    expect(recBatches([320, 320], 0)).toEqual([[0], [1]]);
  });
});

describe('PP-OCR recogniser runs', () => {
  it('reads the same lines, in detection order, whatever the batch size', async () => {
    const alone = await read(1);
    expect(alone.observations.map((o) => o.text)).toEqual(LETTERS);
    expect(alone.runs).toHaveLength(5);
    for (const size of [2, 3, 8]) {
      const batched = await read(size);
      expect(batched.observations).toEqual(alone.observations);
      expect(batched.runs).toHaveLength(Math.ceil(5 / size));
    }
  });

  it('pads a run only to its own widest crop', async () => {
    const { runs } = await read(2);
    // The two short lines share a run at the 320-pixel base; the long ones run at their own widths.
    expect(runs[0]).toEqual([2, 320]);
    expect(runs.map(([, width]) => width)).toEqual(
      [...runs.map(([, width]) => width)].sort((a, b) => a! - b!),
    );
  });
});
