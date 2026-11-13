// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { absentCell, oneCell, type GateMetric } from '../gate-metric';
import { findCi } from './lookup';

const target = { op: 'pass' as const, value: null, unit: 'pass' };

export const updateAndRollback: GateMetric = {
  id: 'updateAndRollback',
  label: 'Signed, auto-updating builds',
  source: 'ci',
  // Beta row 3 only. v1 row 9 (stable channel live through a staged rollout) is a person's sign-off.
  bindings: [{ gate: 'beta', row: 3, cohort: 'all', minN: 1, target }],
  compute(inputs, binding) {
    const result = findCi(inputs, 'updateAndRollback');
    if (result === undefined) return [absentCell(this, binding, 'ci updateAndRollback absent')];
    return [
      oneCell(this, binding, [result.source], result.synthetic, {
        value: result.pass ? 1 : 0,
        n: 1,
        interval: null,
        detail: result.detail,
        display: result.pass ? 'pass' : 'fail',
      }),
    ];
  },
};
