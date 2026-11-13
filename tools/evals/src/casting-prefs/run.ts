// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The casting-preferences eval (LRN1-PREF): every persona in every seeded world through the app's casting and
 * learning (simulate.ts), scored (score.ts) and pooled into one synthetic report (report.ts). The first persona of
 * the first seed runs twice, to show a whole run is deterministic, not only the learner.
 */
import { sameCastingWeights, type CastingWeights } from '@taalcut/core';
import { CASTING_CONFIG, LEARNER_CONFIG } from '@taalcut/timeline';
import { PERSONA, PERSONAS, type Persona } from './creator';
import type { CastingPrefsReport, ExamScores, PersonaReport } from './report';
import {
  directions,
  distance,
  insideBounds,
  pairwise,
  pool,
  reachable,
  recordedSwaps,
  topOne,
  type Accuracy,
  type ExamSlot,
} from './score';
import { runPersona, SIMULATION_DEFAULTS, type PersonaRun, type SimulationOptions } from './simulate';
import { createPrefWorld } from './world';

export interface CastingPrefsOptions extends SimulationOptions {
  readonly seeds: readonly number[];
  readonly personas?: readonly Persona[];
}

export const CASTING_PREFS_DEFAULTS: CastingPrefsOptions = { ...SIMULATION_DEFAULTS, seeds: [42, 7, 1234] };
/** How far (L1) a creator who casts like casting.v1 may move the weights: noise, not a preference. */
export const STAYS_PUT_LIMIT = 0.06;
const NULL_PERSONA = PERSONA.likeCastingV1.name;

const DEFAULTS = CASTING_CONFIG.weights;

/** Weights and the exam they sit: one persona's, or each run's in a pool. */
interface Sitting {
  readonly weights: CastingWeights;
  readonly exam: readonly ExamSlot[];
}

/** Each sitting scored with its own weights on its own exam, the counts summed (one sitting: its own scores). */
function scores(sittings: readonly Sitting[]): ExamScores {
  const summed = (score: (weights: CastingWeights, exam: readonly ExamSlot[]) => Accuracy) =>
    pool(sittings.map(({ weights, exam }) => score(weights, exam)));
  return { topOne: summed(topOne), pairwise: summed(pairwise), recordedSwaps: summed(recordedSwaps) };
}

function personaReport(seed: number, run: PersonaRun): PersonaReport {
  const { persona } = run;
  const target = reachable(persona.hidden, DEFAULTS);
  return {
    seed,
    persona: persona.name,
    hidden: persona.hidden,
    reachable: target,
    learned: run.learned,
    rounds: run.rounds.map(({ round, slots, swaps, drops, castWith, outcome, pairs }) => ({
      round,
      slots,
      swaps,
      drops,
      castWith,
      outcome,
      pairs,
    })),
    distance: { defaults: distance(DEFAULTS, target), learned: distance(run.learned, target) },
    directions: directions(run.learned, persona.hidden, DEFAULTS),
    examSlots: run.exam.length,
    exam: {
      defaults: scores([{ weights: DEFAULTS, exam: run.exam }]),
      learned: scores([{ weights: run.learned, exam: run.exam }]),
      hidden: scores([{ weights: persona.hidden, exam: run.exam }]),
    },
    writes: run.writes.length,
    writesInsideBounds: run.writes.every((weights) => insideBounds(weights, DEFAULTS)),
    sameLogSameWeights: sameCastingWeights(run.relearned, run.learned),
    refused: run.refused,
  };
}

export async function runCastingPrefs(
  options: CastingPrefsOptions = CASTING_PREFS_DEFAULTS,
): Promise<CastingPrefsReport> {
  const personas = options.personas ?? PERSONAS;
  const runs: { seed: number; run: PersonaRun }[] = [];
  for (const seed of options.seeds) {
    const world = createPrefWorld(seed);
    for (const [index, persona] of personas.entries())
      runs.push({ seed, run: await runPersona(world, persona, index, options) });
  }
  const first = runs[0];
  const again = first ? await runPersona(createPrefWorld(first.seed), first.run.persona, 0, options) : null;
  const reports = runs.map(({ seed, run }) => personaReport(seed, run));
  const pooled = (pick: (run: PersonaRun) => CastingWeights) =>
    scores(runs.map(({ run }) => ({ weights: pick(run), exam: run.exam })));
  const defaults = pooled(() => DEFAULTS);
  const learned = pooled((run) => run.learned);
  const nulls = reports.filter((report) => report.persona === NULL_PERSONA);
  const worst = Math.max(0, ...nulls.map((report) => distance(report.learned, DEFAULTS)));
  return {
    suite: 'casting-prefs',
    synthetic: true,
    claimed: false,
    metrics: [
      { name: 'pairwiseLearned', value: learned.pairwise.rate, better: 'higher' },
      { name: 'pairwiseDefaults', value: defaults.pairwise.rate, better: 'higher' },
      { name: 'topOneLearned', value: learned.topOne.rate, better: 'higher' },
      { name: 'topOneDefaults', value: defaults.topOne.rate, better: 'higher' },
    ],
    options: {
      seeds: options.seeds,
      rounds: options.rounds,
      videosPerRound: options.videosPerRound,
      examTemplates: options.examTemplates,
    },
    learner: {
      version: LEARNER_CONFIG.version,
      prior: LEARNER_CONFIG.prior,
      minEvidence: LEARNER_CONFIG.minEvidence,
    },
    personas: reports,
    pooled: {
      slots: runs.reduce((sum, { run }) => sum + run.exam.length, 0),
      defaults,
      learned,
      hidden: pooled((run) => run.persona.hidden),
    },
    checks: {
      pairwiseBeatsDefaults: learned.pairwise.rate > defaults.pairwise.rate,
      topOneNoWorse: learned.topOne.rate >= defaults.topOne.rate,
      movesTowardHidden: reports
        .filter((report) => report.persona !== NULL_PERSONA)
        .every((report) => report.distance.learned < report.distance.defaults),
      insideBounds: reports.every((report) => report.writesInsideBounds),
      sameLogSameWeights: reports.every((report) => report.sameLogSameWeights),
      rerunIdentical:
        first !== undefined &&
        again !== null &&
        JSON.stringify(again.writes) === JSON.stringify(first.run.writes) &&
        JSON.stringify(again.rounds) === JSON.stringify(first.run.rounds),
      staysPut: { limit: STAYS_PUT_LIMIT, worst, pass: worst <= STAYS_PUT_LIMIT },
    },
  };
}
