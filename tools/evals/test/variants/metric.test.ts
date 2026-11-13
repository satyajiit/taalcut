// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { picksDiffer, scoreVariantCase } from '../../src/variants/metric';
import { scoreVariants } from '../../src/variants/run';
import type { VariantLabel, VariantPrediction, VariantRow } from '../../src/variants/schema';

const ten = (prefix: string, changed: number): string[] =>
  Array.from({ length: 10 }, (_, index) => (index < changed ? `${prefix}-${index}` : `same-${index}`));

function row(id: string, hook: string, picks: string[]): VariantRow {
  return { id, hook, picks };
}

function label(count: number, acceptable?: string[][]): VariantLabel {
  return {
    caseId: 'hand',
    synthetic: true,
    count,
    ...(acceptable === undefined ? {} : { acceptable }),
  };
}

describe('variant scorer', () => {
  it('treats 2/10 changed picks as under 30% and 3/10 as enough', () => {
    expect(picksDiffer(ten('a', 0), ten('b', 2))).toBe(false);
    expect(picksDiffer(ten('a', 0), ten('b', 3))).toBe(true);
  });

  it('fails identical hooks and a pair that changes only 2 of 10 picks', () => {
    const sameHook = scoreVariantCase(label(2), {
      caseId: 'hand',
      variants: [row('a', 'hook', ten('a', 3)), row('b', 'hook', ten('b', 3))],
    });
    expect(sameHook.hookDifferShare).toBe(0);
    expect(sameHook.pickDifferShare).toBe(1);
    const fewPicks = scoreVariantCase(label(2), {
      caseId: 'hand',
      variants: [row('a', 'one', ten('a', 0)), row('b', 'two', ten('b', 2))],
    });
    expect(fewPicks.hookDifferShare).toBe(1);
    expect(fewPicks.pickDifferShare).toBe(0);
    const enough = scoreVariantCase(label(2), {
      caseId: 'hand',
      variants: [row('a', 'one', ten('a', 0)), row('b', 'two', ten('b', 3))],
    });
    expect(enough.hookDifferShare).toBe(1);
    expect(enough.pickDifferShare).toBe(1);
  });

  it('does not pass with no pairs, and omits pickAcceptance without casting labels', () => {
    const single = scoreVariantCase(label(2), { caseId: 'hand', variants: [row('a', 'hook', ten('a', 0))] });
    expect(single.pairs).toBe(0);
    expect(single.hookDifferShare).toBe(0);
    expect(single.pickDifferShare).toBe(0);
    const report = scoreVariants(
      [label(2)],
      new Map<string, VariantPrediction>([
        ['hand', { caseId: 'hand', variants: [row('a', 'one', ten('a', 0)), row('b', 'two', ten('b', 3))] }],
      ]),
    );
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.metrics.some((metric) => metric.name === 'pickAcceptance')).toBe(false);
  });

  it('reports pickAcceptance without letting a miss fail the gate', () => {
    const picks = ten('a', 0);
    const other = ten('b', 3);
    const acceptable = picks.map((pick) => [pick]);
    const report = scoreVariants(
      [label(2, acceptable)],
      new Map<string, VariantPrediction>([
        ['hand', { caseId: 'hand', variants: [row('a', 'one', picks), row('b', 'two', other)] }],
      ]),
    );
    expect(report.gate.pass).toBe(true);
    expect(report.metrics.find((metric) => metric.name === 'pickAcceptance')?.value).toBeLessThan(1);
  });
});
