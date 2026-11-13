// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: the search field as a combobox where the page offers suggestions (search-suggestions.ts). Its panel opens
 * while the field has focus; ↓ and ↑ move through the results and wrap, Return opens the active one, Escape closes the
 * panel (the field clears its words on the next Escape), and leaving the field closes it. Without suggestions it
 * adds nothing.
 */
import { useContext, useId, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { SearchSuggestionsContext } from './search-suggestions';

export interface SearchCombobox {
  /** The input's role and ARIA as a combobox (nothing without suggestions). */
  readonly input: Record<string, string | boolean | undefined>;
  readonly onFocus: () => void;
  /** The words changed: the panel opens with nothing active. */
  readonly onType: () => void;
  /** True when the key was the panel's: the field does nothing more with it. */
  readonly onKey: (event: KeyboardEvent<HTMLInputElement>) => boolean;
  /** The form's blur: focus left the field and its panel. */
  readonly onBlur: (event: FocusEvent<HTMLFormElement>) => void;
  readonly panel: ReactNode;
}

/** The hub's field: no suggestions, so nothing changes. */
const PLAIN: SearchCombobox = {
  input: {},
  onFocus: () => undefined,
  onType: () => undefined,
  onKey: () => false,
  onBlur: () => undefined,
  panel: null,
};

/** What a key does to the panel; null when the key stays the field's. */
type KeyAction =
  | { readonly kind: 'move'; readonly to: number | null }
  | { readonly kind: 'choose'; readonly index: number }
  | { readonly kind: 'close' }
  | null;

/** The option after (or before) `current` among `count`, wrapping; from nothing, the first (or the last). */
const step = (current: number | null, count: number, by: 1 | -1) =>
  current === null ? (by > 0 ? 0 : count - 1) : (current + by + count) % count;

/** ↓ and ↑ open the panel and move (nothing to move to without results); Return and Escape only while it shows. */
function keyAction(key: string, shown: boolean, current: number | null, count: number): KeyAction {
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    return { kind: 'move', to: count > 0 ? step(current, count, key === 'ArrowDown' ? 1 : -1) : null };
  }
  if (key === 'Enter' && shown && current !== null) return { kind: 'choose', index: current };
  return key === 'Escape' && shown ? { kind: 'close' } : null;
}

/** The popup is the results' listbox while there are results, else the panel's line (a hint, bones, an error). */
const comboboxAria = (shown: boolean, popupId: string, activeId: string | undefined) => ({
  role: 'combobox',
  'aria-autocomplete': 'list',
  'aria-expanded': shown,
  'aria-controls': shown ? popupId : undefined,
  'aria-activedescendant': activeId,
});

/** Fewer results than the active one: nothing is active until a key or the pointer picks again. */
const within = (active: number | null, count: number) => (active !== null && active < count ? active : null);

export function useSearchCombobox(): SearchCombobox {
  const suggestions = useContext(SearchSuggestionsContext);
  const listId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  if (!suggestions) return PLAIN;

  const { count } = suggestions;
  const current = within(active, count);
  const optionId = (index: number) => `${listId}-${index}`;
  const show = (to: number | null) => {
    setOpen(true);
    setActive(to);
  };
  const close = () => {
    setOpen(false);
    setActive(null);
  };
  const apply = (action: NonNullable<KeyAction>) => {
    if (action.kind === 'move') show(action.to);
    else if (action.kind === 'choose') suggestions.choose(action.index);
    else close();
  };

  return {
    input: comboboxAria(open, count > 0 ? listId : panelId, current === null ? undefined : optionId(current)),
    onFocus: () => setOpen(true),
    onType: () => show(null),
    onKey: (event) => {
      const action = keyAction(event.key, open, current, count);
      if (action) {
        event.preventDefault();
        apply(action);
      }
      return action !== null;
    },
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    },
    panel: open ? (
      <div id={panelId} className="absolute inset-x-0 top-full z-20 mt-1">
        {suggestions.panel({ listId, optionId, active: current, onActive: setActive })}
      </div>
    ) : null,
  };
}
