// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  clipTimeline,
  cutDelta,
  predictInterchange,
  type ExternalChecker,
} from '../../src/adapters/interchange';
import { clipCount } from '../../src/interchange/fixtures';
import { scoreInterchange } from '../../src/interchange/run';
import { cutList, type CutList } from '@taalcut/timeline';

const checker: ExternalChecker = {
  check(format) {
    return { format, status: 'not available', detail: 'not available' };
  },
};

function entry(start: number, inPoint = '0/1'): CutList[number] {
  return { track: 'V1', kind: 'clip', start, frames: 30, assetId: 'asset', inPoint };
}

describe('interchange adapter', () => {
  it('exposes the 30-clip fixture count', () => {
    expect(clipCount).toBe(30);
  });

  it('treats an in-point change as at least one frame and a moved cut as its delta', () => {
    expect(cutDelta([entry(0)], [entry(0)])).toBe(0);
    expect(cutDelta([entry(0)], [entry(2)])).toBeGreaterThanOrEqual(2);
    expect(cutDelta([entry(0)], [{ ...entry(0), inPoint: '1/1' }])).toBeGreaterThanOrEqual(1);
    expect(cutDelta([entry(0)], [])).toBeGreaterThanOrEqual(1);
  });

  it('round-trips otio and fcpxml cut lists with an injected checker', () => {
    const label = { caseId: 'cuts', synthetic: true, clipCount: 3 };
    const predictions = predictInterchange([label], checker);
    const prediction = predictions[0];
    if (prediction === undefined) throw new Error('no prediction');
    expect(prediction.formats.map((format) => format.format)).toEqual(['otio', 'fcpxml']);
    expect(prediction.formats.every((format) => format.maxCutDeltaFrames === 0)).toBe(true);
    expect(prediction.formats.every((format) => format.externalStatus === 'not available')).toBe(true);
    const report = scoreInterchange([label], new Map(predictions.map((row) => [row.caseId, row])));
    expect(report.gate.pass).toBe(true);
    expect(report.claimed).toBe(false);
    expect(report.gate.id).toBe('P3-V5');
  });

  it('round-trips the 30-clip 29.97 fps fixture with uneven lengths and in-points', () => {
    const timeline = clipTimeline(clipCount);
    const cuts = cutList(timeline);
    expect(new Set(cuts.map((cut) => cut.frames)).size).toBeGreaterThan(5);
    expect(cuts.some((cut) => cut.inPoint !== '0/1')).toBe(true);
    const predictions = predictInterchange([{ caseId: 'cuts', synthetic: true, clipCount }], checker);
    expect(predictions[0]?.formats.every((format) => format.maxCutDeltaFrames === 0)).toBe(true);
  });

  it('fails a case whose checker rejects the file, and refuses real labels', () => {
    const rejecting: ExternalChecker = {
      check: (format) => ({ format, status: 'failed', detail: 'exit 1' }),
    };
    const label = { caseId: 'cuts', synthetic: true, clipCount: 2 };
    const predictions = predictInterchange([label], rejecting);
    expect(scoreInterchange([label], new Map(predictions.map((row) => [row.caseId, row]))).gate.pass).toBe(
      false,
    );
    expect(() => predictInterchange([{ ...label, synthetic: false }], checker)).toThrow(/render goldens/);
  });
});
