// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { eventsNamed } from '../events';
import {
  absentCell,
  DEFAULT_MIN_N,
  formatUsd,
  mapSlices,
  type CellSlice,
  type GateMetric,
  type Measured,
} from '../gate-metric';
import { isPresent, type InstallRollup } from '../inputs/types';
import { bootstrapMedian, median } from '../stats';
import { cohortLanguageSlices, matchesSlice } from '../slices';

const MICRO = 1_000_000;

function usdOf(installs: readonly InstallRollup[], slice: CellSlice): number[] {
  const values: number[] = [];
  for (const install of installs) {
    if (!matchesSlice(install.cohort, install.language, slice)) continue;
    for (const envelope of eventsNamed(install.envelopes, 'cost.recorded')) {
      if (envelope.event.scope !== 'export' || envelope.event.billing !== 'apiKey') continue;
      values.push(envelope.event.usdMicros / MICRO);
    }
  }
  return values;
}

function measured(values: readonly number[]): Measured {
  const point = median(values);
  if (point === null) {
    return { value: null, n: 0, interval: null, detail: 'no apiKey export cost', display: 'no data' };
  }
  const boot = bootstrapMedian(values);
  return {
    value: point,
    n: values.length,
    interval: boot === null ? null : boot.interval,
    detail: 'median cost.recorded scope export billing apiKey',
    display: formatUsd(point),
  };
}

export const costPerVideo: GateMetric = {
  id: 'costPerVideo',
  label: 'Cost per video',
  source: 'telemetry',
  bindings: [
    {
      gate: 'beta',
      row: 8,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '<=', value: 0.4, unit: 'USD' },
    },
    {
      gate: 'v1',
      row: 1,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '<=', value: 0.25, unit: 'USD' },
    },
  ],
  compute(inputs, binding) {
    if (!isPresent(inputs.telemetry)) return [absentCell(this, binding, 'telemetry absent')];
    const { installs, sources, synthetic } = inputs.telemetry;
    return mapSlices(this, binding, sources, synthetic, cohortLanguageSlices(), (slice) =>
      measured(usdOf(installs, slice)),
    );
  },
};
