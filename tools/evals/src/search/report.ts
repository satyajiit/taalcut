// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import { SEARCH_HIT_BAR, type LanguageScore, type QueryScore } from './metric';

export interface SearchReport {
  suite: 'search';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: '11'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  languages: LanguageScore[];
  queries: QueryScore[];
}

function fixed(value: number): string {
  return value.toFixed(3);
}

export function renderSearchMarkdown(report: SearchReport): string {
  const lines = ['# Search eval', '', envelopeBlock(report), ''];
  lines.push(
    `hit@5 ${fixed(report.languages[0]?.hitAt5 ?? 0)} (need ${SEARCH_HIT_BAR}). precision@5 ${fixed(report.languages[0]?.precisionAt5 ?? 0)} is the share of the top 5 that are relevant (denominator min(5, results)).`,
    '',
    '| language | queries | hit@5 | precision@5 | RR | nDCG@5 |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const row of report.languages) {
    lines.push(
      `| ${row.language} | ${row.queries} | ${fixed(row.hitAt5)} | ${fixed(row.precisionAt5)} | ${fixed(row.reciprocalRank)} | ${fixed(row.ndcgAt5)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
