// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { scoreCleanup } from '../../src/cleanup/run';
import type { CleanupLabel, CleanupPrediction, FrameRange } from '../../src/cleanup/schema';

function ranges(count: number): FrameRange[] {
  return Array.from({ length: count }, (_, index) => ({ start: index * 10, end: index * 10 + 4 }));
}

function score(removed: number, extra: FrameRange[] = [], words: FrameRange[] = []) {
  const fillers = ranges(10);
  const label: CleanupLabel = {
    caseId: 'talking',
    synthetic: true,
    fps: 30,
    clipFrames: 200,
    fillers,
    pauses: [],
    words,
  };
  const prediction: CleanupPrediction = {
    caseId: 'talking',
    removals: [...fillers.slice(0, removed), ...extra],
  };
  return scoreCleanup([label], new Map([[label.caseId, prediction]]));
}

describe('cleanup bars', () => {
  it('passes when 9 of 10 labelled spans are removed and fails at 8', () => {
    const pass = score(9);
    expect(pass.metrics.find((metric) => metric.name === 'removedShare')?.value).toBe(0.9);
    expect(pass.gate.pass).toBe(true);
    expect(pass.claimed).toBe(false);
    expect(pass.gate.id).toBe('P3-V9');
    expect(score(8).gate.pass).toBe(false);
  });

  it('fails when a kept word overlaps a removal', () => {
    const report = score(10, [], [{ start: 0, end: 4 }]);
    expect(report.metrics.find((metric) => metric.name === 'clippedWords')?.value).toBe(1);
    expect(report.gate.pass).toBe(false);
  });

  it('reports a false removal without failing the gate on its own', () => {
    const report = score(10, [{ start: 150, end: 160 }]);
    expect(report.metrics.find((metric) => metric.name === 'falseRemovals')?.value).toBe(1);
    expect(report.gate.pass).toBe(true);
  });
});
