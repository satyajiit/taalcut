// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL, LRN1-FIX: what the panel under the Templates page's search field shows. It is the page's one answer
 * (library-answer.ts: templates.search for the field's words in the view's scope, its filters and length applied),
 * cut to its first results: a quick way to jump to the best matches, which are the list's first rows. The panel can
 * never show a template the list doesn't, nor say "no match" while the list has some.
 */
import type { TemplateSearchHit } from '@taalcut/core';
import type { TemplateSearchView } from '@taalcut/ui';
import type { TemplateLibrary } from '../library/use-template-library';

/** Results the panel lists: the answer's first. */
export const SEARCH_RESULTS = 8;

export interface TemplateSearchState {
  readonly view: TemplateSearchView;
  /** The results the panel lists now, in order (what the keys move through and Return opens). */
  readonly hits: readonly TemplateSearchHit[];
  readonly retry: () => void;
}

/** The panel's view of the library's answer for `words` (the field's, trimmed). */
export function searchViewOf(
  library: Pick<TemplateLibrary, 'list' | 'settling' | 'failed'>,
  words: string,
): TemplateSearchState {
  const { list, settling, failed } = library;
  const retry = list.reload;
  if (!words) return { view: { kind: 'empty' }, hits: [], retry };
  if (failed) return { view: { kind: 'failed', error: failed }, hits: [], retry };
  const answer = list.data;
  // The library without words (or nothing yet) is no answer to words: the panel waits for the search's.
  if (!answer?.matches) return { view: { kind: 'loading' }, hits: [], retry };
  const hits = answer.matches.hits.slice(0, SEARCH_RESULTS);
  return {
    view: {
      kind: 'ready',
      words: answer.words,
      result: { hits, degraded: answer.matches.degraded, fusion: answer.matches.fusion },
      // Older words' (or filters') results stay, dimmed, until the new answer arrives.
      settling,
    },
    hits,
    retry,
  };
}
