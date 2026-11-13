// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { DAY_MS } from '../iso-week';
import { eventsNamed } from '../events';
import { absentCell, DEFAULT_MIN_N, mapSlices, type GateMetric } from '../gate-metric';
import { isPresent, type InstallRollup } from '../inputs/types';
import { shareMeasured } from '../share';
import { cohortLanguageSlices, matchesSlice } from '../slices';

const DAY_22 = 22 * DAY_MS;
const DAY_28 = 28 * DAY_MS;

/** Null when the install never activated in the window, or when day 28 after it is past `--to` (not yet known). */
function retained(install: InstallRollup, toMs: number): boolean | null {
  const first = eventsNamed(install.envelopes, 'export.completed').find(
    (envelope) => envelope.event.firstExport,
  );
  if (first === undefined) return null;
  if (first.at + DAY_28 > toMs) return null;
  return install.envelopes.some((envelope) => {
    const delta = envelope.at - first.at;
    return delta >= DAY_22 && delta <= DAY_28;
  });
}

/**
 * Of installs activated in the window at least 28 days before `--to`, the share with any event 22–28 days later.
 * Later activations are not counted as lost. Gate slice is alpha.
 */
export const retentionWeek4: GateMetric = {
  id: 'retentionWeek4',
  label: 'Week-4 retention',
  source: 'telemetry',
  bindings: [
    {
      gate: 'v1',
      row: 2,
      cohort: 'alpha',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.3, unit: 'share' },
    },
  ],
  compute(inputs, binding) {
    if (!isPresent(inputs.telemetry)) return [absentCell(this, binding, 'telemetry absent')];
    const { installs, sources, synthetic } = inputs.telemetry;
    return mapSlices(this, binding, sources, synthetic, cohortLanguageSlices(), (slice) => {
      let kept = 0;
      let n = 0;
      for (const install of installs) {
        if (!matchesSlice(install.cohort, install.language, slice)) continue;
        const outcome = retained(install, inputs.toMs);
        if (outcome === null) continue;
        n += 1;
        if (outcome) kept += 1;
      }
      return shareMeasured(kept, n, 'any event 22–28 days after firstExport');
    });
  },
};
