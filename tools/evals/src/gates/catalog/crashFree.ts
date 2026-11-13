// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { absentCell, DEFAULT_MIN_N, oneCell, type GateMetric } from '../gate-metric';
import { isPresent, type CrashRow } from '../inputs/types';
import { shareMeasured } from '../share';

function freeMeasured(rows: readonly CrashRow[], detail: string) {
  let sessions = 0;
  let crashed = 0;
  for (const row of rows) {
    sessions += row.sessions;
    crashed += row.crashedSessions;
  }
  return shareMeasured(sessions - crashed, sessions, detail);
}

export const crashFree: GateMetric = {
  id: 'crashFree',
  label: 'Crash-free sessions',
  source: 'crashes',
  bindings: [
    {
      gate: 'beta',
      row: 2,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.99, unit: 'share' },
    },
    {
      gate: 'v1',
      row: 1,
      cohort: 'all',
      minN: DEFAULT_MIN_N,
      target: { op: '>=', value: 0.995, unit: 'share' },
    },
  ],
  compute(inputs, binding) {
    if (!isPresent(inputs.crashes)) return [absentCell(this, binding, 'crashes absent')];
    const { rows, source } = inputs.crashes;
    const groups = new Map<string, CrashRow[]>();
    for (const row of rows) {
      const key = `${row.release}\u0000${row.channel}`;
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [row]);
      else list.push(row);
    }
    const overall = oneCell(this, binding, [source], source.synthetic, freeMeasured(rows, 'all releases'));
    const slices = [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, group]) => {
        const sample = group[0];
        if (sample === undefined) throw new Error('empty crash group');
        return oneCell(
          this,
          binding,
          [source],
          source.synthetic,
          freeMeasured(group, `${sample.release} ${sample.channel}`),
          { cohort: 'all', language: 'all', release: sample.release, channel: sample.channel },
        );
      });
    return [overall, ...slices];
  },
};
