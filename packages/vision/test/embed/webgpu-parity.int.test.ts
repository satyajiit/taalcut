// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EmbeddingGemma 2 (q4 text and vision graphs) on WebGPU against the CPU (P3-B1). onnxruntime-node 1.30's
 * WebGPU execution provider got Silero VAD's LSTM state wrong (audio SPEC), so the embedder is checked the same
 * way: the same texts (four languages, query and document prefixes) and the same frames through the model loaded
 * on WebGPU and on the CPU, compared per vector (cosine) and at the task (each query ranks the documents and the
 * frames in the same order).
 *
 * Opt-in: runs when the component is in `packages/vision/.cache/embeddinggemma-2/` (or
 * `TAALCUT_EMBEDDINGGEMMA_2_DIR`), skipped with the reason otherwise.
 */
import { describe, expect, it } from 'vitest';
import { loadTransformersModel, type EmbeddingImage, type EmbeddingModel } from '../../src/embed/model';
import { embeddingFrameSize, prefixed } from '../../src/embed/space';
import { componentDir } from '../helpers/offline';
import { pairwise, ranking } from '../helpers/parity';

const modelDir = componentDir('embeddinggemma-2', 'onnx/model_q4.onnx_data');

/**
 * Spike 02 saw the same vectors on both. q4's worst cosine to fp32 is 0.975 (model card), so 0.999 between two
 * runs of the same q4 graph leaves room only for float ordering, not for a wrong kernel.
 */
const MIN_COSINE = 0.999;

const QUERIES = [
  'a beach at sunset',
  'समुद्र तट पर सूर्यास्त',
  'una reunión de presupuesto',
  'receita de bolo de chocolate',
].map((text) => prefixed(text, 'query'));

const DOCUMENTS = [
  'we walked along the beach while the sun went down',
  'हम सूरज ढलते समय समुद्र के किनारे चले',
  'la reunión trimestral de presupuesto empieza a las nueve',
  'misture a farinha, o cacau e os ovos e asse por quarenta minutos',
  'the drone flies over a snowy mountain ridge',
].map((text) => prefixed(text, 'document'));

/** Frames at the processor's own size for a 9:16 source, made in code: no FFmpeg. */
function frames(): EmbeddingImage[] {
  const { width, height } = embeddingFrameSize(1080, 1920);
  const paint = (pixel: (x: number, y: number) => readonly [number, number, number]): EmbeddingImage => {
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) rgb.set(pixel(x, y), (y * width + x) * 3);
    }
    return { width, height, rgb };
  };
  return [
    // Sunset: orange sky over a dark sea.
    paint((_x, y) => (y < height * 0.6 ? [255, 140 - Math.round((60 * y) / height), 40] : [20, 40, 80])),
    // Deep blue water.
    paint((x, y) => [10, 40 + Math.round((40 * x) / width), 120 + Math.round((80 * y) / height)]),
    // A test card: eight vertical bars.
    paint((x) => {
      const bars = [
        [255, 255, 255],
        [255, 255, 0],
        [0, 255, 255],
        [0, 255, 0],
        [255, 0, 255],
        [255, 0, 0],
        [0, 0, 255],
        [0, 0, 0],
      ] as const;
      return bars[Math.min(7, Math.floor((x * 8) / width))] ?? [0, 0, 0];
    }),
  ];
}

interface Run {
  readonly device: string;
  /** Wall time of the three embed calls, ms (load excluded). */
  readonly ms: number;
  readonly queries: Float32Array[];
  readonly documents: Float32Array[];
  readonly frames: Float32Array[];
}

async function embedOn(device: 'webgpu' | 'cpu', dir: string): Promise<Run> {
  const model: EmbeddingModel = await loadTransformersModel(dir, device);
  try {
    // One warm-up call: the first WebGPU run compiles its kernels.
    await model.embedTexts(QUERIES.slice(0, 1));
    const started = performance.now();
    const queries = await model.embedTexts(QUERIES);
    const documents = await model.embedTexts(DOCUMENTS);
    const images = await model.embedImages(frames());
    return { device: model.device, ms: performance.now() - started, queries, documents, frames: images };
  } finally {
    await model.dispose();
  }
}

function largestGap(a: readonly Float32Array[], b: readonly Float32Array[]): number {
  let worst = 0;
  a.forEach((vector, i) => {
    vector.forEach((x, j) => (worst = Math.max(worst, Math.abs(x - (b[i]?.[j] ?? 0)))));
  });
  return worst;
}

describe.skipIf(!modelDir)(
  `EmbeddingGemma 2 on WebGPU against the CPU${modelDir ? '' : ' (skipped: embeddinggemma-2 is not in .cache)'}`,
  () => {
    it('gives the same vectors and the same rankings on WebGPU and the CPU', async (context) => {
      const dir = modelDir ?? '';
      let gpu: Run;
      try {
        gpu = await embedOn('webgpu', dir);
      } catch (cause) {
        context.skip(`no WebGPU session for EmbeddingGemma 2 on this Mac: ${String(cause)}`);
        return;
      }
      const cpu = await embedOn('cpu', dir);
      expect([gpu.device, cpu.device]).toEqual(['webgpu', 'cpu']);
      const texts = pairwise([...gpu.queries, ...gpu.documents], [...cpu.queries, ...cpu.documents]);
      const images = pairwise(gpu.frames, cpu.frames);
      const gap = largestGap(
        [...gpu.queries, ...gpu.documents, ...gpu.frames],
        [...cpu.queries, ...cpu.documents, ...cpu.frames],
      );
      console.warn(
        `EmbeddingGemma 2: 1 − cosine at most ${(1 - Math.min(...texts)).toExponential(2)} over ${texts.length} ` +
          `texts and ${(1 - Math.min(...images)).toExponential(2)} over ${images.length} frames; largest element ` +
          `gap ${gap.toExponential(2)}; embed time WebGPU ${gpu.ms.toFixed(0)} ms, CPU ${cpu.ms.toFixed(0)} ms`,
      );
      for (const value of [...texts, ...images]) expect(value).toBeGreaterThanOrEqual(MIN_COSINE);
      for (const [i, query] of gpu.queries.entries()) {
        const cpuQuery = cpu.queries[i] ?? query;
        expect(ranking(query, gpu.documents)).toEqual(ranking(cpuQuery, cpu.documents));
        expect(ranking(query, gpu.frames)).toEqual(ranking(cpuQuery, cpu.frames));
      }
    }, 600_000);
  },
);
