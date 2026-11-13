// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { type SearchSystem } from '../adapters/types';
import { writeJson } from '../files';
import { writeReport } from '../report';
import { aggregateSearch, scoreQuery, searchGatePasses, SEARCH_HIT_BAR, type QueryScore } from './metric';
import { renderSearchMarkdown, type SearchReport } from './report';
import {
  loadSearchLabels,
  loadSearchPredictions,
  type SearchPrediction,
  type SearchQueryLabel,
} from './schema';

/** Ranked list long enough for reciprocal rank past the top 5. */
export const SEARCH_PREDICT_LIMIT = 20;

export function scoreSearch(queries: readonly SearchQueryLabel[], predictions: ReadonlyMap<string, SearchPrediction>): SearchReport {
  const rows: QueryScore[] = queries.map((query) => {
    const prediction = predictions.get(query.queryId);
    if (prediction === undefined) throw new Error(`No prediction for ${query.queryId}`);
    return scoreQuery(query, prediction);
  });
  const languages = aggregateSearch(rows);
  const overall = languages[0];
  const pass = searchGatePasses(languages);
  const synthetic = queries.some((query) => query.synthetic);
  const detail = `hit@5 ${overall?.hitAt5.toFixed(3) ?? '0'} overall (need ${SEARCH_HIT_BAR}); precision@5 ${overall?.precisionAt5.toFixed(3) ?? '0'}`;
  return {
    suite: 'search',
    synthetic,
    claimed: !synthetic,
    gate: { id: '11', pass, detail },
    metrics: [
      { name: 'hitAt5', value: overall?.hitAt5 ?? 0, better: 'higher' },
      { name: 'precisionAt5', value: overall?.precisionAt5 ?? 0, better: 'higher' },
      { name: 'reciprocalRank', value: overall?.reciprocalRank ?? 0, better: 'higher' },
      { name: 'ndcgAt5', value: overall?.ndcgAt5 ?? 0, better: 'higher' },
    ],
    languages,
    queries: rows,
  };
}

export function scoreSearchDirs(labelsDir: string, predictionsDir: string): SearchReport {
  return scoreSearch(loadSearchLabels(labelsDir), loadSearchPredictions(predictionsDir));
}

export async function predictSearch(
  system: SearchSystem,
  labelsDir: string,
  outDir: string,
): Promise<SearchPrediction[]> {
  const queries = loadSearchLabels(labelsDir);
  const written: SearchPrediction[] = [];
  for (const query of queries) {
    const results = await system.search(query, SEARCH_PREDICT_LIMIT);
    for (const shot of results) {
      if (shot.range === undefined) throw new Error(`Search result for ${query.queryId} (${shot.asset}) is missing a frame range`);
    }
    const prediction: SearchPrediction = {
      queryId: query.queryId,
      results: results.map((shot) => ({
        asset: shot.asset,
        range: shot.range ?? { startFrame: 0, endFrame: 1 },
      })),
    };
    writeJson(join(outDir, `${query.queryId}.json`), prediction);
    written.push(prediction);
  }
  return written;
}

export function writeSearchReport(report: SearchReport, markdownPath: string): void {
  writeReport(markdownPath, renderSearchMarkdown(report), report);
}
