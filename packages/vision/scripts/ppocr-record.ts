// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Records what PP-OCRv5 Latin reads on the committed Latin text lines (IX-O7), for the unit test that replays
 * it (`test/ocr/paddle-latin.test.ts`) where the model isn't installed:
 *
 *   pnpm --filter @taalcut/vision exec tsx scripts/ppocr-record.ts --model-dir .cache/ppocr-v5-latin
 *     [--out test/fixtures/text/ppocr-latin-recorded.json]
 *
 * Kept: the detector's map above DB's threshold as row runs (the boxes come from that bitmap), every recogniser
 * batch's winning class and its probability per step (greedy CTC reads only those), the charset entries those
 * classes name, and what the engine read end to end. CPU execution provider: the recording is the model's
 * output, and the CPU is the reference the WebGPU parity test compares against.
 */
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ok } from '@taalcut/core';
import { createOrtRuntime, type OnnxRuntime, type OnnxSession, type OnnxTensor } from '../src/onnx/ort';
import { DB_THRESH } from '../src/ocr/paddle/db';
import { createPaddleOcr } from '../src/ocr/paddle/engine';
import { PADDLE_LATIN } from '../src/ocr/paddle/models';
import { LATIN_SCENE, latinScene } from '../test/ocr/helpers/latin-scene';

const { values } = parseArgs({
  options: {
    'model-dir': { type: 'string' },
    out: { type: 'string', default: 'test/fixtures/text/ppocr-latin-recorded.json' },
  },
});
const modelDir = values['model-dir'];
if (!modelDir) throw new Error('--model-dir is required');

interface RecBatch {
  readonly dims: readonly number[];
  /** [class, probability] per crop and step, crop-major. */
  readonly top: [number, number][];
}
let det: { height: number; width: number; runs: [number, number, number][] } | undefined;
const rec: RecBatch[] = [];

function runs(map: OnnxTensor): [number, number, number][] {
  const [height = 0, width = 0] = map.dims.slice(-2);
  const out: [number, number, number][] = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && (map.data[y * width + x] ?? 0) > DB_THRESH;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        out.push([y, start, x]);
        start = -1;
      }
    }
  }
  return out;
}

function top(scores: OnnxTensor): RecBatch {
  const [n = 0, steps = 0, classes = 0] = scores.dims;
  const picks: [number, number][] = [];
  for (let row = 0; row < n * steps; row++) {
    let best = 0;
    for (let c = 1; c < classes; c++)
      if ((scores.data[row * classes + c] ?? 0) > (scores.data[row * classes + best] ?? 0)) best = c;
    picks.push([best, Math.round((scores.data[row * classes + best] ?? 0) * 1e4) / 1e4]);
  }
  return { dims: [...scores.dims], top: picks };
}

/** The CPU runtime, with every session's first output recorded. */
function recording(): OnnxRuntime {
  const runtime = createOrtRuntime({ disableGpu: true });
  return {
    async openSession(path, options) {
      const opened = await runtime.openSession(path, options);
      if (!opened.ok) return opened;
      const session = opened.value;
      const isDet = path.includes(join('det', 'inference.onnx'));
      const recorded: OnnxSession = {
        ...session,
        async run(feeds, signal) {
          const out = await session.run(feeds, signal);
          if (!out.ok) return out;
          const first = out.value[session.outputNames[0] ?? ''] ?? Object.values(out.value)[0];
          if (first && isDet) {
            const [height = 0, width = 0] = first.dims.slice(-2);
            det = { height, width, runs: runs(first) };
          } else if (first) rec.push(top(first));
          return out;
        },
      };
      return ok(recorded);
    },
  };
}

const engine = createPaddleOcr({ onnx: recording(), modelDir, model: PADDLE_LATIN });
const pages = await engine.recognize([latinScene()], { languages: ['en', 'es', 'pt'] });
await engine.close?.();
if (!pages.ok) throw new Error(`${pages.error.code}: ${pages.error.detail ?? ''}`);
const charset = JSON.parse(readFileSync(join(modelDir, 'charset.json'), 'utf8')) as string[];
const used = new Set(rec.flatMap((batch) => batch.top.map(([c]) => c)));
const names = Object.fromEntries(
  [...used].filter((c) => c >= 1 && c <= charset.length).map((c) => [c, charset[c - 1] ?? '']),
);
const read =
  pages.value[0]?.observations.map(({ text, box, confidence }) => ({ text, box, confidence })) ?? [];
await writeFile(
  values.out,
  `${JSON.stringify(
    {
      $comment:
        'Recorded by scripts/ppocr-record.ts: PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx @89d3a50e (inference.onnx sha256 7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498) and PP-OCRv5_mobile_det_onnx @e6f4fa85, onnxruntime-node 1.30.0 CPU EP, on the scene in test/ocr/helpers/latin-scene.ts.',
      scene: LATIN_SCENE,
      det,
      rec,
      charset: names,
      read,
    },
    null,
    0,
  )}\n`,
);
for (const o of read) process.stdout.write(`${o.text}  (${o.confidence.toFixed(3)})\n`);
