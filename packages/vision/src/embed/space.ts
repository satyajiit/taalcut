// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EmbeddingGemma 2's shared space for frames and text (P2-L9): one model,
 * one revision, one dtype everywhere, so a library moved between Macs stays
 * searchable. A new model or revision is a new space and a new index.
 */
import type { EmbeddingPurpose, EmbeddingSpace } from '@taalcut/core';

export const EMBEDDING_SPACE: EmbeddingSpace = {
  model: 'embeddinggemma-2',
  revision: 'onnx-q4-daa72c5',
  dimensions: 768,
  indexName: 'eg2_q4_daa72c5',
};

/** The component the weights come from (tools/components). */
export const EMBEDDING_COMPONENT = 'embeddinggemma-2';

/**
 * The same q4 weights compiled for Core ML, for the mac helper's embed service on macOS 15 and later (IX2-E3, E5):
 * vectors at cosine ≥ 0.999 to the ONNX path's (vision SPEC "Core ML backend"), so they share this space.
 */
export const EMBEDDING_COREML_COMPONENT = 'embeddinggemma-2-coreml';

/** The first macOS whose Core ML loads its multifunction models. */
export const EMBEDDING_COREML_MIN_MACOS = 15;

/** Both model cards: queries get the retrieval prefix; stored text gets the document prefix; frames none. */
export const QUERY_PREFIX = 'task: search result | query: ';
export const DOCUMENT_PREFIX = 'title: none | text: ';

export function prefixed(text: string, purpose: EmbeddingPurpose): string {
  return `${purpose === 'query' ? QUERY_PREFIX : DOCUMENT_PREFIX}${text}`;
}

/** The image processor's constants (processor_config.json at the pinned revision). */
const PATCH = 16;
const POOLING = 3;

/**
 * Soft-token budgets the Gemma 4 vision encoder takes per image (its card's
 * variable resolution: 70, 140, 280, 560, 1120). The processor config's
 * default for stills is 280 and for video frames 140.
 */
export const IMAGE_TOKEN_BUDGETS = [70, 140, 280] as const;
export type ImageTokenBudget = (typeof IMAGE_TOKEN_BUDGETS)[number];

/** A budget written as text (a CLI flag), or undefined when it names none. */
export function parseImageTokenBudget(value: string): ImageTokenBudget | undefined {
  return IMAGE_TOKEN_BUDGETS.find((budget) => String(budget) === value.trim());
}

/** The processor config's own budget for stills (`image_processor.max_soft_tokens`). */
export const PROCESSOR_IMAGE_TOKENS: ImageTokenBudget = 280;

/**
 * The budget every distance threshold that compares two frames' vectors was fitted at: shot detection's cut
 * confirmation and the breakdown's cuts (VISION_CONFIG `shots`, `cuts`). Frames sized for those comparisons stay at
 * this budget whatever a machine's index budget is (embedder.ts `frameSize(…, 'calibrated')`, IX2-E1).
 */
export const CALIBRATED_IMAGE_TOKENS: ImageTokenBudget = 280;

/**
 * The size transformers' Gemma 4 image processor resizes a frame to
 * (`get_aspect_ratio_preserving_size`) for a soft-token budget, sides a
 * multiple of 48. Frames are scaled to exactly this by FFmpeg, so the
 * processor never resizes (and sharp is never needed). The processor applies
 * the rule again to the frame it gets, and for some aspects (2:1 gives
 * 1104×528, which it would take to 1152×528) one pass isn't a size it keeps,
 * so the rule runs until it is.
 */
export function embeddingFrameSize(
  width: number,
  height: number,
  tokens: ImageTokenBudget = PROCESSOR_IMAGE_TOKENS,
): { width: number; height: number } {
  let size = processorSize(width, height, tokens);
  for (let i = 0; i < 8; i++) {
    const again = processorSize(size.width, size.height, tokens);
    if (again.width === size.width && again.height === size.height) break;
    size = again;
  }
  return size;
}

/**
 * The budget a frame was sized for: the smallest whose processor size it is (`embeddingFrameSize`'s fixed point),
 * or undefined for a size no budget gives. A model call holds frames of one budget: the processor pads every frame
 * of a call to its budget's patch count.
 */
export function budgetOfFrame(size: {
  readonly width: number;
  readonly height: number;
}): ImageTokenBudget | undefined {
  return IMAGE_TOKEN_BUDGETS.find((budget) => {
    const again = processorSize(size.width, size.height, budget);
    return again.width === size.width && again.height === size.height;
  });
}

/** Soft tokens a frame of this (processor) size becomes: one per 3×3 block of 16 px patches. */
export function imageTokens(size: { readonly width: number; readonly height: number }): number {
  return Math.floor((Math.floor(size.width / PATCH) * Math.floor(size.height / PATCH)) / POOLING ** 2);
}

function processorSize(
  width: number,
  height: number,
  tokens: ImageTokenBudget,
): { width: number; height: number } {
  const maxPatches = tokens * POOLING ** 2;
  const targetPx = maxPatches * PATCH ** 2;
  const factor = Math.sqrt(targetPx / (height * width));
  const side = POOLING * PATCH;
  let h = Math.floor((factor * height) / side) * side;
  let w = Math.floor((factor * width) / side) * side;
  const maxSide = Math.floor(maxPatches / POOLING ** 2) * side;
  if (h === 0 && w === 0) return { width: side, height: side };
  if (h === 0) {
    h = side;
    w = Math.min(Math.floor(width / height) * side, maxSide);
  } else if (w === 0) {
    w = side;
    h = Math.min(Math.floor(height / width) * side, maxSide);
  }
  return { width: w, height: h };
}

/** A unit-length copy (the graph already normalises; this keeps the contract if a graph stops). */
export function unitVector(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const x of vector) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0 || Math.abs(norm - 1) < 1e-6) return Float32Array.from(vector);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = (vector[i] ?? 0) / norm;
  return out;
}

/** 1 − cosine similarity of two unit vectors (0 same, 2 opposite). */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return 1 - dot;
}

/** The distance between the mean of two groups of unit vectors (each mean re-normalised). */
export function meanDistance(a: readonly Float32Array[], b: readonly Float32Array[]): number {
  return cosineDistance(mean(a), mean(b));
}

function mean(vectors: readonly Float32Array[]): Float32Array {
  const width = vectors[0]?.length ?? 0;
  const out = new Float32Array(width);
  for (const vector of vectors) for (let i = 0; i < width; i++) out[i] = (out[i] ?? 0) + (vector[i] ?? 0);
  return unitVector(out);
}
