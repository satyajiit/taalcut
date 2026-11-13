// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import type { VoiceCaseScore } from './metric';

export interface VoiceReport {
  suite: 'voice';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: 'P3-B6'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  cases: VoiceCaseScore[];
}

export function renderVoiceMarkdown(report: VoiceReport): string {
  const lines = ['# Voice placement eval', '', envelopeBlock(report), ''];
  lines.push('| case | lines | onBeat | overlaps | outside |', '| --- | --- | --- | --- | --- |');
  for (const row of report.cases) {
    lines.push(
      `| ${row.caseId} | ${row.lines} | ${row.onBeatShare.toFixed(3)} | ${row.overlaps} | ${row.outside} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
