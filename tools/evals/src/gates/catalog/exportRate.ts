// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { eventsNamed } from '../events';
import { absentCell, DEFAULT_MIN_N, mapSlices, type GateMetric } from '../gate-metric';
import { isPresent } from '../inputs/types';
import { shareMeasured } from '../share';
import { cohortLanguageSlices, matchesSlice } from '../slices';

/** Ready exports divided by every `render.finished`, drafts included. v1 only. */
export const exportRate: GateMetric = {
  id: 'exportRate',
  label: 'Export rate',
  source: 'telemetry',
  bindings: [
    {
      gate: 'v1',
      row: 1,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.5, unit: 'share' },
    },
  ],
  compute(inputs, binding) {
    if (!isPresent(inputs.telemetry)) return [absentCell(this, binding, 'telemetry absent')];
    const { installs, sources, synthetic } = inputs.telemetry;
    return mapSlices(this, binding, sources, synthetic, cohortLanguageSlices(), (slice) => {
      let ready = 0;
      let n = 0;
      for (const install of installs) {
        if (!matchesSlice(install.cohort, install.language, slice)) continue;
        for (const envelope of eventsNamed(install.envelopes, 'render.finished')) {
          n += 1;
          if (envelope.event.kind === 'export' && envelope.event.status === 'ready') ready += 1;
        }
      }
      return shareMeasured(ready, n, "kind 'export' and status 'ready'");
    });
  },
};
