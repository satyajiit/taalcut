// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-FIND: recall@10, reciprocal rank, hit@1 and hit@5 on hand-made rankings. */
import { describe, expect, it } from 'vitest';
import { groupScore, scoreQuery } from '../../../src/search/find/score';

describe('scoreQuery', () => {
  it('counts each relevant clip once among the first ten hits', () => {
    const score = scoreQuery(['a', 'b', 'c'], ['x', 'a', 'a', 'b', 'y']);
    expect(score.rank).toBe(2);
    expect(score.reciprocalRank).toBe(0.5);
    expect(score.recallAt10).toBeCloseTo(2 / 3);
    expect(score.hitAt1).toBe(0);
    expect(score.hitAt5).toBe(1);
    // The first three distinct clips are x, a, b: two of the three answer.
    expect(score.rPrecision).toBeCloseTo(2 / 3);
  });

  it('caps recall at ten clips, and ignores hits past the tenth', () => {
    const many = Array.from({ length: 12 }, (_, n) => `c${n}`);
    expect(scoreQuery(many, many).recallAt10).toBe(1);
    const late = [...Array.from({ length: 10 }, () => 'x'), 'a'];
    const score = scoreQuery(['a'], late);
    expect(score.recallAt10).toBe(0);
    expect(score.rank).toBe(11);
    expect(score.hitAt5).toBe(0);
  });

  it('scores nothing found as zero', () => {
    expect(scoreQuery(['a'], [])).toEqual({
      recallAt10: 0,
      reciprocalRank: 0,
      hitAt1: 0,
      hitAt5: 0,
      rPrecision: 0,
      rank: null,
    });
  });
});

describe('groupScore', () => {
  it('averages its queries', () => {
    const group = groupScore([scoreQuery(['a'], ['a']), scoreQuery(['a'], ['x', 'x', 'x', 'x', 'x', 'x'])]);
    expect(group).toEqual({
      queries: 2,
      recallAt10: 0.5,
      mrr: 0.5,
      hitAt1: 0.5,
      hitAt5: 0.5,
      rPrecision: 0.5,
    });
    expect(groupScore([]).queries).toBe(0);
  });
});
