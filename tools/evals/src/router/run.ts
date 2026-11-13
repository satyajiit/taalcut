// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson } from '../files';
import { writeReport } from '../report';
import {
  agreementMeets,
  liveFamiliesOf,
  ROUTER_BARS,
  scoreRouterCase,
  tokenDropMeets,
  tokenDropOf,
  type RouterCaseScore,
} from './metric';
import { renderRouterMarkdown, type RouterEvalReport } from './report';
import {
  loadRouterLabel,
  loadRouterPredictions,
  type RouterFamilyCount,
  type RouterLabel,
  type RouterPrediction,
} from './schema';

function poolFamilies(cases: readonly RouterCaseScore[]): RouterFamilyCount[] {
  const byName = new Map<string, { n: number; matches: number }>();
  for (const row of cases) {
    for (const family of row.families) {
      const current = byName.get(family.family) ?? { n: 0, matches: 0 };
      byName.set(family.family, { n: current.n + family.n, matches: current.matches + family.matches });
    }
  }
  return [...byName.entries()]
    .map(([family, counts]) => ({ family, n: counts.n, matches: counts.matches }))
    .sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));
}

export function scoreRouter(
  labels: readonly RouterLabel[],
  predictions: ReadonlyMap<string, RouterPrediction>,
): RouterEvalReport {
  const cases = labels.map((label) => {
    const prediction = predictions.get(label.caseId);
    if (prediction === undefined) throw new Error(`No prediction for ${label.caseId}`);
    return scoreRouterCase(prediction);
  });
  const n = cases.reduce((total, row) => total + row.n, 0);
  const matches = cases.reduce((total, row) => total + row.matches, 0);
  const full = cases.reduce((total, row) => total + row.full, 0);
  const routed = cases.reduce((total, row) => total + row.routed, 0);
  const measured = cases.length > 0 && cases.every((row) => row.tokensMeasured);
  const equalSuccess = cases.length > 0 && cases.every((row) => row.equalSuccess === 1) ? 1 : 0;
  const agreement = n === 0 ? 0 : matches / n;
  const tokenDrop = measured ? tokenDropOf(full, routed) : 0;
  const families = poolFamilies(cases);
  const synthetic = labels.some((label) => label.synthetic);
  const enough = n >= ROUTER_BARS.minTasks;
  const pass =
    enough && agreementMeets(matches, n) && measured && tokenDropMeets(full, routed) && equalSuccess === 1;
  const claimed = !synthetic && enough;
  const liveFamilies = liveFamiliesOf(families, pass);
  const detail = [
    `agreement ${agreement.toFixed(3)} (need >= ${ROUTER_BARS.agreement})`,
    `tokenDrop ${tokenDrop.toFixed(3)} (need >= ${ROUTER_BARS.tokenDrop})`,
    `equalSuccess ${equalSuccess} (need 1)`,
    `n ${n} (need >= ${ROUTER_BARS.minTasks})`,
  ].join('; ');
  const metrics: RouterEvalReport['metrics'] = [
    { name: 'agreement', value: agreement, better: 'higher' },
    { name: 'tokenDrop', value: tokenDrop, better: 'higher' },
    { name: 'equalSuccess', value: equalSuccess, better: 'higher' },
    ...families.map((family) => ({
      name: `agreement.${family.family}`,
      value: family.n === 0 ? 0 : family.matches / family.n,
      better: 'higher' as const,
    })),
  ];
  return {
    suite: 'router',
    synthetic,
    claimed,
    gate: { id: 'P3-B11', pass, detail },
    metrics,
    cases,
    liveFamilies,
  };
}

export function scoreRouterDirs(labelsDir: string, predictionsDir: string): RouterEvalReport {
  return scoreRouter([loadRouterLabel(labelsDir)], loadRouterPredictions(predictionsDir));
}

export function writeRouterPredictions(predictions: readonly RouterPrediction[], outDir: string): void {
  writeJson(join(outDir, 'predictions.json'), predictions);
}

export function writeRouterReport(report: RouterEvalReport, markdownPath: string): void {
  writeReport(markdownPath, renderRouterMarkdown(report), report);
}
