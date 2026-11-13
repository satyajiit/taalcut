// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { GATE_METRICS } from '../catalog';
import { worstVerdict, type GateCell, type GateId, type Verdict } from '../gate-metric';
import { type GateInputs } from '../inputs/types';

/** One plan row's go/no-go: the worst of its deciding cells, so the review needs no hand calculation. */
export interface GateRow {
  row: number;
  verdict: Verdict;
  cells: GateCell[];
}

export interface GateReport {
  gate: GateId;
  from: string;
  to: string;
  /** Every plan row of the gate, in order. */
  rows: GateRow[];
  /** Every cell, deciding or not: each cohort, language, release, channel and runner. */
  cells: GateCell[];
  /** True when any cell drew on a synthetic input. Those numbers are not a gate result. */
  synthetic: boolean;
}

function sliceKey(cell: GateCell): string {
  return [
    cell.slice.cohort,
    cell.slice.language,
    cell.slice.release ?? '',
    cell.slice.channel ?? '',
    cell.slice.runner ?? '',
  ].join('\u0000');
}

export function buildReport(inputs: GateInputs): GateReport {
  const cells: GateCell[] = [];
  for (const metric of GATE_METRICS) {
    for (const binding of metric.bindings) {
      if (binding.gate !== inputs.gate) continue;
      cells.push(...metric.compute(inputs, binding));
    }
  }
  cells.sort(
    (left, right) =>
      left.row - right.row ||
      left.metricId.localeCompare(right.metricId) ||
      sliceKey(left).localeCompare(sliceKey(right)),
  );
  const rowNumbers = [...new Set(cells.map((cell) => cell.row))].sort((left, right) => left - right);
  const rows = rowNumbers.map((row) => {
    const deciding = cells.filter((cell) => cell.row === row && cell.decides);
    return { row, verdict: worstVerdict(deciding.map((cell) => cell.verdict)), cells: deciding };
  });
  return {
    gate: inputs.gate,
    from: inputs.from,
    to: inputs.to,
    rows,
    cells,
    synthetic: cells.some((cell) => cell.synthetic),
  };
}
