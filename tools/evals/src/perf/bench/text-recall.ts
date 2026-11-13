// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen text recall in every bench run (IX3-B1): when the footage manifest lists on-screen lines (ix-v1), the run's
 * library copy is scored by `eval:text-recall`'s rule and gated against the set's committed baseline, so each bench
 * says whether the shipped pipeline still reads the words, next to its speed. A library the eval refuses is named
 * with why. The eval itself (src/text-recall) reads several runs and writes the report and the baseline.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readJson } from '../../files';
import { parseNamed } from '../../schema';
import { DEFAULT_MIN_FOUND, defaultBaselinePath, gateOf, readBaseline } from '../../text-recall/baseline';
import { readStoredText } from '../../text-recall/library';
import { scoreLibrary } from '../../text-recall/score';
import { knownLines, textManifestSchema } from '../../text-recall/words';

export const runTextRecallSchema = z.object({
  found: z.int().nonnegative().nullable(),
  total: z.int().nonnegative(),
  /** `<file>:<word>` not read. */
  missed: z.array(z.string()),
  /** Baseline words lost; null without a baseline. */
  lost: z.array(z.string()).nullable(),
  /** Why the eval refused the library; null when it scored it. */
  refused: z.array(z.string()).nullable(),
  pass: z.boolean(),
});
export type RunTextRecall = z.output<typeof runTextRecallSchema>;

/**
 * The run's recall, or null when its footage lists no on-screen lines. A run that kept no library is a refusal (a
 * failed run), never left out of the count (IX3-F5, M7).
 */
export function runTextRecall(libraryPath: string, footageDir: string): RunTextRecall | null {
  const manifestPath = join(footageDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = parseNamed(textManifestSchema, readJson(manifestPath), manifestPath);
  const lines = knownLines(manifest);
  if (lines.length === 0) return null;
  const total = lines.reduce((sum, line) => sum + line.words.length, 0);
  if (!existsSync(libraryPath)) {
    const refused = [`the run kept no library (${libraryPath})`];
    return { found: null, total, missed: [], lost: null, refused, pass: false };
  }
  const read = readStoredText(libraryPath, [...new Set(lines.map((line) => line.file))]);
  if (read.kind === 'refused')
    return { found: null, total, missed: [], lost: null, refused: [...read.reasons], pass: false };
  const baselinePath = manifest.set === undefined ? null : defaultBaselinePath(manifest.set);
  const baseline = baselinePath !== null && existsSync(baselinePath) ? readBaseline(baselinePath) : null;
  const score = scoreLibrary(read.text, lines);
  const gate = gateOf(score, baseline, baseline?.minFound ?? DEFAULT_MIN_FOUND);
  return {
    found: score.found,
    total,
    missed: [...score.missed],
    lost: baseline === null ? null : [...gate.lost],
    refused: null,
    pass: gate.pass,
  };
}

/** summary.md's line over the runs. */
export function textRecallLine(runs: readonly (RunTextRecall | null | undefined)[]): string {
  const scored = runs.filter((run): run is RunTextRecall => run !== null && run !== undefined);
  if (scored.length === 0) return 'On-screen text recall: not scored (no on-screen lines in this footage).';
  const passed = scored.filter((run) => run.pass).length;
  const counts = scored.map((run) => (run.found === null ? 'refused' : `${run.found}/${run.total}`));
  const lost = [...new Set(scored.flatMap((run) => run.lost ?? []))];
  const refused = [...new Set(scored.flatMap((run) => run.refused ?? []))];
  return (
    `On-screen text recall (rule and baseline of eval:text-recall): ${counts.join(', ')} words read; gate passed in ` +
    `${passed} of ${scored.length} runs` +
    `${lost.length === 0 ? '' : `; **lost ${lost.join(' ')}**`}` +
    `${refused.length === 0 ? '' : `; **refused: ${refused.slice(0, 3).join('; ')}**`}.`
  );
}
