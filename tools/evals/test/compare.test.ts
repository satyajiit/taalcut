// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { compareEnvelopes, envelopeOf, renderCompare } from '../src/compare';
import { type SuiteEnvelope } from '../src/envelope';

const base: SuiteEnvelope = {
  suite: 'search',
  synthetic: true,
  claimed: false,
  metrics: [
    { name: 'hitAt5', value: 0.5, better: 'higher' },
    { name: 'indexMinutes', value: 20, better: 'lower' },
  ],
};

describe('compare', () => {
  it('marks a rise as better only when the metric wants to be higher', () => {
    const head: SuiteEnvelope = {
      ...base,
      metrics: [
        { name: 'hitAt5', value: 0.75, better: 'higher' },
        { name: 'indexMinutes', value: 24, better: 'lower' },
      ],
    };
    const report = compareEnvelopes(base, head);
    expect(report.synthetic).toBe(true);
    expect(report.rows.find((row) => row.name === 'hitAt5')?.change).toBe('better');
    expect(report.rows.find((row) => row.name === 'indexMinutes')?.change).toBe('worse');
    expect(renderCompare(report)).toContain('Synthetic: yes');
    expect(renderCompare(report)).toContain('not a gate result');
  });

  it('reads a breakdown report that has no envelope', () => {
    const envelope = envelopeOf({
      synthetic: false,
      gate3: { claimed: true, pass: true },
      aggregate: {
        reelsMeetingBarShare: 0.9,
        withinToleranceShare: 0.95,
        f1: 0.9,
        precision: 0.9,
        recall: 0.9,
        reelsMeetingBar: 9,
        reelCount: 10,
      },
    });
    expect(envelope.suite).toBe('breakdown');
    expect(envelope.metrics.find((metric) => metric.name === 'reelsAtBar')?.value).toBe(0.9);
    expect(envelope.claimed).toBe(true);
  });
});
