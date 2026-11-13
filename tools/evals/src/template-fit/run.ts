// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Template fit: predict a ranking per footage set, score them, and write the report (markdown and report.json). */
import { join } from 'node:path';
import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import { writeJson } from '../files';
import { writeReport } from '../report';
import {
  ALTERNATIVE_ORDERS,
  FIT_TOP3_BAR,
  fitGatePasses,
  reranked,
  scoreFitCases,
  type FitScores,
} from './metric';
import { loadFitCases, loadFitPredictions, type FitCase, type FitPrediction } from './schema';
import type { FitSystem } from './system';

export interface FitReport extends SuiteEnvelope {
  readonly suite: 'template-fit';
  readonly gate: { id: 'lrn1-tpl-fit'; pass: boolean; detail: string };
  readonly scores: FitScores;
  /** The same predictions in the orders the fitter's is weighed against (metric.ts). */
  readonly alternatives: readonly { order: string; top1: number; top3: number; meanReciprocalRank: number }[];
}

export function scoreFit(
  cases: readonly FitCase[],
  predictions: ReadonlyMap<string, FitPrediction>,
): FitReport {
  const scores = scoreFitCases(cases, predictions);
  const synthetic = cases.some((item) => item.synthetic);
  const detail =
    `right template in the top 3 for ${scores.top3.toFixed(3)} of ${scores.cases.length} sets (need ${FIT_TOP3_BAR}); ` +
    `top 1 ${scores.top1.toFixed(3)}` +
    (scores.missing.length > 0 ? `; ${scores.missing.length} sets without a prediction` : '');
  return {
    suite: 'template-fit',
    synthetic,
    claimed: !synthetic,
    gate: { id: 'lrn1-tpl-fit', pass: fitGatePasses(scores), detail },
    metrics: [
      { name: 'top1', value: scores.top1, better: 'higher' },
      { name: 'top3', value: scores.top3, better: 'higher' },
      { name: 'meanReciprocalRank', value: scores.meanReciprocalRank, better: 'higher' },
    ],
    scores,
    alternatives: Object.entries(ALTERNATIVE_ORDERS).map(([order, compare]) => {
      const { top1, top3, meanReciprocalRank } = scoreFitCases(cases, reranked(predictions, compare));
      return { order, top1, top3, meanReciprocalRank };
    }),
  };
}

export const scoreFitDirs = (labelsDir: string, predictionsDir: string): FitReport =>
  scoreFit(loadFitCases(labelsDir), loadFitPredictions(predictionsDir));

export async function predictFit(
  system: FitSystem,
  cases: readonly FitCase[],
  outDir: string,
): Promise<FitPrediction[]> {
  const written: FitPrediction[] = [];
  for (const item of cases) written.push(await system.fit(item));
  writeJson(join(outDir, 'predictions.json'), written);
  return written;
}

export function renderFitMarkdown(report: FitReport): string {
  const lines = [
    '# Templates that fit the footage',
    '',
    envelopeBlock(report),
    '',
    `Top 1: ${report.scores.top1.toFixed(3)}. Top 3: ${report.scores.top3.toFixed(3)} (need ${FIT_TOP3_BAR}). ` +
      `Mean reciprocal rank: ${report.scores.meanReciprocalRank.toFixed(3)}.`,
    '',
    '| library | set | rank of the right template |',
    '| --- | --- | --- |',
    ...report.scores.cases.map((row) => `| ${row.library} | ${row.caseId} | ${row.rank ?? 'not ranked'} |`),
    '',
    'The same predictions in other orders:',
    '',
    '| order | top 1 | top 3 | MRR |',
    '| --- | --- | --- | --- |',
    ...report.alternatives.map(
      (row) =>
        `| ${row.order} | ${row.top1.toFixed(3)} | ${row.top3.toFixed(3)} | ${row.meanReciprocalRank.toFixed(3)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

export function writeFitReport(report: FitReport, markdownPath: string): void {
  writeReport(markdownPath, renderFitMarkdown(report), report);
}
