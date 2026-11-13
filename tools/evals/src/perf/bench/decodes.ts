// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The decode lane's counters in summary.md (specs/requests-decode-to-bench.md): per run, the median over video
 * files of the original's full decodes (target 2: the analysis pass and the proxy encode) and of FFmpeg plus ffprobe
 * spawns, from the timeline's decode report; here their medians over runs.
 */
import { spreadOf } from './stats';

export interface RunDecodes {
  readonly originalFullDecodes: number | null;
  readonly spawns: number | null;
}

export function decodesLine(runs: readonly (RunDecodes | null)[]): string {
  const full = spreadOf(runs.map((run) => run?.originalFullDecodes));
  const spawns = spreadOf(runs.map((run) => run?.spawns));
  if (full === null && spawns === null)
    return 'Decodes: not reported (stage outputs carry no decode counters).';
  const range = (spread: typeof full) =>
    spread === null
      ? '–'
      : spread.min === spread.max
        ? String(spread.median)
        : `${spread.median} [${spread.min}–${spread.max}]`;
  return (
    `Decodes per video file (medians over runs): ${range(full)} full decodes of the original (target 2), ` +
    `${range(spawns)} FFmpeg and ffprobe spawns.`
  );
}
