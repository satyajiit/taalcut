// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { planHookVariants, predictVariants } from '../../src/adapters/variants';
import { scoreVariants } from '../../src/variants/run';

describe('planVariants hook axis', () => {
  it('makes 5 variants that all differ in the hook and in at least 30% of picks', async () => {
    const planned = await planHookVariants();
    expect(planned.prediction.variants).toHaveLength(5);
    const report = scoreVariants([planned.label], new Map([[planned.label.caseId, planned.prediction]]));
    expect(report.metrics.find((metric) => metric.name === 'hookDifferShare')?.value).toBe(1);
    expect(report.metrics.find((metric) => metric.name === 'pickDifferShare')?.value).toBe(1);
    expect(report.metrics.find((metric) => metric.name === 'pickAcceptance')?.value).toBe(1);
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.gate.id).toBe('P3-V3');
  });

  it('refuses real labels: the fake catalogue would stand in for their casting library', async () => {
    const planned = await planHookVariants();
    await expect(predictVariants([{ ...planned.label, synthetic: false }])).rejects.toThrow(
      /casting library/,
    );
  });
});
