// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/**
 * A timeline lane's items as one listbox with a single tab stop (EDT1 gate). Its items are often a few pixels wide
 * and side by side (a caption's words, a clip's own sound), too small to be targets of their own (WCAG 2.5.8), so
 * the lane is the target: it takes focus once, the arrow keys move the active item (`aria-activedescendant`), and
 * Enter selects it. A press on an item still selects it at once. Space is left to the editor (play and pause).
 */
import { type KeyboardEvent, useCallback, useEffect, useId, useState } from 'react';

export interface LaneListbox<Id extends string = string> {
  /** The item the arrow keys are on: the one moved to, else the selected one, else the first. */
  active: Id | null;
  /** The DOM id an item's element carries, so the listbox can name it as its active descendant. */
  optionId: (id: Id) => string;
  /** Props for the listbox element. */
  listbox: {
    role: 'listbox';
    tabIndex: 0;
    'aria-activedescendant': string | undefined;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  /** Makes an item the active one (a press on it). */
  setActive: (id: Id) => void;
}

export function useLaneListbox<Id extends string>(
  ids: readonly Id[],
  selectedId: string | null,
  onSelect: (id: Id) => void,
): LaneListbox<Id> {
  const prefix = useId();
  const [moved, setMoved] = useState<Id | null>(null);
  const [scroll, setScroll] = useState(false);
  const active =
    moved !== null && ids.includes(moved) ? moved : (ids.find((id) => id === selectedId) ?? ids[0] ?? null);
  const optionId = useCallback((id: Id) => `${prefix}-${id}`, [prefix]);

  useEffect(() => {
    if (!scroll || active === null) return;
    setScroll(false);
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [scroll, active, optionId]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (ids.length === 0) return;
    const at = active === null ? -1 : ids.indexOf(active);
    let next: Id | undefined;
    const key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = ids[Math.min(ids.length - 1, at + 1)];
    else if (key === 'ArrowLeft' || key === 'ArrowUp') next = ids[Math.max(0, at - 1)];
    else if (key === 'Home') next = ids[0];
    else if (key === 'End') next = ids[ids.length - 1];
    else if (key === 'Enter' && active !== null) {
      event.preventDefault();
      event.stopPropagation();
      onSelect(active);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (next !== undefined) {
      setMoved(next);
      setScroll(true);
    }
  };

  return {
    active,
    optionId,
    listbox: {
      role: 'listbox',
      tabIndex: 0,
      'aria-activedescendant': active === null ? undefined : optionId(active),
      onKeyDown,
    },
    setActive: setMoved,
  };
}

/** The classes that ring the active item while the listbox (a `group`) has keyboard focus. */
export const ACTIVE_RING =
  'group-focus-visible:data-active:outline-2 group-focus-visible:data-active:outline-offset-1 group-focus-visible:data-active:outline-focus';
