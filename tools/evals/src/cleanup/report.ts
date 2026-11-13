// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import type { CleanupCaseScore } from './metric';

export interface CleanupReport {
  suite: 'cleanup';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: 'P3-V9'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  cases: CleanupCaseScore[];
}

export function renderCleanupMarkdown(report: CleanupReport): string {
  const lines = ['# Cleanup eval', '', envelopeBlock(report), ''];
  lines.push('| case | removedShare | clippedWords | falseRemovals |', '| --- | --- | --- | --- |');
  for (const row of report.cases) {
    lines.push(
      `| ${row.caseId} | ${row.removedShare.toFixed(3)} | ${row.clippedWords} | ${row.falseRemovals} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
