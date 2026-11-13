// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: what a search field offers under it while you type (the Templates page's results by words, meaning and
 * slot intents). The page provides it around its library; the SearchField inside reads it, becomes a combobox and
 * shows the panel. A SearchField with no provider (the hub's) stays a plain field.
 */
import { createContext, type ReactNode } from 'react';

/** What the field gives the panel: the ids that tie its options to the field, and the keyboard's option. */
export interface SearchPanelProps {
  readonly listId: string;
  readonly optionId: (index: number) => string;
  /** The keyboard's (or the pointer's) option, or null. */
  readonly active: number | null;
  readonly onActive: (index: number) => void;
}

export interface SearchSuggestions {
  /** The options the panel lists now: the arrow keys move through them. */
  readonly count: number;
  /** Return on the active option, or a click on one. */
  readonly choose: (index: number) => void;
  readonly panel: (props: SearchPanelProps) => ReactNode;
}

export const SearchSuggestionsContext = createContext<SearchSuggestions | null>(null);
