// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// G8: the spend chart's series (six named jobs plus Other, fixed order, a clean axis top) and the view in the URL.
import type { UsageSummary } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { niceTop, spendSeries } from '../../src/features/settings/usage/spend-series';
import {
  parseUsageSearch,
  periodRange,
  searchOf,
  viewOf,
} from '../../src/features/settings/usage/usage-search';

const group = (costUsd: number) => ({ calls: 1, inputTokens: 0, outputTokens: 0, costUsd, units: {} });

function summary(): UsageSummary {
  return {
    from: 0,
    to: 1,
    totals: {
      calls: 0,
      localCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0,
      bytesSent: 0,
      units: {},
    },
    byDay: [
      { day: '2026-10-01', costUsd: 0, calls: 0, byModule: {} },
      {
        day: '2026-10-02',
        costUsd: 1.4,
        calls: 9,
        byModule: {
          agent: 1,
          images: 0.2,
          voice: 0.1,
          music: 0.05,
          speech: 0.03,
          vision: 0.01,
          router: 0.006,
          embeddings: 0.004,
        },
      },
      { day: '2026-10-03', costUsd: 0.5, calls: 2, byModule: { agent: 0.5 } },
    ],
    byModule: [
      { module: 'agent', ...group(1.5) },
      { module: 'images', ...group(0.2) },
      { module: 'voice', ...group(0.1) },
      { module: 'music', ...group(0.05) },
      { module: 'speech', ...group(0.03) },
      { module: 'vision', ...group(0.01) },
      { module: 'router', ...group(0.006) },
      { module: 'embeddings', ...group(0.004) },
    ],
    byProvider: [],
    byProject: [],
  };
}

describe('spend series', () => {
  it('names the six biggest jobs in order and folds the rest into Other', () => {
    const series = spendSeries(summary(), false);
    expect(series.keys).toEqual(['agent', 'images', 'voice', 'music', 'speech', 'vision', 'other']);
    const day = series.days[1];
    expect(day?.parts.map((p) => p.key)).toEqual(series.keys);
    expect(day?.parts.at(-1)?.costUsd).toBeCloseTo(0.01);
    expect(series.days).toHaveLength(3);
    expect(series.top).toBe(2);
  });

  it('all time drops the quiet days before the first call', () => {
    expect(spendSeries(summary(), true).days.map((d) => d.day)).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('rounds the axis to 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceTop(0)).toBe(0);
    expect(niceTop(0.39)).toBe(0.5);
    expect(niceTop(0.17)).toBeCloseTo(0.2);
    expect(niceTop(2.2)).toBe(2.5);
    expect(niceTop(7)).toBe(10);
  });
});

describe('the view in the URL', () => {
  it('leaves the default period and empty filters out, and drops what it can’t read', () => {
    expect(parseUsageSearch({ period: '30d' })).toEqual({});
    expect(searchOf(viewOf(parseUsageSearch({ period: '7d', module: 'vision' })))).toEqual({
      period: '7d',
      module: 'vision',
    });
    expect(parseUsageSearch({ period: 'year', module: 'all', provider: '../x', project: 'nope' })).toEqual(
      {},
    );
  });

  it('periods end now and start at a local midnight (or the 1st for this month)', () => {
    const now = new Date(2026, 9, 14, 15, 30).getTime();
    expect(periodRange('7d', now)).toEqual({ from: new Date(2026, 9, 8).getTime(), to: now });
    expect(periodRange('30d', now)).toEqual({ from: new Date(2026, 8, 15).getTime(), to: now });
    expect(periodRange('month', now)).toEqual({ from: new Date(2026, 9, 1).getTime(), to: now });
    expect(periodRange('all', now)).toEqual({ from: 0, to: now });
  });
});
