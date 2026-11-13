// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import type { RouterCaseScore } from './metric';

export interface RouterEvalReport {
  suite: 'router';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: 'P3-B11'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  cases: RouterCaseScore[];
  liveFamilies: readonly string[];
}

export function renderRouterMarkdown(report: RouterEvalReport): string {
  const lines = ['# Router shadow eval', '', envelopeBlock(report), ''];
  lines.push(
    '| case | n | agreement | tokenDrop | equalSuccess | live |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const row of report.cases) {
    const live = row.liveFamilies.length === 0 ? '' : row.liveFamilies.join(', ');
    lines.push(
      `| ${row.caseId} | ${row.n} | ${row.agreement.toFixed(3)} | ${row.tokenDrop.toFixed(3)} | ${row.equalSuccess} | ${live} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
