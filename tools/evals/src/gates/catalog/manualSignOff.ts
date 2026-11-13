// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { absentCell, oneCell, type GateMetric } from '../gate-metric';
import { isPresent } from '../inputs/types';
import { findManual } from './lookup';

const target = { op: 'pass' as const, value: null, unit: 'pass' };

const ROWS = [
  { gate: 'beta' as const, row: 9, label: 'Every PRD P0 item is done' },
  { gate: 'beta' as const, row: 10, label: 'Legal sign-off for a public build' },
  { gate: 'beta' as const, row: 11, label: 'Repository public' },
  { gate: 'beta' as const, row: 12, label: 'No known high-severity issue in IPC, the LAN server or updates' },
  { gate: 'v1' as const, row: 4, label: 'Every Must item done or cut' },
  { gate: 'v1' as const, row: 8, label: 'No open high-severity security finding' },
  { gate: 'v1' as const, row: 9, label: 'Stable channel live: 1.0.0 through a staged rollout' },
];

export const manualSignOff: GateMetric = {
  id: 'manualSignOff',
  label: 'Manual sign-off',
  source: 'manual',
  bindings: ROWS.map((row) => ({ gate: row.gate, row: row.row, cohort: 'all' as const, minN: 1, target })),
  compute(inputs, binding) {
    const spec = ROWS.find((row) => row.gate === binding.gate && row.row === binding.row);
    const label = spec?.label ?? this.label;
    const metric = { id: this.id, label };
    if (!isPresent(inputs.manual)) return [absentCell(metric, binding, 'manual file absent')];
    const signed = findManual(inputs, binding.gate, binding.row);
    if (signed === undefined) return [absentCell(metric, binding, `manual row ${binding.row} absent`)];
    return [
      oneCell(metric, binding, [inputs.manual.source], inputs.manual.synthetic, {
        value: signed.pass ? 1 : 0,
        n: 1,
        interval: null,
        detail: `${signed.signedBy} at ${signed.at}; ${signed.evidence}`,
        display: signed.pass ? 'pass' : 'fail',
      }),
    ];
  },
};
