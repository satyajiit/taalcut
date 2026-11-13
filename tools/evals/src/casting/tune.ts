// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type CastingSystem, type CastingWeights } from '../adapters/types';
import { shotsMatch } from '../shot-match';
import { type CastingCase, type CastingWeightsFile } from './schema';

/** One coordinate pass. A step is kept only when train pick acceptance strictly rises. */
export const TUNE_STEP = 0.05;

const KEYS = ['intent', 'motion', 'quality', 'subject', 'energy'] as const;
type WeightKey = (typeof KEYS)[number];

export interface TuneResult {
  weights: CastingWeightsFile;
  trainLibraries: [string, string];
  holdoutLibrary: string;
  trainPickAcceptance: number;
  holdoutPickAcceptance: number;
}

function clamp(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

async function pickAcceptance(
  system: CastingSystem,
  cases: readonly CastingCase[],
  weights: CastingWeights,
): Promise<number> {
  let slots = 0;
  let accepted = 0;
  for (const item of cases) {
    const variants = await system.cast({
      caseId: item.caseId,
      library: item.library,
      template: item.template,
      slotCount: item.slots.length,
      weights,
      seed: 1,
    });
    const picks = variants[0]?.picks ?? [];
    for (const slot of item.slots) {
      slots += 1;
      const pick = picks.find((candidate) => candidate.slotIndex === slot.slotIndex);
      if (pick !== undefined && slot.acceptable.some((shot) => shotsMatch(shot, pick))) accepted += 1;
    }
  }
  return slots === 0 ? 0 : accepted / slots;
}

function withKey(weights: CastingWeightsFile, key: WeightKey, value: number): CastingWeightsFile {
  return { ...weights, [key]: value };
}

/**
 * Train on the first two library ids in sorted order. The third is the holdout
 * and is scored only after the sweep. This never edits source.
 */
export async function tuneCasting(
  cases: readonly CastingCase[],
  system: CastingSystem,
  start: CastingWeightsFile,
): Promise<TuneResult> {
  const libraries = [...new Set(cases.map((item) => item.library))].sort();
  const first = libraries[0];
  const second = libraries[1];
  const third = libraries[2];
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('tune:casting needs three libraries');
  }
  const train = cases.filter((item) => item.library === first || item.library === second);
  const holdout = cases.filter((item) => item.library === third);
  let weights = { ...start };
  let best = await pickAcceptance(system, train, weights);
  for (const key of KEYS) {
    let chosen = weights;
    let chosenScore = best;
    for (const delta of [-TUNE_STEP, TUNE_STEP]) {
      const value = clamp(weights[key] + delta);
      if (value === weights[key]) continue;
      const candidate = withKey(weights, key, value);
      const score = await pickAcceptance(system, train, candidate);
      if (score > chosenScore) {
        chosen = candidate;
        chosenScore = score;
      }
    }
    weights = chosen;
    best = chosenScore;
  }
  return {
    weights,
    trainLibraries: [first, second],
    holdoutLibrary: third,
    trainPickAcceptance: best,
    holdoutPickAcceptance: await pickAcceptance(system, holdout, weights),
  };
}
