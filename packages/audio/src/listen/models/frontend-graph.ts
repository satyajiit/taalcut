// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the two spectrogram graphs (clap-frontend.ts, ast-fbank.ts) share: a batch of windows framed into one
 * `[windows · rows, frameLength]` input, and the output cut back into one feature block per window. Sessions run
 * the graph (sessions.ts); the caller falls back to the f64 oracle when the graph would run on the CPU.
 *
 * Precision: a float32 DFT (direct or two-stage, CPU or WebGPU, measured the same) carries about 140 dB of dynamic
 * range, so a mel bin far under its frame's loudest one, near the 1e-10 floor, can be a few hundredths of a dB off
 * the f64 oracle; bins that carry the sound agree to about 1e-4 dB (SPEC.md, EAR1 listening).
 */
import type { OnnxGraph } from '@taalcut/media';

export interface FrontEndConstant {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

export interface FrontEndSpec {
  readonly key: 'clap' | 'ast';
  /** Output rows per window (CLAP 1001 frames, AST 1024). */
  readonly rowsPerWindow: number;
  readonly frameLength: number;
  /** Mel bins per row. */
  readonly width: number;
  graph(rows: number): OnnxGraph;
  /** The basis, the bank and the scalars, as graph inputs (no initializers in `encodeOnnxModel`). */
  constants(): Record<string, FrontEndConstant>;
  /** Writes one window's frames at `offset`; returns how many rows are real frames. */
  frame(segment: Float32Array, out: Float32Array, offset?: number): number;
  /** Fixes the rows past the real frames of one window's output. */
  finish(window: Float32Array, valid: number): void;
}

export interface FramedBatch {
  readonly frames: Float32Array;
  readonly rows: number;
  readonly valid: readonly number[];
}

export function frameBatch(spec: FrontEndSpec, segments: readonly Float32Array[]): FramedBatch {
  const rows = spec.rowsPerWindow * segments.length;
  const frames = new Float32Array(rows * spec.frameLength);
  const valid = segments.map((segment, i) =>
    spec.frame(segment, frames, i * spec.rowsPerWindow * spec.frameLength),
  );
  return { frames, rows, valid };
}

/** The graph's output, one `[rowsPerWindow, width]` block per window, padding rows fixed. */
export function splitFeatures(
  spec: FrontEndSpec,
  data: ArrayLike<number>,
  valid: readonly number[],
): Float32Array[] {
  const size = spec.rowsPerWindow * spec.width;
  return valid.map((count, i) => {
    const block = new Float32Array(size);
    for (let j = 0; j < size; j++) block[j] = Number(data[i * size + j] ?? 0);
    spec.finish(block, count);
    return block;
  });
}

const constantCache = new Map<string, Record<string, FrontEndConstant>>();

/** The spec's constants, built once per process (the basis is a few MB and never changes). */
export function frontEndConstants(spec: FrontEndSpec): Record<string, FrontEndConstant> {
  const cached = constantCache.get(spec.key);
  if (cached) return cached;
  const built = spec.constants();
  constantCache.set(spec.key, built);
  return built;
}
