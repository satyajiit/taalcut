// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { type PerfRow } from '../../src/perf/schema';
import { renderTrends } from '../../src/perf/trends';

function row(overrides: Partial<PerfRow> = {}): PerfRow {
  const runner = { id: 'm1-8gb', chip: 'apple-m1', memoryGb: 8, macos: '15', ...overrides.runner };
  const build = { flavour: 'synthetic', version: '0.0.0', ...overrides.build };
  return {
    v: 1,
    suite: 'perf',
    metric: 'index-1h',
    unit: 'minutes',
    value: 30,
    better: 'lower',
    commit: 'abc123',
    date: '2026-10-01T02:00:00.000Z',
    synthetic: true,
    footage: 'synthetic',
    ...overrides,
    runner,
    build,
  };
}

describe('renderTrends', () => {
  it('names the metric for two nights and marks a synthetic series', () => {
    const markdown = renderTrends([
      row({ date: '2026-10-01T02:00:00.000Z', value: 30, metric: 'index-1h' }),
      row({ date: '2026-10-02T02:00:00.000Z', value: 33, metric: 'index-1h' }),
    ]);
    expect(markdown.startsWith('# Performance trends')).toBe(true);
    expect(markdown).toContain('index-1h');
    expect(markdown).toContain('Synthetic: yes');
    expect(markdown).toContain('Synthetic: yes. These numbers are not a gate result.');
    expect(markdown).toContain('2026-10-01T02:00:00.000Z');
    expect(markdown).toContain('2026-10-02T02:00:00.000Z');
    expect(markdown).toContain('excluding the latest night');
    expect(markdown).toContain('versus the previous night');
    expect(markdown).toContain('Baseline: 30 minutes');
  });

  it('omits the synthetic banner when every row is from the device lab', () => {
    const markdown = renderTrends([
      row({ synthetic: false, footage: 'device-lab', metric: 'render-60s', value: 50 }),
      row({
        synthetic: false,
        footage: 'device-lab',
        metric: 'render-60s',
        value: 52,
        date: '2026-10-02T02:00:00.000Z',
      }),
    ]);
    expect(markdown).toContain('render-60s');
    expect(markdown).not.toContain('Synthetic: yes');
  });
});
