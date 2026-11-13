// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson } from '../files';
import { writeReport } from '../report';
import { scoreVariantCase, variantGatePasses, type VariantCaseScore } from './metric';
import { renderVariantsMarkdown, type VariantsReport } from './report';
import {
  loadVariantLabels,
  loadVariantPredictions,
  type VariantLabel,
  type VariantPrediction,
} from './schema';

function minOf(rows: readonly VariantCaseScore[], pick: (row: VariantCaseScore) => number): number {
  const first = rows[0];
  if (first === undefined) return 0;
  return rows.reduce((min, row) => Math.min(min, pick(row)), pick(first));
}

export function scoreVariants(
  labels: readonly VariantLabel[],
  predictions: ReadonlyMap<string, VariantPrediction>,
): VariantsReport {
  const cases = labels.map((label) => {
    const prediction = predictions.get(label.caseId);
    if (prediction === undefined) throw new Error(`No prediction for ${label.caseId}`);
    return scoreVariantCase(label, prediction);
  });
  const synthetic = labels.some((label) => label.synthetic);
  const hookDifferShare = minOf(cases, (row) => row.hookDifferShare);
  const pickDifferShare = minOf(cases, (row) => row.pickDifferShare);
  const acceptances = cases.flatMap((row) => (row.pickAcceptance === undefined ? [] : [row.pickAcceptance]));
  const pass = variantGatePasses(cases, labels);
  const detail = `hookDifferShare ${hookDifferShare.toFixed(3)}; pickDifferShare ${pickDifferShare.toFixed(3)} (both need 1)`;
  const metrics: VariantsReport['metrics'] = [
    { name: 'hookDifferShare', value: hookDifferShare, better: 'higher' },
    { name: 'pickDifferShare', value: pickDifferShare, better: 'higher' },
  ];
  if (acceptances.length === cases.length && acceptances.length > 0) {
    metrics.push({
      name: 'pickAcceptance',
      value: Math.min(...acceptances),
      better: 'higher',
    });
  }
  return {
    suite: 'variants',
    synthetic,
    claimed: !synthetic,
    gate: { id: 'P3-V3', pass, detail },
    metrics,
    cases,
  };
}

export function scoreVariantDirs(labelsDir: string, predictionsDir: string): VariantsReport {
  return scoreVariants(loadVariantLabels(labelsDir), loadVariantPredictions(predictionsDir));
}

export function writeVariantPredictions(predictions: readonly VariantPrediction[], outDir: string): void {
  writeJson(join(outDir, 'predictions.json'), predictions);
}

export function writeVariantsReport(report: VariantsReport, markdownPath: string): void {
  writeReport(markdownPath, renderVariantsMarkdown(report), report);
}
