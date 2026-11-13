// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `ocr-recall.ts`'s comparison (round IX's gate, IX-O2..O4; a study tool since IX3-B2, the gate is tools/evals
 * `eval:text-recall`): every word the baseline read on a known line is still read. Walked from the baseline's lines, so a clip the run did not profile (a run cut short, a
 * `--clips` subset) loses its words instead of dropping out of the gate (IX2-F1).
 */

export interface LineResult {
  readonly file: string;
  readonly line: string;
  readonly found: readonly string[];
  readonly words: readonly string[];
  readonly read: readonly string[];
}

/** `<file>: <word> (<line>)` for each word the baseline found that the run did not. */
export function lostWords(run: readonly LineResult[], baseline: readonly LineResult[]): string[] {
  const lost: string[] = [];
  for (const before of baseline) {
    const now = run.find((line) => line.file === before.file && line.line === before.line);
    for (const word of before.found) {
      if (!now) lost.push(`${before.file}: ${word} (${before.line}; not profiled)`);
      else if (!now.found.includes(word)) lost.push(`${before.file}: ${word} (${before.line})`);
    }
  }
  return lost;
}
