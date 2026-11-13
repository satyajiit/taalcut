// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which clips ⌘K lists for what is typed, and why (UX4). ⌘K finds your things by their words. The library's search
 * finds shots by meaning too, and by labels a hit can't show (a place, an object), so a clip whose name says nothing
 * of "goa" came up with nothing to say why. Here a clip is listed when its name holds the words, as it is, or when a
 * passage of it does (what is said, what is on screen, its description), with that passage under its name in the
 * Library search's words. A clip found any other way is left to the Library's search, where its frame shows why.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { AssetSummary, SearchHit } from '@taalcut/core';
import type { PaletteWhy } from '@taalcut/ui';

type Field = NonNullable<SearchHit['snippet']>['field'];

/** What matched, in the words of the Library's search results (features/library/search-results.tsx). */
const FIELD_WORDS: Readonly<Record<Field, MessageDescriptor>> = {
  description: msg`Described`,
  transcript: msg`Said`,
  onScreenText: msg`On screen`,
};

/** How much of the passage stays before the first marked word, so the word shows on a one-line row. */
const LEAD = 24;

/** Lower case, accents folded, so "café" finds "Cafe". Folding keeps each letter's place in a Latin name. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface ClipFind {
  readonly asset: AssetSummary;
  /** Why it was found, when its name isn't what matched. */
  readonly why?: PaletteWhy;
}

/** Whether the clip's own name holds every typed word. */
function nameMatches(name: string, words: readonly string[]): boolean {
  const folded = fold(name);
  return words.every((word) => folded.includes(word));
}

/** The passage from a little before its first marked word, so that word is on screen; marks move with it. */
function around(snippet: NonNullable<SearchHit['snippet']>): Pick<PaletteWhy, 'passage' | 'marks'> {
  const first = snippet.highlights[0]?.[0] ?? 0;
  if (first <= LEAD) return { passage: snippet.text, marks: snippet.highlights };
  // Start on a word: the first space at least LEAD before the mark.
  const space = snippet.text.lastIndexOf(' ', first - LEAD);
  const cut = space < 0 ? first - LEAD : space + 1;
  const ellipsis = '…';
  const shift = ellipsis.length - cut;
  return {
    passage: ellipsis + snippet.text.slice(cut),
    marks: snippet.highlights
      .filter(([start]) => start >= cut)
      .map(([s, e]) => [s + shift, e + shift] as const),
  };
}

/** The clips to list, best first, one each, at most `limit`: by name, or by a passage that shows why. */
export function clipFinds(i18n: I18n, hits: readonly SearchHit[], query: string, limit: number): ClipFind[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const finds = new Map<string, ClipFind>();
  for (const hit of hits) {
    if (finds.size >= limit) break;
    if (finds.has(hit.asset.id)) continue;
    if (nameMatches(hit.asset.name, words)) finds.set(hit.asset.id, { asset: hit.asset });
    else if (hit.snippet && hit.snippet.highlights.length > 0)
      finds.set(hit.asset.id, {
        asset: hit.asset,
        why: { kind: i18n._(FIELD_WORDS[hit.snippet.field]), ...around(hit.snippet) },
      });
  }
  return [...finds.values()];
}
