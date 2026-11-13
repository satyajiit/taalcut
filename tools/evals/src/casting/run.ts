// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { type CastingSystem, type CastingWeights } from '../adapters/types';
import { writeJson } from '../files';
import { writeReport } from '../report';
import { CAST_ACCEPT_BAR, castingGatePasses, scoreCastingCases } from './metric';
import { renderCastingMarkdown, type CastingReport } from './report';
import { loadCastingCases, loadCastingPredictions, type CastingCase, type CastingPrediction } from './schema';

export function scoreCasting(
  cases: readonly CastingCase[],
  predictions: ReadonlyMap<string, CastingPrediction>,
): CastingReport {
  const scores = scoreCastingCases(cases, predictions);
  const pass = castingGatePasses(scores);
  const synthetic = cases.some((item) => item.synthetic);
  const detail = `slots never swapped ${scores.pickAcceptance.toFixed(3)}; sequences never reordered ${scores.orderAcceptance.toFixed(3)} (need ${CAST_ACCEPT_BAR})`;
  return {
    suite: 'casting',
    synthetic,
    claimed: !synthetic,
    gate: { id: '2', pass, detail },
    metrics: [
      { name: 'pickAcceptance', value: scores.pickAcceptance, better: 'higher' },
      { name: 'orderAcceptance', value: scores.orderAcceptance, better: 'higher' },
      { name: 'alternatesAcceptance', value: scores.alternatesAcceptance, better: 'higher' },
      { name: 'variantDiversity', value: scores.variantDiversity, better: 'higher' },
    ],
    scores,
  };
}

export function scoreCastingDirs(labelsDir: string, predictionsDir: string): CastingReport {
  return scoreCasting(loadCastingCases(labelsDir), loadCastingPredictions(predictionsDir));
}

export async function predictCasting(
  system: CastingSystem,
  cases: readonly CastingCase[],
  weights: CastingWeights,
  outDir: string,
): Promise<CastingPrediction[]> {
  const written: CastingPrediction[] = [];
  for (const item of cases) {
    const variants = await system.cast({
      caseId: item.caseId,
      library: item.library,
      template: item.template,
      slotCount: item.slots.length,
      weights,
      seed: 1,
    });
    const prediction: CastingPrediction = { caseId: item.caseId, variants };
    writeJson(join(outDir, item.library, `${item.caseId}.json`), prediction);
    written.push(prediction);
  }
  return written;
}

export function writeCastingReport(report: CastingReport, markdownPath: string): void {
  writeReport(markdownPath, renderCastingMarkdown(report), report);
}
