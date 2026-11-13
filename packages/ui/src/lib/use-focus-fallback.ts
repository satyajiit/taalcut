// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useRef, type RefObject } from 'react';

/** What keeps your place in a chat: a card, or a warning card. */
const CARD = '[data-slot=smart-card], [data-slot=warning-card]';

/**
 * When the control that has focus goes away (Export swaps a card's buttons for its progress, "I understand" takes
 * the warning away), focus would fall to the page and the next Tab start from the top (WCAG 2.4.3). This keeps it
 * near: on the card the control was in, when the card is still there, or else on `home()` (the composer).
 */
export function useFocusFallback(root: RefObject<HTMLElement | null>, home: () => HTMLElement | null): void {
  // The latest `home` without watching again: a new watcher would lose a removal the old one had queued.
  const homeRef = useRef(home);
  useEffect(() => {
    homeRef.current = home;
  });
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    let last: Element | null = null;
    const onFocusIn = (event: FocusEvent) => {
      last = event.target instanceof Element ? event.target : null;
    };
    const observer = new MutationObserver((records) => {
      const gone = last;
      if (!gone || gone.isConnected) return;
      last = null;
      if (document.activeElement && document.activeElement !== document.body) return;
      // Where it was taken from, if that is still on the page: the card around it.
      const from = records.find((record) =>
        [...record.removedNodes].some((node) => node === gone || node.contains(gone)),
      )?.target;
      const card = from instanceof Element && from.isConnected ? from.closest<HTMLElement>(CARD) : null;
      if (card && !card.hasAttribute('tabindex')) card.tabIndex = -1;
      (card ?? homeRef.current())?.focus({ preventScroll: true });
    });
    container.addEventListener('focusin', onFocusIn);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      container.removeEventListener('focusin', onFocusIn);
      observer.disconnect();
    };
  }, [root]);
}
