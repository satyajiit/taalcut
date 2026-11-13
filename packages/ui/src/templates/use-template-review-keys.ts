// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useRef } from 'react';

/** Where typing goes: no review key acts there. */
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable=true]';
/** Controls that take Space themselves. The slot strip doesn't: Space on a slot plays it. */
const OWNS_SPACE =
  'button, a[href], summary, [role=button], [role=switch], [role=checkbox], [role=radio], [role=menuitem], ' +
  '[role=menuitemcheckbox], [role=menuitemradio], [role=tab]';
/** Controls that take the arrows themselves: the strip moves its own selection, a cut's grip moves the cut. */
const OWNS_ARROWS = '[role=listbox], [role=slider], [role=radiogroup], [role=menu], [role=tablist]';
/** A menu or popover open over the review takes the keys first. */
const LAYER = '[role=menu], [data-slot=popover-content]';

export interface TemplateReviewKeys {
  /** Space. */
  readonly togglePlay: () => void;
  /** ← and →. */
  readonly stepSlot: (step: 1 | -1) => void;
  /** J (on) and K (back): the things to check, as vim moves down and up. */
  readonly stepCheck: (step: 1 | -1) => void;
  /** ⌘Z (Ctrl+Z off a Mac). */
  readonly undo: () => void;
}

/**
 * The review's keys (BRK1-REV), on the document while the review is open: Space plays and pauses, ← → move between
 * slots, J and K move to the next thing to check and the one before (as vim moves down and up), ⌘Z undoes the
 * last fix. None of them act while you type, while a menu is open, or on a control that owns the
 * key. Held in a ref, so the listener is added once.
 */
export function useTemplateReviewKeys(keys: TemplateReviewKeys, enabled = true) {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TYPING) || document.querySelector(LAYER)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        latest.current.undo();
        return;
      }
      if (mod || event.altKey) return;
      if (event.key === ' ' && !event.shiftKey && !target?.closest(OWNS_SPACE)) {
        event.preventDefault();
        latest.current.togglePlay();
      } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !target?.closest(OWNS_ARROWS)) {
        event.preventDefault();
        latest.current.stepSlot(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.key === 'j' || event.key === 'J' || event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        latest.current.stepCheck(event.key.toLowerCase() === 'j' ? 1 : -1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
