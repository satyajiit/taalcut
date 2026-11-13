// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import type { VariantCaseScore } from './metric';

export interface VariantsReport {
  suite: 'variants';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: 'P3-V3'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  cases: VariantCaseScore[];
}

export function renderVariantsMarkdown(report: VariantsReport): string {
  const lines = ['# Variants eval', '', envelopeBlock(report), ''];
  lines.push(
    '| case | variants | pairs | hookDiffer | pickDiffer | pickAcceptance |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const row of report.cases) {
    const acceptance = row.pickAcceptance === undefined ? '' : row.pickAcceptance.toFixed(3);
    lines.push(
      `| ${row.caseId} | ${row.variants} | ${row.pairs} | ${row.hookDifferShare.toFixed(3)} | ${row.pickDifferShare.toFixed(3)} | ${acceptance} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
