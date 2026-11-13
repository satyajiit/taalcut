// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  absentCell,
  DEFAULT_MIN_N,
  mapSlices,
  type CellSlice,
  type GateMetric,
  type Measured,
} from '../gate-metric';
import { isPresent, type InstallRollup } from '../inputs/types';
import { isoWeekUtc } from '../iso-week';
import { mean, median } from '../stats';
import { cohortLanguageSlices, matchesSlice } from '../slices';

function formatCount(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '');
}

/** One observation per install-week that had a session: that install's exports in the week. */
function ratesFor(installs: readonly InstallRollup[], slice: CellSlice): number[] {
  const rates: number[] = [];
  for (const install of installs) {
    if (!matchesSlice(install.cohort, install.language, slice)) continue;
    const weeks = new Map<string, { exports: number; session: boolean }>();
    for (const envelope of install.envelopes) {
      const week = isoWeekUtc(envelope.at);
      const row = weeks.get(week) ?? { exports: 0, session: false };
      if (envelope.event.name === 'session.started') row.session = true;
      if (envelope.event.name === 'export.completed') row.exports += 1;
      weeks.set(week, row);
    }
    for (const row of weeks.values()) {
      if (row.session) rates.push(row.exports);
    }
  }
  return rates;
}

function measured(rates: readonly number[]): Measured {
  const point = median(rates);
  const average = mean(rates);
  if (point === null || average === null) {
    return {
      value: null,
      n: 0,
      interval: null,
      detail: 'no install-week with a session',
      display: 'no data',
    };
  }
  // PRD: videos exported per weekly active user, a ratio. That is the mean over install-weeks; the median is context.
  return {
    value: average,
    n: rates.length,
    interval: null,
    detail: `exports ÷ active install-weeks ${formatCount(average)}; median ${formatCount(point)}`,
    display: formatCount(average),
  };
}

export const weeklyOutput: GateMetric = {
  id: 'weeklyOutput',
  label: 'Weekly output',
  source: 'telemetry',
  bindings: [
    {
      gate: 'v1',
      row: 1,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 3, unit: 'videos' },
    },
  ],
  compute(inputs, binding) {
    if (!isPresent(inputs.telemetry)) return [absentCell(this, binding, 'telemetry absent')];
    const { installs, sources, synthetic } = inputs.telemetry;
    return mapSlices(this, binding, sources, synthetic, cohortLanguageSlices(), (slice) =>
      measured(ratesFor(installs, slice)),
    );
  },
};
