// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The golden set with learned weights (LRN1-PREF eval): P2-Q2 casting acceptance and tune:casting, each with
 * casting.v1's weights and with every simulated creator's learned weights, through the casting eval's real adapter
 * (@taalcut/timeline's engine over the labelled library's profiles). Learned weights must be no worse than the
 * defaults where the gate looks: pick and order acceptance, and tune's holdout pick acceptance started from them.
 *
 * The labelled set is the synthetic lavfi library today (one library, one four-slot case). tune:casting trains on two
 * libraries and holds out a third, so here the one library is read under three names: its holdout is not independent
 * of its training, and the report says so. Synthetic: never a gate result.
 */
import type { CastingWeights } from '@taalcut/core';
import { timelineCastingSystem } from '../adapters/casting';
import type { CastingSystem } from '../adapters/types';
import type { FfmpegBinaries } from '@taalcut/media';
import type { SuiteEnvelope } from '../envelope';
import { loadCastingLibrary } from '../casting/library';
import { scoreCasting } from '../casting/run';
import type { CastingCase, CastingPrediction } from '../casting/schema';
import { tuneCasting } from '../casting/tune';

export interface GoldenWeights {
  readonly name: string;
  readonly weights: CastingWeights;
}

export interface GoldenRow extends GoldenWeights {
  readonly pickAcceptance: number;
  readonly orderAcceptance: number;
  readonly alternatesAcceptance: number;
  readonly variantDiversity: number;
  readonly tune: { readonly trainPickAcceptance: number; readonly holdoutPickAcceptance: number };
  /** Pick, order and tune holdout acceptance each at least the defaults'. */
  readonly noWorse: boolean;
}

export interface GoldenReport extends SuiteEnvelope {
  readonly suite: 'casting-prefs-golden';
  readonly cases: number;
  readonly libraries: readonly string[];
  readonly rows: readonly GoldenRow[];
  readonly noWorse: boolean;
}

export interface GoldenInput {
  readonly cases: readonly CastingCase[];
  /** Library name (its manifest's) → its folder. */
  readonly libraries: Readonly<Record<string, string>>;
  readonly binaries: FfmpegBinaries;
  /** The first is the baseline (casting.v1's weights). */
  readonly weights: readonly GoldenWeights[];
}

const TUNE_NAMES = ['a', 'b', 'c'] as const;

async function acceptance(system: CastingSystem, cases: readonly CastingCase[], weights: GoldenWeights) {
  const predictions = new Map<string, CastingPrediction>();
  for (const item of cases) {
    const variants = await system.cast({
      caseId: item.caseId,
      library: item.library,
      template: item.template,
      slotCount: item.slots.length,
      weights: { version: weights.name, ...weights.weights },
      seed: 1,
    });
    predictions.set(item.caseId, { caseId: item.caseId, variants });
  }
  return scoreCasting(cases, predictions).scores;
}

export async function runGolden(input: GoldenInput): Promise<GoldenReport> {
  const profiled = await Promise.all(
    Object.values(input.libraries).map((dir) => loadCastingLibrary(dir, input.binaries)),
  );
  // tune:casting's three libraries: each labelled library again under three names, profiled once.
  const renamed = profiled.flatMap((library) =>
    TUNE_NAMES.map((suffix) => ({ ...library, name: `${library.name}-${suffix}` })),
  );
  const system = timelineCastingSystem({
    libraries: {},
    binaries: input.binaries,
    profiled: [...profiled, ...renamed],
  });
  const tuneCases = input.cases.flatMap((item) =>
    TUNE_NAMES.map((suffix) => ({
      ...item,
      caseId: `${item.caseId}-${suffix}`,
      library: `${item.library}-${suffix}`,
    })),
  );
  const rows: GoldenRow[] = [];
  for (const weights of input.weights) {
    const scores = await acceptance(system, input.cases, weights);
    const tuned = await tuneCasting(tuneCases, system, { version: weights.name, ...weights.weights });
    const baseline = rows[0];
    const row = {
      ...weights,
      pickAcceptance: scores.pickAcceptance,
      orderAcceptance: scores.orderAcceptance,
      alternatesAcceptance: scores.alternatesAcceptance,
      variantDiversity: scores.variantDiversity,
      tune: {
        trainPickAcceptance: tuned.trainPickAcceptance,
        holdoutPickAcceptance: tuned.holdoutPickAcceptance,
      },
    };
    rows.push({
      ...row,
      noWorse:
        !baseline ||
        (row.pickAcceptance >= baseline.pickAcceptance &&
          row.orderAcceptance >= baseline.orderAcceptance &&
          row.tune.holdoutPickAcceptance >= baseline.tune.holdoutPickAcceptance),
    });
  }
  const synthetic = input.cases.some((item) => item.synthetic);
  return {
    suite: 'casting-prefs-golden',
    synthetic,
    claimed: false,
    metrics: rows.map((row) => ({
      name: `pickAcceptance:${row.name}`,
      value: row.pickAcceptance,
      better: 'higher',
    })),
    cases: input.cases.length,
    libraries: profiled.map((library) => library.name),
    rows,
    noWorse: rows.every((row) => row.noWorse),
  };
}

export function renderGoldenMarkdown(report: GoldenReport): string {
  const lines = [
    '# Learned casting preferences on the golden set (LRN1-PREF)',
    '',
    report.synthetic
      ? 'Synthetic: yes. These numbers are not a gate result.'
      : 'Synthetic: no. Not claimed: no gate.',
    '',
    `${report.cases} labelled case(s) in ${report.libraries.join(', ')}. tune:casting reads each library under three names (it trains on two and holds out the third), so its holdout is not independent here.`,
    '',
    '| weights | pick acceptance | order acceptance | alternates acceptance | variant diversity | tune train → holdout | no worse than casting.v1 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.rows.map(
      (row) =>
        `| ${row.name} | ${row.pickAcceptance.toFixed(3)} | ${row.orderAcceptance.toFixed(3)} | ${row.alternatesAcceptance.toFixed(3)} | ${row.variantDiversity.toFixed(3)} | ${row.tune.trainPickAcceptance.toFixed(3)} → ${row.tune.holdoutPickAcceptance.toFixed(3)} | ${row.noWorse ? 'yes' : '**no**'} |`,
    ),
    '',
    `Every learned set no worse than casting.v1: ${report.noWorse ? 'yes' : '**no**'}.`,
    '',
  ];
  return lines.join('\n');
}
