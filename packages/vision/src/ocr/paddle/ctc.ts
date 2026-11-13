// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Greedy CTC decoding for the PP-OCRv5 recognisers. The head is the charset
 * plus two wide (Devanagari 570, Latin 838): class 0 is the blank, then the
 * charset, then a space (Paddle's `use_space_char`). Argmax per step, repeats
 * collapsed, blanks dropped.
 */

export interface CtcLine {
  /** NFC. */
  readonly text: string;
  /** Mean of the winning probability over the kept characters (0 when nothing was read). */
  readonly confidence: number;
}

/**
 * Decodes one `[T, C]` slice. Scores are softmax output; logits are turned
 * into probabilities first so the confidence means the same either way.
 */
export function ctcDecode(
  scores: Float32Array,
  steps: number,
  classes: number,
  charset: readonly string[],
): CtcLine {
  if (classes !== charset.length + 2 && classes !== charset.length + 1) {
    throw new RangeError(`CTC head has ${classes} classes for a charset of ${charset.length}`);
  }
  const space = classes === charset.length + 2 ? classes - 1 : -1;
  let previous = -1;
  let text = '';
  let sum = 0;
  let kept = 0;
  for (let t = 0; t < steps; t++) {
    const base = t * classes;
    let best = 0;
    let bestValue = -Infinity;
    let max = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = scores[base + c] ?? -Infinity;
      if (v > bestValue) {
        bestValue = v;
        best = c;
      }
      if (v > max) max = v;
    }
    if (best !== previous && best !== 0) {
      text += best === space ? ' ' : (charset[best - 1] ?? '');
      sum += probabilityOf(scores, base, classes, bestValue, max);
      kept++;
    }
    previous = best;
  }
  return { text: text.normalize('NFC'), confidence: kept > 0 ? sum / kept : 0 };
}

function probabilityOf(
  scores: Float32Array,
  base: number,
  classes: number,
  value: number,
  max: number,
): number {
  if (value >= 0 && value <= 1) {
    // Already a probability row (sums to 1) on the shipped model; check cheaply on the winner only.
    let total = 0;
    for (let c = 0; c < classes; c++) total += scores[base + c] ?? 0;
    if (Math.abs(total - 1) < 0.05) return value;
  }
  let denominator = 0;
  for (let c = 0; c < classes; c++) denominator += Math.exp((scores[base + c] ?? -Infinity) - max);
  return denominator > 0 ? Math.exp(value - max) / denominator : 0;
}

/** Splits a `[N, T, C]` recogniser output into per-line decodes. */
export function ctcDecodeBatch(
  data: Float32Array,
  dims: readonly number[],
  charset: readonly string[],
): CtcLine[] {
  const [n = 0, steps = 0, classes = 0] = dims.length === 3 ? dims : [1, dims[0] ?? 0, dims[1] ?? 0];
  const lines: CtcLine[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(
      ctcDecode(data.subarray(i * steps * classes, (i + 1) * steps * classes), steps, classes, charset),
    );
  }
  return lines;
}
