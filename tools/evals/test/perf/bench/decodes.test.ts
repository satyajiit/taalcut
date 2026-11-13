// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The decode lane's counters in summary.md: medians over runs, or a plain "not reported". */
import { describe, expect, it } from 'vitest';
import { decodesLine } from '../../../src/perf/bench/decodes';

describe('decodesLine', () => {
  it('gives the medians over runs, with their range when the runs differ', () => {
    expect(
      decodesLine([
        { originalFullDecodes: 2, spawns: 3 },
        { originalFullDecodes: 2, spawns: 4 },
        { originalFullDecodes: 2, spawns: 3 },
      ]),
    ).toBe(
      'Decodes per video file (medians over runs): 2 full decodes of the original (target 2), 3 [3–4] FFmpeg and ffprobe spawns.',
    );
  });

  it('says so when no run reported decodes', () => {
    expect(decodesLine([null, null])).toBe('Decodes: not reported (stage outputs carry no decode counters).');
  });
});
