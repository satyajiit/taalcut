// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX2-U1: the study's shot matching (the eval's half-overlap rule, in seconds) and its rank scores. */
import { describe, expect, it } from 'vitest';
import { firstRelevantRank, scoreRanks, shotMatches } from '../../../src/search/study/score';

describe('study scoring', () => {
  it('matches a shot that overlaps a labelled moment by half of the shorter', () => {
    const label = { asset: 'a.mov', range: { from: 18, to: 21 } };
    expect(shotMatches(label, { asset: 'a.mov', from: 17.5, to: 22.4 })).toBe(true);
    expect(shotMatches(label, { asset: 'a.mov', from: 19.6, to: 30 })).toBe(false); // 1.4 s of 3 s
    expect(shotMatches(label, { asset: 'a.mov', from: 19.5, to: 30 })).toBe(true);
    expect(shotMatches(label, { asset: 'b.mov', from: 18, to: 21 })).toBe(false);
    expect(shotMatches({ asset: 'a.mov' }, { asset: 'a.mov', from: 0, to: 1 })).toBe(true);
  });

  it('ranks the first relevant shot and scores hit@1, hit@5 and MRR', () => {
    const shots = [
      { asset: 'x.mov', from: 0, to: 1 },
      { asset: 'a.mov', from: 0, to: 1 },
    ];
    expect(firstRelevantRank([{ asset: 'a.mov' }], shots)).toBe(2);
    expect(firstRelevantRank([{ asset: 'z.mov' }], shots)).toBeNull();
    expect(scoreRanks([1, 2, 6, null])).toEqual({
      probes: 4,
      hitAt1: 0.25,
      hitAt5: 0.5,
      mrr: (1 + 0.5 + 1 / 6) / 4,
    });
    expect(scoreRanks([])).toEqual({ probes: 0, hitAt1: 0, hitAt5: 0, mrr: 0 });
  });
});
