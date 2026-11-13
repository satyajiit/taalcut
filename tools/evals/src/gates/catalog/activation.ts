// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { eventsNamed } from '../events';
import { absentCell, DEFAULT_MIN_N, mapSlices, type GateMetric } from '../gate-metric';
import { isPresent, type InstallRollup } from '../inputs/types';
import { shareMeasured } from '../share';
import { cohortLanguageSlices, matchesSlice } from '../slices';

/** Only installs first seen in the window: an older install's first in-window session is not its first session. */
function firstSessionActivation(install: InstallRollup): { inDenominator: boolean; activated: boolean } {
  if (!install.newInWindow) return { inDenominator: false, activated: false };
  const starts = eventsNamed(install.envelopes, 'session.started');
  const first = starts[0];
  if (first === undefined) return { inDenominator: false, activated: false };
  const activated = install.envelopes.some(
    (envelope) =>
      envelope.sessionId === first.sessionId &&
      envelope.event.name === 'export.completed' &&
      envelope.event.firstExport,
  );
  return { inDenominator: true, activated };
}

export const activation: GateMetric = {
  id: 'activation',
  label: 'Activation',
  source: 'telemetry',
  bindings: [
    {
      gate: 'beta',
      row: 1,
      cohort: 'fresh-beta',
      minN: 30,
      target: { op: '>=', value: 0.4, unit: 'share' },
    },
    {
      gate: 'v1',
      row: 1,
      cohort: 'beta',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.5, unit: 'share' },
    },
  ],
  compute(inputs, binding) {
    if (!isPresent(inputs.telemetry)) return [absentCell(this, binding, 'telemetry absent')];
    const { installs, sources, synthetic } = inputs.telemetry;
    return mapSlices(this, binding, sources, synthetic, cohortLanguageSlices(), (slice) => {
      let successes = 0;
      let n = 0;
      for (const install of installs) {
        if (!matchesSlice(install.cohort, install.language, slice)) continue;
        const outcome = firstSessionActivation(install);
        if (!outcome.inDenominator) continue;
        n += 1;
        if (outcome.activated) successes += 1;
      }
      return shareMeasured(successes, n, 'first session contains firstExport');
    });
  },
};
