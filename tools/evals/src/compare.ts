// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { type MetricPoint, type SuiteEnvelope } from './envelope';
import { type EvalReport } from './metric';

export interface CompareRow {
  name: string;
  base: number | null;
  head: number | null;
  delta: number | null;
  better: 'higher' | 'lower';
  /** 'better', 'worse', or 'same'. Null when one side is missing. */
  change: 'better' | 'worse' | 'same' | null;
}

export interface CompareReport {
  baseSuite: string;
  headSuite: string;
  synthetic: boolean;
  rows: CompareRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asMetrics(value: unknown): MetricPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points: MetricPoint[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    if (typeof item.name !== 'string' || typeof item.value !== 'number') return undefined;
    if (item.better !== 'higher' && item.better !== 'lower') return undefined;
    const point: MetricPoint = { name: item.name, value: item.value, better: item.better };
    if (typeof item.unit === 'string') point.unit = item.unit;
    points.push(point);
  }
  return points;
}

/** Breakdown reports written before suites carried an envelope. */
function fromBreakdown(report: EvalReport): SuiteEnvelope {
  return {
    suite: 'breakdown',
    synthetic: report.synthetic,
    claimed: report.gate3.claimed,
    gate: {
      id: '3',
      pass: report.gate3.pass,
      detail: `${report.aggregate.reelsMeetingBar}/${report.aggregate.reelCount} reels at the bar`,
    },
    metrics: [
      { name: 'reelsAtBar', value: report.aggregate.reelsMeetingBarShare, better: 'higher' },
      { name: 'within2', value: report.aggregate.withinToleranceShare, better: 'higher' },
      { name: 'f1', value: report.aggregate.f1, better: 'higher' },
      { name: 'precision', value: report.aggregate.precision, better: 'higher' },
      { name: 'recall', value: report.aggregate.recall, better: 'higher' },
    ],
  };
}

export function envelopeOf(value: unknown): SuiteEnvelope {
  if (!isRecord(value)) throw new Error('Report JSON must be an object');
  const metrics = asMetrics(value.metrics);
  if (typeof value.suite === 'string' && metrics !== undefined) {
    return {
      suite: value.suite,
      synthetic: value.synthetic === true,
      claimed: value.claimed === true,
      ...(isRecord(value.gate) && typeof value.gate.id === 'string'
        ? {
            gate: {
              id: value.gate.id,
              pass: value.gate.pass === true,
              detail: typeof value.gate.detail === 'string' ? value.gate.detail : '',
            },
          }
        : {}),
      metrics,
    };
  }
  if (isRecord(value.aggregate) && typeof value.aggregate.reelsMeetingBarShare === 'number') {
    return fromBreakdown(value as unknown as EvalReport);
  }
  throw new Error('Report JSON has no metrics and is not a breakdown report');
}

export function compareEnvelopes(base: SuiteEnvelope, head: SuiteEnvelope): CompareReport {
  const names = [...new Set([...base.metrics.map((metric) => metric.name), ...head.metrics.map((m) => m.name)])];
  const rows = names.map((name) => {
    const basePoint = base.metrics.find((metric) => metric.name === name);
    const headPoint = head.metrics.find((metric) => metric.name === name);
    const better = headPoint?.better ?? basePoint?.better ?? 'higher';
    if (basePoint === undefined || headPoint === undefined) {
      return {
        name,
        base: basePoint?.value ?? null,
        head: headPoint?.value ?? null,
        delta: null,
        better,
        change: null,
      } satisfies CompareRow;
    }
    const delta = headPoint.value - basePoint.value;
    const improved = better === 'higher' ? delta > 0 : delta < 0;
    let change: 'better' | 'worse' | 'same' = 'worse';
    if (delta === 0) change = 'same';
    else if (improved) change = 'better';
    return { name, base: basePoint.value, head: headPoint.value, delta, better, change };
  });
  return {
    baseSuite: base.suite,
    headSuite: head.suite,
    synthetic: base.synthetic || head.synthetic,
    rows,
  };
}

export function renderCompare(report: CompareReport): string {
  const lines = [
    `# Eval change: ${report.baseSuite} → ${report.headSuite}`,
    '',
    report.synthetic
      ? 'Synthetic: yes. These numbers are not a gate result.'
      : 'Synthetic: no.',
    '',
    '| Metric | Base | Head | Delta | |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const row of report.rows) {
    const base = row.base === null ? '—' : row.base.toFixed(4);
    const head = row.head === null ? '—' : row.head.toFixed(4);
    const delta = row.delta === null ? '—' : `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(4)}`;
    lines.push(`| ${row.name} | ${base} | ${head} | ${delta} | ${row.change ?? 'missing'} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function compareFiles(basePath: string, headPath: string): CompareReport {
  const read = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read ${path}: ${message}`, { cause: error });
    }
  };
  return compareEnvelopes(envelopeOf(read(basePath)), envelopeOf(read(headPath)));
}
