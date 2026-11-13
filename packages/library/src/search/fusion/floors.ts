// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which list entries count (search-fusion-v2). A vector list holds every item of its kind the kNN returned, and in
 * a small library that is every item: any shot with on-screen text is in the on-screen-text list, near or far, so a
 * rank-based fusion paid shots for having text at all. With floors, an entry counts only when it is close: its
 * similarity must clear the list's floor, measured in one embedding space (a floor means nothing in another), and a
 * keyword hit must hold enough of the query's terms. A shot absent from a list, because it has no such text or
 * because its text isn't close, then gains nothing there, and every other shot gains nothing either.
 */
import { MATCH_LISTS, type ListMatch, type MatchLists } from './lists';
import type { SearchFusion } from './versions';

/**
 * The lists with the entries that don't count dropped. `space` is the active vector index's name. Search
 * applies it only when the query has vector lists: with keywords alone there is nothing to weigh them
 * against, and every hit counts.
 */
export function countedLists(lists: MatchLists, fusion: SearchFusion, space: string | undefined): MatchLists {
  const floors = fusion.floors && fusion.floors.space === space ? fusion.floors.similarity : {};
  const out: MatchLists = {};
  for (const list of MATCH_LISTS) {
    const ranked = lists[list];
    if (!ranked) continue;
    const floor = list === 'keyword' ? fusion.keywordCoverage : floors[list];
    out[list] = floor === undefined ? ranked : ranked.filter((match: ListMatch) => match.similarity >= floor);
  }
  return out;
}
