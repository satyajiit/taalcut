// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type PerfRow } from '../../perf/schema';
import {
  absentCell,
  meetsTarget,
  oneCell,
  type GateCell,
  type GateMetric,
  type Measured,
  type NumericTarget,
  type Verdict,
  worstVerdict,
} from '../gate-metric';
import { isPresent, type CiResult, type PerfInput, type SourceRef } from '../inputs/types';
import { findCi } from './lookup';

/**
 * v1 row 7: cold start under 3 s; a 60 s render in 60 s or less on the M1 8 GB runner; 1 h of footage indexed in
 * 30 min or less on the 16 GB runner; 30 fps preview. `memoryGb` null means every runner.
 */
const COMPONENTS = [
  { name: 'cold-start', op: '<' as const, limit: 3, unit: 'seconds', memoryGb: null },
  { name: 'render-60s', op: '<=' as const, limit: 60, unit: 'seconds', memoryGb: 8 },
  { name: 'index-1h', op: '<=' as const, limit: 30, unit: 'minutes', memoryGb: 16 },
  { name: 'preview-fps', op: '>=' as const, limit: 30, unit: 'fps', memoryGb: null },
];

type Component = (typeof COMPONENTS)[number];

interface Reading {
  runner: string;
  /** Null when the source does not say (a CI result): every component then applies to it. */
  memoryGb: number | null;
  name: string;
  value: number;
  unit: string;
  synthetic: boolean;
  date: string;
}

interface Judged {
  part: string;
  verdict: Verdict;
}

function fromPerf(rows: readonly PerfRow[]): Reading[] {
  return rows.map((row) => ({
    runner: row.runner.id,
    memoryGb: row.runner.memoryGb,
    name: row.metric,
    value: row.value,
    unit: row.unit,
    synthetic: row.synthetic,
    date: row.date,
  }));
}

function fromCi(result: CiResult): Reading[] {
  return result.metrics.map((metric) => ({
    runner: 'ci',
    memoryGb: null,
    name: metric.name,
    value: metric.value,
    unit: metric.unit,
    synthetic: result.synthetic,
    date: '',
  }));
}

function applies(component: Component, memoryGb: number | null): boolean {
  return component.memoryGb === null || memoryGb === null || memoryGb === component.memoryGb;
}

/** The newest claimed reading. A synthetic row is never used for a verdict. */
function latest(readings: readonly Reading[], name: string): Reading | undefined {
  return readings.reduce<Reading | undefined>((best, row) => {
    if (row.synthetic || row.name !== name) return best;
    if (best === undefined || row.date >= best.date) return row;
    return best;
  }, undefined);
}

function judge(component: Component, reading: Reading | undefined, runner: string): Judged {
  if (reading === undefined)
    return { part: `${component.name} absent on ${runner}`, verdict: 'missing input' };
  if (reading.unit !== component.unit) {
    throw new Error(
      `performance ${component.name} on ${runner} has unit ${reading.unit}, expected ${component.unit}`,
    );
  }
  const target: NumericTarget = { op: component.op, value: component.limit, unit: component.unit };
  return {
    part: `${component.name} ${reading.value} ${reading.unit} on ${runner}`,
    verdict: meetsTarget(reading.value, target) ? 'pass' : 'fail',
  };
}

function worst(judged: readonly Judged[]): Verdict {
  return worstVerdict(judged.map((entry) => entry.verdict));
}

function byRunner(readings: readonly Reading[]): Map<string, Reading[]> {
  const runners = new Map<string, Reading[]>();
  for (const reading of readings)
    runners.set(reading.runner, [...(runners.get(reading.runner) ?? []), reading]);
  return new Map([...runners.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

/** One runner's components that apply to its tier. Shown for context; the row is decided by `rowMeasured`. */
function runnerMeasured(runner: string, readings: readonly Reading[]): Measured {
  const memoryGb = readings[0]?.memoryGb ?? null;
  const judged = COMPONENTS.filter((component) => applies(component, memoryGb)).map((component) =>
    judge(component, latest(readings, component.name), runner),
  );
  const ignored = readings
    .filter((row) => row.synthetic)
    .map((row) => `synthetic ${row.name} ${row.value} ${row.unit} (ignored)`);
  const cold = latest(readings, 'cold-start');
  return {
    value: cold === undefined ? null : cold.value,
    n: judged.length,
    interval: null,
    detail: [...judged.map((entry) => entry.part), ...ignored].join('; '),
    display: cold === undefined ? 'no data' : `${cold.value} seconds`,
    verdict: worst(judged),
    decides: false,
  };
}

/** The row: each component on every runner of its tier. A tier with no runner reading is missing input. */
function rowMeasured(runners: ReadonlyMap<string, Reading[]>): Measured {
  const judged: Judged[] = [];
  for (const component of COMPONENTS) {
    const tier = [...runners.entries()].filter(([, rows]) => applies(component, rows[0]?.memoryGb ?? null));
    const claimed = tier.filter(([, rows]) => latest(rows, component.name) !== undefined);
    if (claimed.length === 0) {
      const where = component.memoryGb === null ? 'any runner' : `a ${component.memoryGb} GB runner`;
      judged.push({ part: `${component.name} absent on ${where}`, verdict: 'missing input' });
      continue;
    }
    for (const [runner, rows] of claimed) judged.push(judge(component, latest(rows, component.name), runner));
  }
  const verdict = worst(judged);
  return {
    value: verdict === 'pass' ? 1 : verdict === 'fail' ? 0 : null,
    n: judged.length,
    interval: null,
    detail: judged.map((entry) => entry.part).join('; '),
    display: verdict === 'missing input' ? 'no data' : verdict,
    verdict,
    decides: true,
  };
}

export const performance: GateMetric = {
  id: 'performance',
  label: 'Performance',
  source: 'ci+perf',
  bindings: [
    {
      gate: 'v1',
      row: 7,
      cohort: 'all',
      minN: 1,
      target: { op: 'pass', value: null, unit: 'thresholds' },
    },
  ],
  compute(inputs, binding) {
    const perf: PerfInput | { kind: 'absent' } = inputs.perf;
    let readings: Reading[];
    let sources: SourceRef[];
    let synthetic: boolean;
    if (isPresent(perf)) {
      readings = fromPerf(perf.rows);
      sources = perf.sources;
      synthetic = perf.synthetic;
    } else {
      const ci = findCi(inputs, 'performance');
      if (ci === undefined) return [absentCell(this, binding, 'perf JSONL absent; ci performance absent')];
      readings = fromCi(ci);
      sources = [ci.source];
      synthetic = ci.synthetic;
    }
    const runners = byRunner(readings);
    if (runners.size === 0) return [absentCell(this, binding, 'no performance rows', sources, synthetic)];
    const perRunner: GateCell[] = [...runners.entries()].map(([runner, rows]) =>
      oneCell(this, binding, sources, synthetic, runnerMeasured(runner, rows), {
        cohort: 'all',
        language: 'all',
        runner,
      }),
    );
    return [oneCell(this, binding, sources, synthetic, rowMeasured(runners)), ...perRunner];
  },
};
