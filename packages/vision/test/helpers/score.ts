// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Boundary F1 as the eval scores cuts: a found cut matches one labelled cut within ±tolerance frames. */
export interface BoundaryScore {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export function boundaryF1(
  found: readonly number[],
  labelled: readonly number[],
  tolerance = 2,
): BoundaryScore {
  const free = [...labelled];
  let tp = 0;
  for (const frame of [...found].sort((a, b) => a - b)) {
    const match = free.findIndex((label) => Math.abs(label - frame) <= tolerance);
    if (match >= 0) {
      free.splice(match, 1);
      tp++;
    }
  }
  const fp = found.length - tp;
  const fn = labelled.length - tp;
  const precision = found.length === 0 ? 1 : tp / found.length;
  const recall = labelled.length === 0 ? 1 : tp / labelled.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1 };
}

export function addScores(scores: readonly BoundaryScore[]): BoundaryScore {
  const tp = scores.reduce((s, x) => s + x.truePositives, 0);
  const fp = scores.reduce((s, x) => s + x.falsePositives, 0);
  const fn = scores.reduce((s, x) => s + x.falseNegatives, 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1 };
}
