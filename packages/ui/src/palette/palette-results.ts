// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fuzzyMatch, type FuzzyMatch } from './fuzzy';

/** What ranking needs of a palette item (command-palette.tsx PaletteItem). */
export interface Rankable {
  readonly title: string;
  readonly group: string;
  readonly keywords?: readonly string[];
  /** Listed only once something is typed: your chats, projects, clips and templates. */
  readonly scope?: 'search';
  /** The app found it for what was typed (by name or what is in it): listed even when the letters don't match. */
  readonly found?: boolean;
}

export interface PaletteResult<T> {
  readonly item: T;
  readonly match: FuzzyMatch | null;
}

/** A thing the app found by what is in it, not its name: after everything whose letters match. */
const FOUND_SCORE = 0;
/** fuzzy.ts's tiers: from here up, what was typed starts words (tier 3 and better). */
const WORD_SCORE = 100;
const THINGS_PER_GROUP = 5;

function score<T extends Rankable>(
  item: T,
  query: string,
): { match: FuzzyMatch | null; score: number } | null {
  const title = fuzzyMatch(query, item.title);
  // A command's group is a word people type ("settings"); a chat's group ("Chats") would list them all.
  const others = [...(item.keywords ?? []), ...(item.scope === 'search' ? [] : [item.group])]
    .map((text) => fuzzyMatch(query, text))
    .filter((m): m is FuzzyMatch => m !== null);
  const other = others.length > 0 ? Math.max(...others.map((m) => m.score)) - 5 : -Infinity;
  const best = Math.max(title?.score ?? -Infinity, other);
  // Letters scattered through a chat's or a project's name aren't that name: only words (or initials) count.
  const loose = item.scope === 'search' && !item.found && best < WORD_SCORE;
  if (best === -Infinity || loose) return item.found ? { match: null, score: FOUND_SCORE } : null;
  return { match: title, score: best };
}

/**
 * The palette's list in the order it shows (UX4: ⌘K finds your things): grouped, the groups in the order of their
 * best match, best first inside each. With nothing typed, every command in its own order and none of your things.
 * The returned order is the arrow keys' order.
 */
export function paletteResults<T extends Rankable>(items: readonly T[], query: string): PaletteResult<T>[] {
  if (query.trim() === '')
    return items.filter((item) => item.scope !== 'search').map((item) => ({ item, match: null }));
  const ranked: { item: T; match: FuzzyMatch | null; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const found = score(item, query);
    if (found) ranked.push({ item, ...found, index });
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const groups = new Map<string, typeof ranked>();
  for (const entry of ranked) {
    const group = groups.get(entry.item.group) ?? [];
    // Your things list the best few each: enough to find one by name, never a wall.
    if (entry.item.scope === 'search' && group.length >= THINGS_PER_GROUP) continue;
    groups.set(entry.item.group, [...group, entry]);
  }
  return [...groups.values()].flat().map(({ item, match }) => ({ item, match }));
}
