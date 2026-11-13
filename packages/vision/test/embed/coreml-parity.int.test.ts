// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Core ML model in the mac helper against the ONNX path it stands in for (IX2-E3, E5): the same texts (four
 * languages, query and document prefixes) and frames at every image-token budget, landscape and portrait, through
 * `loadCoreMlModel` and through `loadTransformersModel` on WebGPU, compared per vector. Both must be one space, so the
 * bar is the design's: cosine ≥ 0.999 for every vector. At the task, each query orders the documents the same on
 * both except near ties the vectors' own difference can swap (the first run swapped two of a query's unrelated
 * documents). The 208-frame, 200-text measurement behind the choice is in the
 * vision SPEC ("Core ML backend").
 *
 * Opt-in: needs macOS 15, the helper (native/mac-helper/build.sh), `.cache/embeddinggemma-2` and
 * `.cache/embeddinggemma-2-coreml` (tools/components/pack-embeddinggemma-coreml.sh); skipped with the reason
 * otherwise. The first run on a Mac compiles the text functions for its Neural Engine (about two minutes).
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { developmentCoreMlLoader } from '../../src/embed/coreml-development';
import { loadTransformersModel, type EmbeddingImage, type EmbeddingModel } from '../../src/embed/model';
import {
  embeddingFrameSize,
  IMAGE_TOKEN_BUDGETS,
  prefixed,
  type ImageTokenBudget,
} from '../../src/embed/space';
import { componentDir } from '../helpers/offline';
import { cosine, pairwise } from '../helpers/parity';

const MIN_COSINE = 0.999;
const onnxDir = componentDir('embeddinggemma-2', 'onnx/model_q4.onnx_data');
const coremlDir = componentDir('embeddinggemma-2-coreml', 'EmbeddingGemma2Text.mlmodelc/coremldata.bin');
// Darwin 24 is macOS 15.
const macos15 = process.platform === 'darwin' && Number.parseInt(release(), 10) >= 24;
const coreMlLoader = await developmentCoreMlLoader();
const missing = !macos15
  ? 'needs macOS 15'
  : !coreMlLoader.ok
    ? `no mac helper (${coreMlLoader.error.code})`
    : !onnxDir
      ? 'embeddinggemma-2 is not in .cache'
      : !coremlDir
        ? 'embeddinggemma-2-coreml is not in .cache'
        : '';

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

/** A deterministic pseudo-random byte stream (xorshift), for texture. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % 256;
  };
}

/** Four frames sized for `budget` from a `w`×`h` source, painted in code. */
function frames(budget: ImageTokenBudget, w: number, h: number): EmbeddingImage[] {
  const { width, height } = embeddingFrameSize(w, h, budget);
  const paint = (pixel: (x: number, y: number) => readonly [number, number, number]): EmbeddingImage => {
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) rgb.set(pixel(x, y), (y * width + x) * 3);
    }
    return { width, height, rgb };
  };
  const grain = noise(budget + w);
  return [
    paint((_x, y) => (y < height * 0.6 ? [255, 140 - Math.round((60 * y) / height), 40] : [20, 40, 80])),
    paint((x, y) => [10, 40 + Math.round((40 * x) / width), 120 + Math.round((80 * y) / height)]),
    paint((x, y) => ((Math.floor(x / 24) + Math.floor(y / 24)) % 2 === 0 ? [240, 240, 240] : [30, 30, 30])),
    paint((x, y) => {
      const inside = (x - width / 2) ** 2 + (y - height / 2) ** 2 < (Math.min(width, height) / 3) ** 2;
      const g = grain();
      return inside ? [200, 40 + (g >> 3), 40] : [g, g, g];
    }),
  ];
}

/**
 * Document pairs the two backends order differently although ONNX puts them further apart than the vectors' own
 * difference can move a score. Two unit vectors at cosine c are √(2(1 − c)) apart, so a query and a document each
 * that far off move their score by at most twice that; nearer pairs are a tie at this precision.
 */
function swapped(
  onnx: { query: Float32Array; docs: readonly Float32Array[] },
  coreml: { query: Float32Array; docs: readonly Float32Array[] },
  margin: number,
): string[] {
  const a = onnx.docs.map((doc) => cosine(onnx.query, doc));
  const b = coreml.docs.map((doc) => cosine(coreml.query, doc));
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const gap = (a[i] ?? 0) - (a[j] ?? 0);
      if (Math.abs(gap) > margin && Math.sign(gap) !== Math.sign((b[i] ?? 0) - (b[j] ?? 0))) {
        out.push(`documents ${i} and ${j}, ${gap.toFixed(4)} apart`);
      }
    }
  }
  return out;
}

describe.skipIf(missing !== '')(
  `EmbeddingGemma 2 on Core ML against ONNX Runtime${missing ? ` (skipped: ${missing})` : ''}`,
  () => {
    it(
      'gives the same vectors for texts and for frames at every budget',
      { timeout: 20 * 60_000 },
      async () => {
        const temp = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-coreml-parity-')));
        const models: EmbeddingModel[] = [];
        try {
          const onnx = await loadTransformersModel(onnxDir ?? '', 'webgpu');
          models.push(onnx);
          if (!coreMlLoader.ok) throw new Error(coreMlLoader.error.code);
          const coreml = await coreMlLoader.value({
            coremlDir: coremlDir ?? '',
            tokenizerDir: onnxDir ?? '',
            tempDir: temp,
          });
          models.push(coreml);
          const texts = [...QUERIES, ...DOCUMENTS];
          const [a, b] = [await onnx.embedTexts(texts), await coreml.embedTexts(texts)];
          const lines = [`texts ${Math.min(...pairwise(a, b)).toFixed(5)}`];
          expect(Math.min(...pairwise(a, b))).toBeGreaterThanOrEqual(MIN_COSINE);
          const margin = 2 * Math.sqrt(2 * (1 - Math.min(...pairwise(a, b))));
          for (let q = 0; q < QUERIES.length; q++) {
            const side = (vectors: Float32Array[]) => ({
              query: vectors[q] ?? new Float32Array(768),
              docs: vectors.slice(QUERIES.length),
            });
            // Beyond the margin, every pair of documents keeps its order, the first one included.
            expect(swapped(side(a), side(b), margin)).toEqual([]);
          }
          lines.push(`ranking margin ${margin.toFixed(4)}`);
          for (const budget of IMAGE_TOKEN_BUDGETS) {
            for (const [w, h] of [
              [1920, 1080],
              [1080, 1920],
            ] as const) {
              const images = frames(budget, w, h);
              const least = Math.min(
                ...pairwise(await onnx.embedImages(images), await coreml.embedImages(images)),
              );
              lines.push(`${budget} ${w}x${h} ${least.toFixed(5)}`);
              expect(least).toBeGreaterThanOrEqual(MIN_COSINE);
            }
          }
          console.warn(`Core ML against ONNX, worst cosine: ${lines.join('; ')}`);
        } finally {
          for (const model of models) await model.dispose();
          await rm(temp, { recursive: true, force: true });
        }
      },
    );
  },
);
