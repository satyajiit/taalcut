// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S3: `predict:shots`' detector names. A model detector may carry its stream rate cap (`transnetv2@15`), which
 * names its run; scdet has no stream, so it takes none. And the loop-delay summary over clips.
 */
import { describe, expect, it } from 'vitest';
import { loopSummary } from '../../src/shots/loop-delay';
import { detectorName, parseDetector } from '../../src/shots/predict';

describe('predict:shots detectors', () => {
  it('reads a detector and an optional rate cap, and names its run', () => {
    expect(parseDetector('transnetv2')).toEqual({ detector: 'transnetv2' });
    expect(parseDetector('transnetv2-inline@15')).toEqual({ detector: 'transnetv2-inline', maxFps: 15 });
    expect(['scdet@15', 'transnetv2@0', 'transnetv2@x', 'other'].map(parseDetector)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      [{ detector: 'scdet' as const }, { detector: 'transnetv2' as const, maxFps: 25 }].map(detectorName),
    ).toEqual(['scdet+confirm', 'transnetv2@25fps']);
  });

  it('sums the event-loop delay over clips as ranges and the longest wait', () => {
    expect(loopSummary([])).toBe(undefined);
    expect(
      loopSummary([
        { p50: 10.2, p99: 183, max: 210, mean: 20 },
        { p50: 10.6, p99: 160.4, max: 225.3, mean: 18 },
      ]),
    ).toBe('p50 10.2–10.6, p99 160.4–183.0, max 225.3');
  });
});
