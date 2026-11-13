// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The casting-preferences report (LRN1-PREF eval): every simulated creator's rounds, where the weights went, the exam
 * against the defaults and the creator's own weights, and the learner's promises (bounds, the same log giving the
 * same weights, a creator like casting.v1 leaving them be). Synthetic: never a gate result.
 */
import type { CastingWeights } from '@taalcut/core';
import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import type { Accuracy } from './score';

export interface ExamScores {
  readonly topOne: Accuracy;
  readonly pairwise: Accuracy;
  readonly recordedSwaps: Accuracy;
}

export interface PersonaReport {
  readonly seed: number;
  readonly persona: string;
  readonly hidden: CastingWeights;
  /** The hidden weights brought inside the bounds: as near as the learner may get. */
  readonly reachable: CastingWeights;
  readonly learned: CastingWeights;
  readonly rounds: readonly {
    readonly round: number;
    readonly slots: number;
    readonly swaps: number;
    readonly drops: number;
    readonly castWith: string;
    readonly outcome: string;
    readonly pairs: number;
  }[];
  /** L1 distance to `reachable`, from the defaults and from the learned weights. */
  readonly distance: { readonly defaults: number; readonly learned: number };
  readonly directions: readonly {
    readonly part: string;
    readonly wanted: string;
    readonly moved: number;
    readonly agrees: boolean;
  }[];
  readonly examSlots: number;
  readonly exam: { readonly defaults: ExamScores; readonly learned: ExamScores; readonly hidden: ExamScores };
  readonly writes: number;
  readonly writesInsideBounds: boolean;
  readonly sameLogSameWeights: boolean;
  readonly refused: readonly string[];
}

export interface CastingPrefsChecks {
  /** Pooled over every exam: the creator's shot over the others shown, more often with the learned weights. */
  readonly pairwiseBeatsDefaults: boolean;
  /** Pooled top-1: the learned weights no worse than the defaults. */
  readonly topOneNoWorse: boolean;
  /** Every creator who wants something else: nearer it than the defaults are. */
  readonly movesTowardHidden: boolean;
  /** Every weight every job wrote: inside the bounds, at the total. */
  readonly insideBounds: boolean;
  /** Every run's log, folded and learned again, gives the item's weights. */
  readonly sameLogSameWeights: boolean;
  /** The first creator's whole run again, with the same seed, writes the same weights. */
  readonly rerunIdentical: boolean;
  /** The creator who casts like casting.v1 moves the weights no further than this. */
  readonly staysPut: { readonly limit: number; readonly worst: number; readonly pass: boolean };
}

export interface CastingPrefsReport extends SuiteEnvelope {
  readonly suite: 'casting-prefs';
  readonly options: {
    readonly seeds: readonly number[];
    readonly rounds: number;
    readonly videosPerRound: number;
    readonly examTemplates: number;
  };
  readonly learner: { readonly version: string; readonly prior: number; readonly minEvidence: number };
  readonly personas: readonly PersonaReport[];
  readonly pooled: {
    readonly slots: number;
    readonly defaults: ExamScores;
    readonly learned: ExamScores;
    readonly hidden: ExamScores;
  };
  readonly checks: CastingPrefsChecks;
}

const rate = (accuracy: Accuracy) => {
  const interval = accuracy.interval
    ? ` [${accuracy.interval.low.toFixed(3)}, ${accuracy.interval.high.toFixed(3)}]`
    : '';
  return `${accuracy.rate.toFixed(3)}${interval}`;
};
const weights = (w: CastingWeights) =>
  `${w.intent.toFixed(3)} / ${w.motion.toFixed(3)} / ${w.quality.toFixed(3)} / ${w.subject.toFixed(3)} / ${w.energy.toFixed(3)}`;
const yes = (value: boolean) => (value ? 'yes' : '**no**');

export function renderCastingPrefsMarkdown(report: CastingPrefsReport): string {
  const { pooled, checks, options } = report;
  const lines = [
    '# Learned casting preferences (LRN1-PREF)',
    '',
    envelopeBlock(report),
    '',
    `Seeds ${options.seeds.join(', ')}; per creator ${options.rounds} rounds of ${options.videosPerRound} videos (5 slots each), then an exam of ${options.examTemplates} unseen templates cast with casting.v1. Learner ${report.learner.version} (prior ${report.learner.prior}, minimum evidence ${report.learner.minEvidence}).`,
    '',
    '## Pooled exam',
    '',
    `${pooled.slots} slots. Rates with Wilson 95% intervals.`,
    '',
    '| weights | top-1 | pairwise | recorded swaps |',
    '| --- | --- | --- | --- |',
    ...(['defaults', 'learned', 'hidden'] as const).map(
      (name) =>
        `| ${name} | ${rate(pooled[name].topOne)} | ${rate(pooled[name].pairwise)} | ${rate(pooled[name].recordedSwaps)} |`,
    ),
    '',
    'Recorded swaps are the exam slots where the creator swapped; the defaults made those picks, so they start near 0 by construction. Top-1 and pairwise, over every slot, are the fair comparison.',
    '',
    '## Checks',
    '',
    `- Pairwise: learned beats the defaults: ${yes(checks.pairwiseBeatsDefaults)}`,
    `- Top-1: learned no worse than the defaults: ${yes(checks.topOneNoWorse)}`,
    `- Every creator who wants something else: learned weights nearer it than the defaults: ${yes(checks.movesTowardHidden)}`,
    `- Every weight the job wrote is inside the bounds at the total: ${yes(checks.insideBounds)}`,
    `- The same log gives the same weights: ${yes(checks.sameLogSameWeights)}; a whole run again gives the same: ${yes(checks.rerunIdentical)}`,
    `- A creator like casting.v1 moves the weights at most ${checks.staysPut.limit} (L1): ${yes(checks.staysPut.pass)} (worst ${checks.staysPut.worst})`,
    '',
    '## Creators',
    '',
    '| seed | creator | swaps by round | removals | learned (intent / motion / quality / subject / energy) | distance defaults → learned | exam top-1 defaults → learned (hidden) | pairwise defaults → learned (hidden) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const run of report.personas) {
    const swaps = run.rounds.map((round) => round.swaps).join(' ');
    const drops = run.rounds.reduce((sum, round) => sum + round.drops, 0);
    lines.push(
      `| ${run.seed} | ${run.persona} | ${swaps} | ${drops} | ${weights(run.learned)} | ${run.distance.defaults} → ${run.distance.learned} | ${run.exam.defaults.topOne.rate.toFixed(3)} → ${run.exam.learned.topOne.rate.toFixed(3)} (${run.exam.hidden.topOne.rate.toFixed(3)}) | ${run.exam.defaults.pairwise.rate.toFixed(3)} → ${run.exam.learned.pairwise.rate.toFixed(3)} (${run.exam.hidden.pairwise.rate.toFixed(3)}) |`,
    );
  }
  const refused = report.personas.flatMap((run) =>
    run.refused.map((code) => `${run.seed} ${run.persona}: ${code}`),
  );
  lines.push('', refused.length === 0 ? 'No command was refused.' : `Refused: ${refused.join('; ')}.`, '');
  return lines.join('\n');
}
