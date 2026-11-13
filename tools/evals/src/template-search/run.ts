// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Template search: predict a ranking per query, score them, and write the report (markdown and report.json). */
import { join } from 'node:path';
import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import { writeJson } from '../files';
import { writeReport } from '../report';
import { scoreTemplateSearch, type TemplateSearchScores } from './metric';
import {
  loadTemplateQueries,
  loadTemplateSearchPredictions,
  type TemplateQuery,
  type TemplateSearchPrediction,
} from './schema';
import type { TemplateSearchSystem } from './system';

export interface TemplateSearchReport extends SuiteEnvelope {
  readonly suite: 'template-search';
  readonly scores: TemplateSearchScores;
  /** The fusions and spaces the predictions were made with (one each, normally). */
  readonly fusions: readonly string[];
  readonly spaces: readonly string[];
  /** Queries answered from words alone (no embedding space). */
  readonly degraded: number;
}

export function scoreTemplateSearchRun(
  queries: readonly TemplateQuery[],
  predictions: ReadonlyMap<string, TemplateSearchPrediction>,
): TemplateSearchReport {
  const scores = scoreTemplateSearch(queries, predictions);
  const overall = scores.rows[0];
  const all = [...predictions.values()];
  return {
    suite: 'template-search',
    synthetic: queries.some((query) => query.synthetic),
    // No bar yet: the plan asks for hit@5 to be reported, not passed.
    claimed: false,
    metrics: [
      { name: 'hitAt5', value: overall?.hitAt5 ?? 0, better: 'higher' },
      { name: 'meanReciprocalRank', value: overall?.meanReciprocalRank ?? 0, better: 'higher' },
      { name: 'ndcgAt5', value: overall?.ndcgAt5 ?? 0, better: 'higher' },
    ],
    scores,
    fusions: [...new Set(all.map((prediction) => prediction.fusion))],
    spaces: [...new Set(all.map((prediction) => prediction.space))],
    degraded: scores.queries.filter((query) => query.degraded).length,
  };
}

export const scoreTemplateSearchDirs = (labelsDir: string, predictionsDir: string): TemplateSearchReport =>
  scoreTemplateSearchRun(loadTemplateQueries(labelsDir), loadTemplateSearchPredictions(predictionsDir));

export async function predictTemplateSearch(
  system: TemplateSearchSystem,
  queries: readonly TemplateQuery[],
  outDir: string,
): Promise<TemplateSearchPrediction[]> {
  const written: TemplateSearchPrediction[] = [];
  for (const query of queries) written.push(await system.search(query));
  writeJson(join(outDir, 'predictions.json'), written);
  return written;
}

const fixed = (value: number) => value.toFixed(3);

export function renderTemplateSearchMarkdown(report: TemplateSearchReport): string {
  return [
    '# Template search',
    '',
    envelopeBlock(report),
    '',
    `Fusion: ${report.fusions.join(', ') || 'none'}. Embedding space: ${report.spaces.join(', ') || 'none'}. ` +
      `Answered by words alone: ${report.degraded} of ${report.scores.queries.length}.` +
      (report.scores.missing.length > 0 ? ` Without a prediction: ${report.scores.missing.length}.` : ''),
    '',
    '| queries | n | hit@5 | MRR | nDCG@5 |',
    '| --- | --- | --- | --- | --- |',
    ...report.scores.rows.map(
      (row) =>
        `| ${row.kind} | ${row.queries} | ${fixed(row.hitAt5)} | ${fixed(row.meanReciprocalRank)} | ${fixed(row.ndcgAt5)} |`,
    ),
    '',
  ].join('\n');
}

export function writeTemplateSearchReport(report: TemplateSearchReport, markdownPath: string): void {
  writeReport(markdownPath, renderTemplateSearchMarkdown(report), report);
}
