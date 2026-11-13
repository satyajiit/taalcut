// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { predictCleanup } from '../../src/adapters/cleanup';
import { cleanupLabel } from '../../src/cleanup/fixtures';
import { scoreCleanup } from '../../src/cleanup/run';

describe('cleanup adapter', () => {
  it('removes the labelled fillers and pauses without clipping a kept word', () => {
    const label = cleanupLabel();
    const predictions = predictCleanup([label]);
    const prediction = predictions[0];
    if (prediction === undefined) throw new Error('no prediction');
    const report = scoreCleanup([label], new Map([[label.caseId, prediction]]));
    expect(report.metrics.find((metric) => metric.name === 'removedShare')?.value).toBe(1);
    expect(report.metrics.find((metric) => metric.name === 'clippedWords')?.value).toBe(0);
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.gate.id).toBe('P3-V9');
  });

  it('refuses real labels: their fillers and pauses would be fed back as the analysis', () => {
    expect(() => predictCleanup([{ ...cleanupLabel(), synthetic: false }])).toThrow(/speech analysis/);
  });
});
