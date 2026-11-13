// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import type { InterchangeCaseScore } from './metric';

export interface InterchangeReport {
  suite: 'interchange';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: 'P3-V5'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  cases: InterchangeCaseScore[];
}

export function renderInterchangeMarkdown(report: InterchangeReport): string {
  const lines = ['# Interchange eval', '', envelopeBlock(report), ''];
  lines.push('| case | format | maxCutDeltaFrames | external |', '| --- | --- | --- | --- |');
  for (const row of report.cases) {
    for (const format of row.formats) {
      lines.push(
        `| ${row.caseId} | ${format.format} | ${format.maxCutDeltaFrames} | ${format.externalStatus}: ${format.externalDetail} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}
