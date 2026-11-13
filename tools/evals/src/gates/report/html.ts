// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { formatTarget, type GateCell, type Verdict } from '../gate-metric';
import { sliceLabel } from '../slices';
import { type GateReport, type GateRow } from './build';

const VERDICTS: readonly Verdict[] = ['pass', 'fail', 'too few', 'missing input'];

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function counts(rows: readonly GateRow[]): Record<Verdict, number> {
  const tally: Record<Verdict, number> = { pass: 0, fail: 0, 'too few': 0, 'missing input': 0 };
  for (const row of rows) tally[row.verdict] += 1;
  return tally;
}

function gateRow(row: GateRow): string {
  const cells = row.cells
    .map((cell) => `${cell.label} ${cell.display} (${formatTarget(cell.target)}): ${cell.verdict}`)
    .join('; ');
  return `<tr><td>${row.row}</td><td>${escapeHtml(row.verdict)}</td><td>${escapeHtml(cells)}</td></tr>`;
}

function bar(tally: Record<Verdict, number>): string {
  const total = VERDICTS.reduce((sum, verdict) => sum + tally[verdict], 0);
  const width = 240;
  const height = 16;
  let x = 0;
  const rects = VERDICTS.map((verdict) => {
    const share = total === 0 ? 0 : tally[verdict] / total;
    const w = share * width;
    const rect = `<rect x="${x}" y="0" width="${w}" height="${height}" class="v-${verdict.replace(' ', '-')}"></rect>`;
    x += w;
    return rect;
  }).join('');
  const label = VERDICTS.map((verdict) => `${tally[verdict]} ${verdict}`).join(', ');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">${rects}</svg>`;
}

function row(cell: GateCell): string {
  const n = cell.n === null ? '' : String(cell.n);
  const interval =
    cell.interval === null ? '' : `[${cell.interval.low.toFixed(4)}, ${cell.interval.high.toFixed(4)}]`;
  return `<tr><td>${cell.row}</td><td>${escapeHtml(cell.label)}</td><td>${escapeHtml(sliceLabel(cell.slice))}</td><td>${escapeHtml(cell.display)}</td><td>${escapeHtml(formatTarget(cell.target))}</td><td>${escapeHtml(cell.verdict)}</td><td>${n}</td><td>${interval}</td><td>${escapeHtml(cell.detail)}</td></tr>`;
}

const CSS = `
:root { color-scheme: light dark; --bg: #f6f1e7; --fg: #1d1914; --muted: #5c5348; --line: #ddd4c4;
  --pass: #1f7a4d; --fail: #a33b32; --few: #8a5a12; --missing-input: #8a8175; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1b1814; --fg: #f6f1e7; --muted: #c4b8a6; --line: #3a342c;
    --pass: #8dcea8; --fail: #f0b2ab; --few: #e2c07a; --missing-input: #b3aa9e; }
}
body { margin: 2rem; background: var(--bg); color: var(--fg); font: 16px/1.45 Palatino, Georgia, serif; }
h1 { font-weight: 600; font-size: 1.6rem; margin: 0 0 0.4rem; }
h2 { font-weight: 600; font-size: 1.2rem; margin: 1.6rem 0 0.4rem; }
p { color: var(--muted); }
.note { color: var(--fail); }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 0.35rem 0.5rem; vertical-align: top; }
.v-pass { fill: var(--pass); }
.v-fail { fill: var(--fail); }
.v-too-few { fill: var(--few); }
.v-missing-input { fill: var(--missing-input); }
`;

/** One file, inline CSS, inline SVG. No network, no external reference. */
export function renderHtml(report: GateReport): string {
  const tally = counts(report.rows);
  const note = report.synthetic
    ? '<p class="note">Synthetic: yes. These numbers are not a gate result.</p>'
    : '<p>Synthetic: no.</p>';
  const legend = `Gate rows: ${VERDICTS.map((verdict) => `${tally[verdict]} ${verdict}`).join(' · ')}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Taalcut ${escapeHtml(report.gate)} gate</title>
<style>${CSS}</style>
</head>
<body>
<h1>Taalcut ${escapeHtml(report.gate)} gate</h1>
<p>Window ${escapeHtml(report.from)} to ${escapeHtml(report.to)} (inclusive, UTC).</p>
${note}
${bar(tally)}
<p>${escapeHtml(legend)}</p>
<h2>Gate rows</h2>
<p>Each row is the worst verdict of its deciding cells (the binding cohort, all languages).</p>
<table>
<thead><tr><th>Row</th><th>Verdict</th><th>Deciding cells</th></tr></thead>
<tbody>
${report.rows.map(gateRow).join('\n')}
</tbody>
</table>
<h2>Every cell</h2>
<table>
<thead><tr><th>Row</th><th>Metric</th><th>Slice</th><th>Value</th><th>Target</th><th>Verdict</th><th>n</th><th>Interval</th><th>Detail</th></tr></thead>
<tbody>
${report.cells.map(row).join('\n')}
</tbody>
</table>
</body>
</html>
`;
}
