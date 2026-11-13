// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';

export interface PickCase {
  caseId: string;
  query: string;
  families: string[];
  hit: boolean;
  audioHit: boolean;
  top: string[];
}

export interface PickReport {
  suite: 'listen-pick';
  synthetic: false;
  claimed: true;
  gate: { id: 'EAR1-B2'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  cases: PickCase[];
}

export function renderPickMarkdown(report: PickReport): string {
  const lines = ['# listen-pick eval (EAR1-B2)', '', envelopeBlock(report), ''];
  lines.push(
    '| case | query | families | top 5 | audio alone | top 5 sounds |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const row of report.cases)
    lines.push(
      `| ${row.caseId} | ${row.query} | ${row.families.join(', ')} | ${row.hit ? 'yes' : 'no'} | ` +
        `${row.audioHit ? 'yes' : 'no'} | ${row.top.join(', ')} |`,
    );
  lines.push('');
  return lines.join('\n');
}
