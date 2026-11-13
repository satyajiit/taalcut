// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type GateMetric } from '../gate-metric';
import { requireBoth } from './require-both';

const target = { op: 'pass' as const, value: null, unit: 'pass' };

export const languagesReady: GateMetric = {
  id: 'languagesReady',
  label: 'UI in four languages',
  source: 'ci+manual',
  bindings: [{ gate: 'v1', row: 5, cohort: 'all', minN: 1, target }],
  compute(inputs, binding) {
    return requireBoth(this, binding, inputs, 'languages', 5);
  },
};
