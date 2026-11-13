// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PP-OCRv5 Devanagari on WebGPU against the CPU (P3-B1). onnxruntime-node 1.30's WebGPU execution provider got
 * Silero VAD's LSTM state wrong (audio SPEC), so the detector and the recogniser are checked the same way: the
 * same tensors through a WebGPU session and a CPU session (`disableGpu`), compared at the output (the detector's
 * probability map, the recogniser's per-step class scores) and at the task (the text read and where it is).
 *
 * Opt-in: runs when the component is in `packages/vision/.cache/ppocr-v5-devanagari/`, skipped with the reason
 * otherwise. A Mac whose WebGPU session can't be created has nothing to compare and says so.
 */
import { join } from 'node:path';
import type { ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createOrtRuntime, type OnnxSession } from '../../src/onnx/ort';
import { createPaddleDevanagariOcr } from '../../src/ocr/paddle/engine';
import { detTensor, recTensor } from '../../src/ocr/paddle/preprocess';
import type { OcrFrame } from '../../src/ocr/types';
import { difference } from '../helpers/parity';
import { HAS_PADDLE, LINES, PADDLE_DIR, syntheticFrame } from './helpers/fixtures';

/** Both maps are sigmoid probabilities (0–1); boxes come from thresholds at 0.3 and 0.6. */
const DET_MAX_ABS = 1e-2;
/** Per-step class probabilities (0–1) after the recogniser's softmax. */
const REC_MAX_ABS = 1e-2;
/** A box edge may move by at most one pixel of the 720×1280 frame. */
const BOX_TOLERANCE = 1 / 720;

const HINDI = LINES.filter((line) => line.language === 'hi');

function frames(): OcrFrame[] {
  const single = HINDI.map((line, i) =>
    syntheticFrame(i, 720, 1280, [{ id: line.file.replace('.png', ''), left: 80, top: 300 + 120 * i }]),
  );
  const all = syntheticFrame(
    HINDI.length,
    720,
    1280,
    HINDI.map((line, i) => ({ id: line.file.replace('.png', ''), left: 60, top: 200 + 160 * i })),
  );
  return [...single, all];
}

/** Each fixture line alone on the gradient, at its own size: what the recogniser gets as a crop. */
function crops() {
  return HINDI.map((line) => {
    const frame = syntheticFrame(0, line.width, line.height, [
      { id: line.file.replace('.png', ''), left: 0, top: 0 },
    ]);
    return { data: frame.rgb, width: frame.width, height: frame.height };
  });
}

async function sessions(gpu: boolean) {
  const runtime = createOrtRuntime({ disableGpu: !gpu });
  const det = await runtime.openSession(join(PADDLE_DIR, 'det', 'inference.onnx'), {
    operation: 'vision.ocr',
  });
  const rec = await runtime.openSession(join(PADDLE_DIR, 'rec', 'inference.onnx'), {
    operation: 'vision.ocr',
  });
  if (!det.ok || !rec.ok) throw new Error(`could not open PP-OCRv5 (gpu ${gpu})`);
  return { det: det.value, rec: rec.value };
}

async function only(session: OnnxSession, data: Float32Array, dims: readonly number[]) {
  const out = await session.run({ [session.inputNames[0] ?? 'x']: { data, dims } });
  if (!out.ok) throw new Error(out.error.detail ?? out.error.code);
  const tensor = out.value[session.outputNames[0] ?? ''] ?? Object.values(out.value)[0];
  if (!tensor) throw new Error('no output');
  return tensor;
}

describe.skipIf(!HAS_PADDLE)(
  `PP-OCRv5 on WebGPU against the CPU${HAS_PADDLE ? '' : ' (skipped: ppocr-v5-devanagari is not in .cache)'}`,
  () => {
    it('the detector and the recogniser give the same scores on WebGPU and the CPU', async (context) => {
      const gpu = await sessions(true);
      const cpu = await sessions(false);
      try {
        if (gpu.det.backend !== 'webgpu' || gpu.rec.backend !== 'webgpu') {
          context.skip('no WebGPU session for PP-OCRv5 on this Mac');
          return;
        }
        expect([cpu.det.backend, cpu.rec.backend]).toEqual(['cpu', 'cpu']);
        for (const frame of frames()) {
          const input = detTensor({ data: frame.rgb, width: frame.width, height: frame.height });
          const a = await only(gpu.det, input.data, input.dims);
          const b = await only(cpu.det, input.data, input.dims);
          const diff = difference(a.data, b.data);
          console.warn(
            `PP-OCRv5 det, frame ${frame.index} (${input.dims.join('×')}): max |Δ| ` +
              `${diff.maxAbs.toExponential(2)}, mean ${diff.meanAbs.toExponential(2)}`,
          );
          expect(diff.maxAbs).toBeLessThanOrEqual(DET_MAX_ABS);
        }
        const batch = recTensor(crops());
        const a = await only(gpu.rec, batch.data, batch.dims);
        const b = await only(cpu.rec, batch.data, batch.dims);
        const diff = difference(a.data, b.data);
        console.warn(
          `PP-OCRv5 rec, ${HINDI.length} lines (${a.dims.join('×')}): max |Δ| ${diff.maxAbs.toExponential(2)}, ` +
            `mean ${diff.meanAbs.toExponential(2)}`,
        );
        expect(diff.maxAbs).toBeLessThanOrEqual(REC_MAX_ABS);
      } finally {
        for (const session of [gpu.det, gpu.rec, cpu.det, cpu.rec]) await session.release();
      }
    }, 120_000);

    it('reads the same text in the same places on WebGPU and the CPU', async (context) => {
      const fallbacks: ComputeFallbackEvent[] = [];
      const onGpu = createPaddleDevanagariOcr({
        onnx: createOrtRuntime({ onFallback: (event) => fallbacks.push(event) }),
        modelDir: PADDLE_DIR,
      });
      const onCpu = createPaddleDevanagariOcr({
        onnx: createOrtRuntime({ disableGpu: true }),
        modelDir: PADDLE_DIR,
      });
      const input = frames();
      const a = await onGpu.recognize(input, { languages: ['hi'] });
      const b = await onCpu.recognize(input, { languages: ['hi'] });
      await onGpu.close?.();
      await onCpu.close?.();
      if (!a.ok || fallbacks.length > 0) {
        context.skip(
          `PP-OCRv5 did not run on WebGPU here: ${a.ok ? JSON.stringify(fallbacks) : a.error.code}`,
        );
        return;
      }
      expect(b.ok).toBe(true);
      if (!b.ok) return;
      let worst = 0;
      for (const [i, page] of a.value.entries()) {
        const other = b.value[i]?.observations ?? [];
        expect(page.observations.map((o) => o.text)).toEqual(other.map((o) => o.text));
        page.observations.forEach((o, j) => {
          const box = other[j]?.box;
          if (!box) return;
          worst = Math.max(
            worst,
            Math.abs(o.box.x - box.x),
            Math.abs(o.box.y - box.y),
            Math.abs(o.box.width - box.width),
            Math.abs(o.box.height - box.height),
          );
        });
      }
      const read = a.value.map((page) => page.observations.map((o) => o.text).join(' | '));
      console.warn(
        `PP-OCRv5 task: same text on ${a.value.length} frames, worst box edge ${worst} ${JSON.stringify(read)}`,
      );
      expect(worst).toBeLessThanOrEqual(BOX_TOLERANCE);
    }, 120_000);
  },
);
