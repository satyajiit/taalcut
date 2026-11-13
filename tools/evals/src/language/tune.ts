// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tunes the language decision's floors and prior weight on the dev half of the set (every other clip, both crops
 * of a clip on the same side), and reports the held-out half with what it chose. Synthetic and owner clips never
 * tune. The objective is right minus three times wrong (score.ts), summed over the three after-scenarios.
 */
import { LANGUAGE_DECISION, type LanguageDecisionConfig } from '@taalcut/audio';
import type { EvidenceRow } from './evidence';
import { judgeAll, tallies, utility, type Judged, type Tally } from './score';
import type { LanguageClip } from './sets';

/**
 * The constants tuned. `foreignFloor` only downward from the 0.5 the evidence was gathered with: above it, the job
 * left the identifier out of runs the scorer would need it for.
 */
export const GRID = {
  floor: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8],
  whisperFloor: [0.5, 0.6, 0.7, 0.8, 0.9],
  priorWeight: [1.5, 2, 3],
  foreignFloor: [0.3, 0.4, 0.5],
  englishFloor: [0.7, 0.8, 0.9, 1.01],
} as const;

/** Dev: even clips of the real sets; test: odd ones. */
export function splitOf(clips: readonly LanguageClip[]): Map<string, 'dev' | 'test'> {
  const split = new Map<string, 'dev' | 'test'>();
  clips
    .filter((clip) => !clip.synthetic && clip.set !== 'owner')
    .forEach((clip, i) => split.set(clip.id, i % 2 === 0 ? 'dev' : 'test'));
  return split;
}

const AFTER = ['english', 'own', 'indian'] as const;

export function objective(judged: readonly Judged[], keep: (j: Judged) => boolean): number {
  const t = tallies(judged, keep);
  return AFTER.reduce((sum, scenario) => sum + utility(t[scenario]), 0);
}

export interface Tuned {
  readonly config: LanguageDecisionConfig;
  readonly dev: number;
  readonly test: number;
}

export function tune(rows: readonly EvidenceRow[], clips: readonly LanguageClip[]): Tuned[] {
  const split = splitOf(clips);
  const dev = (j: Judged) => split.get(j.clip.id) === 'dev';
  const test = (j: Judged) => split.get(j.clip.id) === 'test';
  const results: Tuned[] = [];
  for (const floor of GRID.floor)
    for (const whisperFloor of GRID.whisperFloor)
      for (const priorWeight of GRID.priorWeight)
        for (const foreignFloor of GRID.foreignFloor)
          for (const englishFloor of GRID.englishFloor) {
            const config = {
              ...LANGUAGE_DECISION,
              floor,
              whisperFloor,
              priorWeight,
              foreignFloor,
              englishFloor,
            };
            const judged = judgeAll(rows, clips, config);
            results.push({ config, dev: objective(judged, dev), test: objective(judged, test) });
          }
  return results.sort((a, b) => b.dev - a.dev || b.test - a.test);
}

export function rate(tally: Tally, of: keyof Omit<Tally, 'n'>): string {
  return tally.n === 0 ? '–' : `${Math.round((tally[of] / tally.n) * 1000) / 10} %`;
}
