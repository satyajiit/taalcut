// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only (TAALCUT_BUILD_FLAVOUR=test with TAALCUT_TEST_EMBEDDINGS=1):
 * a deterministic stand-in for EmbeddingGemma 2, for desktop e2e runs that
 * are offline and so can't install the model component. The jobs process
 * loads it as the embedder's model (jobs.ts, through import()), so every
 * caller still goes through the real VisionEmbedder, its queue and its
 * space; the e2e library seeder writes shot vectors with the same functions.
 *
 * Texts: hashed words (the query and document prefixes taken off, so a query
 * and a stored text with the same words meet). Frames: the picture pooled to
 * a 16 × 16 grid of colours, centred, so cuts between different shots are far
 * apart and frames of one shot are close. It is never a quality number.
 */
import type { EmbeddingImage, EmbeddingModel, EmbeddingModelLoader } from '@taalcut/vision';

export const STANDIN_EMBEDDINGS_ENV = 'TAALCUT_TEST_EMBEDDINGS';

const DIMENSIONS = 768;
const GRID = 16;
const PREFIXES = ['task: search result | query: ', 'title: none | text: '];
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function unit(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) {
    const fallback = new Float32Array(vector.length);
    fallback[0] = 1;
    return fallback;
  }
  return vector.map((value) => value / norm);
}

/** FNV-1a, 32 bits. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Plural and -ing endings off, so "beaches" and "beach", "walking" and "walk" meet. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function standInTextVector(text: string): Float32Array {
  let body = text.toLowerCase();
  for (const prefix of PREFIXES) if (body.startsWith(prefix)) body = body.slice(prefix.length);
  const vector = new Float32Array(DIMENSIONS);
  const words = body.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !STOP_WORDS.has(word));
  for (const word of words) {
    const h = hash(stem(word));
    vector[h % DIMENSIONS]! += h & 0x8000_0000 ? -1 : 1;
  }
  return unit(vector);
}

export function standInImageVector(image: EmbeddingImage): Float32Array {
  const sums = new Float64Array(GRID * GRID * 3);
  const counts = new Uint32Array(GRID * GRID);
  for (let y = 0; y < image.height; y += 1) {
    const row = Math.min(GRID - 1, Math.floor((y * GRID) / image.height));
    for (let x = 0; x < image.width; x += 1) {
      const cell = row * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / image.width));
      const at = (y * image.width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1)
        sums[cell * 3 + channel] = (sums[cell * 3 + channel] ?? 0) + (image.rgb[at + channel] ?? 0);
      counts[cell]! += 1;
    }
  }
  const vector = new Float32Array(DIMENSIONS);
  for (let i = 0; i < vector.length; i += 1) vector[i] = sums[i]! / Math.max(1, counts[Math.floor(i / 3)]!) / 255;
  let mean = 0;
  for (const value of vector) mean += value / vector.length;
  const centred = vector.map((value) => value - mean);
  // A flat frame has nothing left once centred: its colour is the vector.
  return centred.some((value) => Math.abs(value) > 1e-6) ? unit(centred) : unit(vector);
}

export function standInEmbeddingModel(): EmbeddingModel {
  return {
    device: 'webgpu',
    embedTexts: async (texts) => texts.map(standInTextVector),
    embedImages: async (images) => images.map(standInImageVector),
    dispose: async () => undefined,
  };
}

export const standInEmbeddingLoader: EmbeddingModelLoader = async () => standInEmbeddingModel();
