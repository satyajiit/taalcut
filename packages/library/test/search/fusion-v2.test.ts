// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * search-fusion-v2 (IX2-U2) on hand-made lists shaped like the bench's "मानसून" regression: a shot that holds the
 * spoken word loses under v1 to a shot that is merely present in every list, and wins under v2, where only close
 * entries count; floors apply only in the space they were measured in; ties keep a stable order.
 */
import { newId, type ShotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  byScore,
  countedLists,
  MATCH_LISTS,
  reciprocalRankFusion,
  SEARCH_FUSION_V1,
  SEARCH_FUSION_V2,
  type ListMatch,
  type MatchLists,
  type SearchFusion,
} from '../../src/index';

const SPACE = 'eg2_q4_daa72c5';
const EQUAL = { frame: 0, description: 0, transcript: 0, ocr: 0, keyword: 0 };
const id = () => newId<'Shot'>() as ShotId;
const entry = (shotId: ShotId, similarity: number): ListMatch => ({ shotId, similarity });
const fillers = (n: number, similarity: number) => Array.from({ length: n }, () => entry(id(), similarity));

/** The lists fused as the search does it: entries that count, then the version's method. */
function rank(lists: MatchLists, fusion: SearchFusion, space = SPACE): ShotId[] {
  return fusion.method.fuse(countedLists(lists, fusion, space), MATCH_LISTS).map((f) => f.shotId);
}

/**
 * `spoken` holds the word (a keyword hit with every term, its transcript segment close) but its frames are far
 * down; `present` has on-screen text and speech that are nothing like the query, and the nearest frame.
 */
function monsoon() {
  const [spoken, present] = [id(), id()];
  const lists: MatchLists = {
    frame: [entry(present, 0.62), ...fillers(23, 0.61), entry(spoken, 0.6), ...fillers(40, 0.55)],
    transcript: [entry(spoken, 0.81), ...fillers(1, 0.7), entry(present, 0.69), ...fillers(30, 0.6)],
    ocr: [entry(present, 0.69), ...fillers(12, 0.66)],
    keyword: [entry(spoken, 1)],
  };
  return { spoken, present, lists };
}

describe('search-fusion-v2', () => {
  it('lets a shot that says the word beat a shot that is only present in every list', () => {
    const { spoken, present, lists } = monsoon();
    expect(rank(lists, SEARCH_FUSION_V1)[0]).toBe(present);
    expect(rank(lists, SEARCH_FUSION_V2)[0]).toBe(spoken);
  });

  it('doesn’t count a list against a shot that could never be in it', () => {
    // `silent` has no speech and no on-screen text; the others have both, far from the query.
    const silent = id();
    const talkers = Array.from({ length: 8 }, () => id());
    const lists: MatchLists = {
      frame: [entry(silent, 0.72), ...talkers.map((t, i) => entry(t, 0.71 - i * 0.001))],
      transcript: talkers.map((t) => entry(t, 0.65)),
      ocr: talkers.map((t) => entry(t, 0.68)),
    };
    expect(rank(lists, SEARCH_FUSION_V1).indexOf(silent)).toBeGreaterThan(4);
    expect(rank(lists, SEARCH_FUSION_V2)[0]).toBe(silent);
    const counted = countedLists(lists, SEARCH_FUSION_V2, SPACE);
    expect(counted.ocr).toEqual([]);
    expect(counted.transcript).toEqual([]);
    expect(counted.frame).toHaveLength(9);
  });

  it('counts close text entries, and keyword hits holding at least half of the query’s terms', () => {
    const [a, b, c] = [id(), id(), id()];
    const counted = countedLists(
      {
        transcript: [entry(a, 0.71), entry(b, 0.709)],
        ocr: [entry(a, 0.74), entry(b, 0.739)],
        description: [entry(c, 0.8)],
        keyword: [entry(a, 1), entry(b, 0.5), entry(c, 0.25)],
      },
      SEARCH_FUSION_V2,
      SPACE,
    );
    expect(counted.transcript?.map((m) => m.shotId)).toEqual([a]);
    expect(counted.ocr?.map((m) => m.shotId)).toEqual([a]);
    expect(counted.description?.map((m) => m.shotId)).toEqual([c]);
    expect(counted.keyword?.map((m) => m.shotId)).toEqual([a, b]);
  });

  it('applies similarity floors only in the embedding space they were measured in', () => {
    const { lists, present } = monsoon();
    const elsewhere = countedLists(lists, SEARCH_FUSION_V2, 'another_space');
    expect(elsewhere.ocr).toEqual(lists.ocr);
    expect(elsewhere.transcript).toEqual(lists.transcript);
    expect(rank(lists, SEARCH_FUSION_V2, 'another_space')[0]).toBe(present);
    // Keyword coverage is no similarity: it holds in every space.
    expect(countedLists({ keyword: [entry(id(), 0.25)] }, SEARCH_FUSION_V2, 'another_space').keyword).toEqual(
      [],
    );
  });

  it('breaks ties by shot id, so equal scores always come back in the same order', () => {
    const [low, high] = [id(), id()].sort();
    const tied = [
      { shotId: high!, score: 0.5, matchedBy: [] },
      { shotId: low!, score: 0.5, matchedBy: [] },
      { shotId: id(), score: 0.6, matchedBy: [] },
    ];
    expect(
      [...tied]
        .sort(byScore)
        .map((f) => f.shotId)
        .slice(1),
    ).toEqual([low, high]);
    // Two shots each first in one of two equally weighted lists' worth: same score, id order, either way round.
    const even = reciprocalRankFusion({ k: 60, weights: { ...EQUAL, frame: 1, ocr: 1 } });
    const one: MatchLists = { frame: [entry(high!, 0.7)], ocr: [entry(low!, 0.9)] };
    const other: MatchLists = { ocr: [entry(high!, 0.7)], frame: [entry(low!, 0.9)] };
    expect(even.fuse(one, MATCH_LISTS).map((f) => f.shotId)).toEqual([low, high]);
    expect(even.fuse(other, MATCH_LISTS).map((f) => f.shotId)).toEqual([low, high]);
  });

  it('keeps find similar on v1’s fusion and credits a transcript segment to every shot it overlaps', () => {
    expect(SEARCH_FUSION_V2.similar).toBe(SEARCH_FUSION_V1.similar);
    expect(SEARCH_FUSION_V2.transcriptCredit).toBe('overlap');
    expect(SEARCH_FUSION_V2.floors?.space).toBe(SPACE);
  });
});
