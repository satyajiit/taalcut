// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { scoreInterchange } from '../../src/interchange/run';
import type { InterchangeLabel, InterchangePrediction } from '../../src/interchange/schema';

function score(
  maxCutDeltaFrames: number,
  externalStatus: 'ok' | 'failed' | 'not available' = 'not available',
  externalDetail = 'otiocat not available',
) {
  const label: InterchangeLabel = { caseId: 'cuts', synthetic: true, clipCount: 3 };
  const prediction: InterchangePrediction = {
    caseId: 'cuts',
    formats: [
      { format: 'otio', maxCutDeltaFrames, externalStatus, externalDetail },
      { format: 'fcpxml', maxCutDeltaFrames: 0, externalStatus: 'not available', externalDetail: 'no DTD' },
    ],
  };
  return scoreInterchange([label], new Map([[label.caseId, prediction]]));
}

describe('interchange bars', () => {
  it('passes at 0 frames and fails when a cut moves', () => {
    const pass = score(0);
    expect(pass.gate.pass).toBe(true);
    expect(pass.metrics.find((metric) => metric.name === 'maxCutDeltaFrames')?.value).toBe(0);
    expect(pass.claimed).toBe(false);
    expect(pass.gate.id).toBe('P3-V5');
    expect(score(1).gate.pass).toBe(false);
  });

  it('records a missing external tool without failing the cut bar', () => {
    const report = score(0, 'not available');
    expect(report.cases[0]?.formats.every((format) => format.externalStatus === 'not available')).toBe(true);
    expect(report.gate.pass).toBe(true);
  });

  it('fails when an external checker rejects the file', () => {
    const report = score(0, 'failed', 'otiocat exit 1');
    expect(report.gate.pass).toBe(false);
    expect(report.gate.detail).toContain('files an external checker rejected 1');
    expect(score(0, 'ok', 'otiocat ok').gate.pass).toBe(true);
  });
});
