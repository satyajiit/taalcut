// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { formatTarget, type GateCell, type Interval } from '../gate-metric';
import { sliceLabel } from '../slices';
import { type GateReport, type GateRow } from './build';

const SYNTHETIC_NOTE = 'Synthetic: yes. These numbers are not a gate result.';

function cellText(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function intervalText(interval: Interval | null): string {
  if (interval === null) return '';
  return `[${interval.low.toFixed(4)}, ${interval.high.toFixed(4)}]`;
}

function gateRow(row: GateRow): string {
  const cells = row.cells
    .map((cell) => `${cell.label} ${cell.display} (${formatTarget(cell.target)}): ${cell.verdict}`)
    .join('; ');
  return `| ${row.row} | ${row.verdict} | ${cellText(cells)} |`;
}

function row(cell: GateCell): string {
  const n = cell.n === null ? '' : String(cell.n);
  return `| ${cell.row} | ${cellText(cell.label)} | ${cellText(sliceLabel(cell.slice))} | ${cellText(cell.display)} | ${cellText(formatTarget(cell.target))} | ${cell.verdict} | ${n} | ${intervalText(cell.interval)} | ${cellText(cell.detail)} |`;
}

export function renderMarkdown(report: GateReport): string {
  const lines = [
    `# Taalcut ${report.gate} gate`,
    '',
    `Window: ${report.from} to ${report.to} (inclusive, UTC).`,
    '',
    report.synthetic ? SYNTHETIC_NOTE : 'Synthetic: no.',
    '',
    '## Gate rows',
    '',
    'Each row is the worst verdict of its deciding cells (the binding cohort, all languages).',
    '',
    '| Row | Verdict | Deciding cells |',
    '| --- | --- | --- |',
    ...report.rows.map(gateRow),
    '',
    '## Every cell',
    '',
    '| Row | Metric | Slice | Value | Target | Verdict | n | Interval | Detail |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.cells.map(row),
    '',
  ];
  return `${lines.join('\n')}\n`;
}
