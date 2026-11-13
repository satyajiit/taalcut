// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The listening suites' reports: one per suite (Markdown and the JSON envelope), and a summary of them all. */
import { join } from 'node:path';
import { writeJson } from '../files';
import { writeReport } from '../report';
import { envelopeOf, type ListenMetric, type ListenOutcome } from './outcome';

export function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  if (Number.isNaN(value)) return 'NaN';
  if (Number.isInteger(value)) return String(value);
  return Math.abs(value) < 1e-3 ? value.toExponential(2) : value.toFixed(4);
}

function metricRow(m: ListenMetric): string {
  const verdict = m.pass === undefined ? (m.bar === undefined ? 'info' : 'no value') : m.pass ? 'yes' : 'no';
  const bar = m.bar === undefined ? '–' : `${m.better === 'higher' ? '≥' : '≤'} ${formatValue(m.bar)}`;
  return `| ${m.part} | ${m.name} | ${formatValue(m.value)} | ${bar} | ${verdict} | ${m.over ?? ''} |`;
}

export function renderOutcome(outcome: ListenOutcome): string {
  const lines = [
    `# ${outcome.suite} (${outcome.features.join(', ')})`,
    '',
    `Status: ${outcome.status}. ${outcome.detail}. ${outcome.seconds.toFixed(1)} s.`,
    '',
  ];
  if (outcome.metrics.length > 0)
    lines.push(
      '| part | metric | value | bar | met | over |',
      '| --- | --- | --- | --- | --- | --- |',
      ...outcome.metrics.map(metricRow),
      '',
    );
  if (outcome.skipped.length > 0)
    lines.push('## Skipped', '', ...outcome.skipped.map((s) => `- ${s.part}: ${s.reason}`), '');
  if (outcome.notes.length > 0) lines.push('## Notes', '', ...outcome.notes, '');
  return lines.join('\n');
}

export function writeOutcome(outcome: ListenOutcome, dir: string): void {
  writeReport(join(dir, 'report.md'), renderOutcome(outcome), {
    ...envelopeOf(outcome),
    skipped: outcome.skipped,
    detail: outcome.detail,
    seconds: outcome.seconds,
    bars: outcome.metrics,
  });
}

export function renderSummary(outcomes: readonly ListenOutcome[]): string {
  return [
    '# Listening evals (EAR1-I3)',
    '',
    '| suite | features | status | detail |',
    '| --- | --- | --- | --- |',
    ...outcomes.map((o) => `| ${o.suite} | ${o.features.join(', ')} | ${o.status} | ${o.detail} |`),
    '',
  ].join('\n');
}

export function writeSummary(outcomes: readonly ListenOutcome[], dir: string): void {
  writeReport(join(dir, 'summary.md'), renderSummary(outcomes), outcomes.map(envelopeOf));
  writeJson(join(dir, 'outcomes.json'), outcomes);
}
