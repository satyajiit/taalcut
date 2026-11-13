// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { envelopeBlock, type SuiteEnvelope } from '../envelope';
import { CAST_ACCEPT_BAR, type CastingScores } from './metric';

export interface CastingReport {
  suite: 'casting';
  synthetic: boolean;
  claimed: boolean;
  gate: { id: '2'; pass: boolean; detail: string };
  metrics: SuiteEnvelope['metrics'];
  scores: CastingScores;
}

function fixed(value: number): string {
  return value.toFixed(3);
}

export function renderCastingMarkdown(report: CastingReport): string {
  const { scores } = report;
  const lines = [
    '# Casting acceptance',
    '',
    envelopeBlock(report),
    '',
    `Share of slots never swapped: ${fixed(scores.pickAcceptance)} (need ${CAST_ACCEPT_BAR}).`,
    `Share of sequences never reordered: ${fixed(scores.orderAcceptance)} (need ${CAST_ACCEPT_BAR}).`,
    `Alternates acceptance: ${fixed(scores.alternatesAcceptance)}. Variant diversity: ${fixed(scores.variantDiversity)}.`,
    '',
    '| shot type | slots | acceptance |',
    '| --- | --- | --- |',
  ];
  for (const row of scores.shotTypes) {
    lines.push(`| ${row.shotType} | ${row.slots} | ${fixed(row.acceptance)} |`);
  }
  lines.push('');
  return lines.join('\n');
}
