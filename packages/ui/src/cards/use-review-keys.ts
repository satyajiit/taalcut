// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useRef } from 'react';

/** Where Space belongs to the control under focus, not to the video. */
const OWNS_SPACE =
  'button, a[href], input, textarea, select, summary, [contenteditable=""], [contenteditable=true], ' +
  '[role=button], [role=switch], [role=checkbox], [role=radio], [role=slider], [role=option], [role=tab], ' +
  '[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=gridcell], [role=listbox]';

/** Something on top of the page that Escape should close first (a menu, a popover, a dialog, ⌘K). */
const LAYER =
  '[role=dialog], [role=alertdialog], [role=menu], [data-slot=popover-content], [role=listbox][data-state=open]';

export interface ReviewKeys {
  /** Space: play or pause the video. */
  readonly togglePlay: () => void;
  /** ⌘↩ (Ctrl+Enter off a Mac): export. */
  readonly exportNow: () => void;
  /** Escape: back to the chat. */
  readonly back: () => void;
}

/**
 * The review page's keys (UX4): Space plays and pauses unless a control has focus (then it is the control's),
 * ⌘↩ exports from anywhere on the page, and Escape goes back to the chat unless something on top of the page
 * takes it first. Held in a ref, so the listener is added once.
 */
export function useReviewKeys(keys: ReviewKeys) {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        latest.current.exportNow();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        if (document.querySelector(LAYER)) return;
        event.preventDefault();
        latest.current.back();
        return;
      }
      if (event.key === ' ' && !event.shiftKey && !target?.closest(OWNS_SPACE)) {
        event.preventDefault();
        latest.current.togglePlay();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
