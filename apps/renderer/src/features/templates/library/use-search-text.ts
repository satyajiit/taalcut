// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useDeferredValue, useEffect, useState } from 'react';
import { searchWordsOf, type TemplateSearch } from './template-search';

/** How long typing pauses before the words go into the URL (the list follows at once). */
const URL_SETTLE_MS = 250;

/**
 * The search field's words: the URL is the truth (Back, a link or Clear puts its words in the field), and typing
 * reaches the URL once it pauses while the list follows the words as fast as its search answers.
 */
export function useSearchText(
  search: TemplateSearch,
  onSearch: (next: Partial<TemplateSearch>, replace: boolean) => void,
) {
  const [text, setText] = useState(search.q ?? '');
  const words = useDeferredValue(searchWordsOf(text));
  useEffect(
    () => setText((prev) => (searchWordsOf(prev) === (search.q ?? '') ? prev : (search.q ?? ''))),
    [search.q],
  );
  useEffect(() => {
    const q = searchWordsOf(text) || undefined;
    if (q === search.q) return;
    const timer = setTimeout(() => onSearch({ q }, true), URL_SETTLE_MS);
    return () => clearTimeout(timer);
    // onSearch is a new function each render; the words are what matter.
  }, [text, search.q]);
  return { text, setText, words };
}
