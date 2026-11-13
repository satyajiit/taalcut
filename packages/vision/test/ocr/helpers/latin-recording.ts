// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** PP-OCRv5 Latin's recorded output (scripts/ppocr-record.ts), replayed as a fake ONNX runtime. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ok } from '@taalcut/core';
import { z } from 'zod';
import type { OnnxRuntime, OnnxTensor } from '../../../src/onnx/ort';
import { PADDLE_LATIN } from '../../../src/ocr/paddle/models';
import { fakeSession } from './fakes';

const recordingSchema = z.object({
  det: z.object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
    runs: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()])),
  }),
  rec: z.array(
    z.object({
      dims: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
      top: z.array(z.tuple([z.number().int(), z.number()])),
    }),
  ),
  charset: z.record(z.string(), z.string()),
  read: z.array(
    z.object({
      text: z.string(),
      box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
      confidence: z.number(),
    }),
  ),
});
export type LatinRecording = z.infer<typeof recordingSchema>;

export const RECORDING_PATH = fileURLToPath(
  new URL('../../fixtures/text/ppocr-latin-recorded.json', import.meta.url),
);

export function latinRecording(): LatinRecording {
  return recordingSchema.parse(JSON.parse(readFileSync(RECORDING_PATH, 'utf8')));
}

/** A charset of the model's size naming only the recorded classes (the rest are placeholders it never reads). */
export function recordedCharset(recording: LatinRecording): string[] {
  return Array.from(
    { length: PADDLE_LATIN.charsetSize },
    (_, i) => recording.charset[String(i + 1)] ?? `#${i + 1}`,
  );
}

function detectorBitmap(det: LatinRecording['det']): OnnxTensor {
  const data = new Float32Array(det.height * det.width);
  for (const [y, x0, x1] of det.runs) data.fill(0.9, y * det.width + x0, y * det.width + x1);
  return { data, dims: [1, 1, det.height, det.width] };
}

/** The recorded top class of each row at its probability, the rest spread evenly over the other classes. */
function recogniserScores(batch: LatinRecording['rec'][number]): OnnxTensor {
  const [, , classes] = batch.dims;
  const data = new Float32Array(batch.top.length * classes);
  batch.top.forEach(([best, p], row) => {
    data.fill((1 - p) / (classes - 1), row * classes, (row + 1) * classes);
    data[row * classes + best] = p;
  });
  return { data, dims: batch.dims };
}

/** The detector's bitmap at 0.9 inside the recorded runs; the recogniser's batches in recorded order. */
export function replayRuntime(recording: LatinRecording): OnnxRuntime {
  const { det, rec } = recording;
  let next = 0;
  return {
    async openSession(path) {
      if (path.includes('det')) {
        return ok(fakeSession('det_out', () => detectorBitmap(det), 'cpu'));
      }
      return ok(
        fakeSession(
          'rec_out',
          () => {
            const batch = rec[next++ % rec.length];
            return batch ? recogniserScores(batch) : { data: new Float32Array(0), dims: [0, 0, 0] };
          },
          'cpu',
        ),
      );
    },
  };
}
