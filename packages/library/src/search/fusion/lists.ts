// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What fusion works on (P2-L10): ranked lists of shots, one per kind of match, each entry carrying how close the
 * match is. Four lists come from the vector kNN (by item kind), one from full-text search. A fusion method turns
 * them into one ranking; the versioned config (versions.ts) says which method a search uses.
 */
import { uniqueBy, type MATCH_KINDS, type ShotId } from '@taalcut/core';

export const MATCH_LISTS = ['frame', 'description', 'transcript', 'ocr', 'keyword'] as const;
export type MatchList = (typeof MATCH_LISTS)[number];

/** What each list means on a hit's chips. */
export const MATCH_KIND_OF: Readonly<Record<MatchList, (typeof MATCH_KINDS)[number]>> = {
  frame: 'visual',
  description: 'description',
  transcript: 'speech',
  ocr: 'onScreenText',
  keyword: 'keyword',
};

/** One shot's best match in one list. */
export interface ListMatch {
  readonly shotId: ShotId;
  /**
   * Vector lists: the cosine similarity of the shot's best item to the query (−1..1). Keywords: the share of the
   * query's terms the shot holds (0..1); the list itself is in bm25 order.
   */
  readonly similarity: number;
}

/** Each list best first, a shot at most once (at its best). A list a search didn't run is absent. */
export type MatchLists = Partial<Record<MatchList, readonly ListMatch[]>>;

export interface FusedShot {
  readonly shotId: ShotId;
  /** The fused value over the most it could be, 0..1. */
  readonly score: number;
  readonly matchedBy: readonly MatchList[];
}

/** One way of fusing lists into a ranking. */
export interface FusionMethod {
  /** Names the method in reports. */
  readonly id: string;
  /**
   * Fused shots, best first (ties by shot id). `possible` names the lists the query could have matched, for the
   * maximum: a keyword-only search scores against keywords alone.
   */
  fuse(lists: MatchLists, possible: readonly MatchList[]): FusedShot[];
}

/** The list with each shot once, at its first (best) place. */
export function onePerShot(list: readonly ListMatch[]): ListMatch[] {
  return uniqueBy(list, (match) => match.shotId);
}

/** A shot's terms, one per list it is in, in `MATCH_LISTS` order, and those lists. */
export interface ShotTerms {
  readonly terms: number[];
  readonly matchedBy: MatchList[];
}

/**
 * Every shot's terms: `term` scores each list entry (a shot once per list, at its best place; `index` is that
 * place from 0). A fusion method then combines a shot's terms into its score.
 */
export function collectTerms(
  lists: MatchLists,
  term: (list: MatchList, match: ListMatch, index: number) => number,
): Map<ShotId, ShotTerms> {
  const shots = new Map<ShotId, ShotTerms>();
  for (const list of MATCH_LISTS) {
    const ranked = lists[list];
    if (!ranked) continue;
    onePerShot(ranked).forEach((match, index) => {
      const entry = shots.get(match.shotId) ?? { terms: [], matchedBy: [] };
      entry.terms.push(term(list, match, index));
      entry.matchedBy.push(list);
      shots.set(match.shotId, entry);
    });
  }
  return shots;
}

/** Best first, ties by shot id, so equal scores always come back in the same order. */
export function byScore(a: FusedShot, b: FusedShot): number {
  return b.score - a.score || (a.shotId < b.shotId ? -1 : a.shotId > b.shotId ? 1 : 0);
}
