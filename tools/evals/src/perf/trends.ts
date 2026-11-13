// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { median, mostRecent } from './baseline';
import { type PerfRow } from './schema';

const SYNTHETIC_NOTE = 'Synthetic: yes. These numbers are not a gate result.';

function groupKey(row: PerfRow): string {
  return `${row.runner.id}\u0000${row.metric}\u0000${row.footage}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

/** Signed percent change of `value` relative to `baseline` (positive means the number went up). */
function signedPercent(baseline: number, value: number): string {
  if (baseline === 0) {
    if (value === 0) return '0%';
    return value > 0 ? '+Infinity%' : '-Infinity%';
  }
  const pct = ((value - baseline) / baseline) * 100;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return '0%';
  const text = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return rounded > 0 ? `+${text}%` : `${text}%`;
}

/** Markdown trend table. Groups are runner + metric + footage, last 30 nights. */
export function renderTrends(rows: readonly PerfRow[]): string {
  const lines: string[] = ['# Performance trends', ''];
  if (rows.some((row) => row.synthetic)) {
    lines.push(SYNTHETIC_NOTE, '');
  }

  const groups = new Map<string, PerfRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [row]);
    else list.push(row);
  }

  const keys = [...groups.keys()].sort();
  for (const key of keys) {
    const group = groups.get(key);
    if (group === undefined || group.length === 0) continue;
    const newestFirst = mostRecent(group, 30);
    const latest = newestFirst[0];
    if (latest === undefined) continue;
    const history = newestFirst.slice(1);
    const baselineRows = history.slice(0, Math.min(7, history.length));
    const previous = newestFirst[1];
    lines.push(`## ${latest.runner.id} / ${latest.metric} / ${latest.footage}`, '');
    if (baselineRows.length === 0) {
      lines.push(`Latest ${latest.date}: ${formatNumber(latest.value)} ${latest.unit} (no earlier night)`);
    } else {
      const baseline = median(baselineRows.map((item) => item.value));
      const change = signedPercent(baseline, latest.value);
      lines.push(
        `Baseline: ${formatNumber(baseline)} ${latest.unit} (median of last ${baselineRows.length}, excluding the latest night)`,
      );
      lines.push(`Latest ${latest.date}: ${formatNumber(latest.value)} ${latest.unit} (${change} versus baseline)`);
      if (previous !== undefined) {
        const night = signedPercent(previous.value, latest.value);
        lines.push(
          `Previous night ${previous.date}: ${formatNumber(previous.value)} ${previous.unit} (${night} versus the previous night)`,
        );
      }
    }
    lines.push('');
    lines.push('| date | value | unit |', '| --- | --- | --- |');
    for (const item of [...newestFirst].reverse()) {
      lines.push(`| ${item.date} | ${formatNumber(item.value)} | ${item.unit} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n+$/, '\n')}`;
}
