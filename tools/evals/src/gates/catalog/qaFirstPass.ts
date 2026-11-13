// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { eventsNamed } from '../events';
import {
  absentCell,
  DEFAULT_MIN_N,
  formatShare,
  mapSlices,
  markedSynthetic,
  type GateMetric,
} from '../gate-metric';
import { isPresent } from '../inputs/types';
import { shareMeasured } from '../share';
import { cohortLanguageSlices, matchesSlice } from '../slices';

function renderDetail(inputs: Parameters<GateMetric['compute']>[0]): string {
  if (!isPresent(inputs.evals) || inputs.evals.render === null) return 'render qaFirstPass absent';
  const value = inputs.evals.render.qaFirstPass;
  if (value === null) return 'render qaFirstPass absent';
  return `render qaFirstPass ${formatShare(value)} (beside, not the verdict)`;
}

export const qaFirstPass: GateMetric = {
  id: 'qaFirstPass',
  label: 'QA first pass',
  source: 'telemetry+eval',
  bindings: [
    {
      gate: 'beta',
      row: 4,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.7, unit: 'share' },
    },
    {
      gate: 'v1',
      row: 1,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.8, unit: 'share' },
    },
  ],
  compute(inputs, binding) {
    const beside = renderDetail(inputs);
    const evalSources =
      isPresent(inputs.evals) && inputs.evals.render !== null ? [inputs.evals.render.source] : [];
    if (!isPresent(inputs.telemetry)) {
      return [
        absentCell(this, binding, `telemetry absent; ${beside}`, evalSources, markedSynthetic(evalSources)),
      ];
    }
    const telemetry = inputs.telemetry;
    const sources = [...telemetry.sources, ...evalSources];
    return mapSlices(this, binding, sources, markedSynthetic(sources), cohortLanguageSlices(), (slice) => {
      let first = 0;
      let n = 0;
      for (const install of telemetry.installs) {
        if (!matchesSlice(install.cohort, install.language, slice)) continue;
        for (const envelope of eventsNamed(install.envelopes, 'qa.result')) {
          n += 1;
          if (envelope.event.firstPass) first += 1;
        }
      }
      return shareMeasured(first, n, beside);
    });
  },
};
