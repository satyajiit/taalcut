// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Fades the bottom edge of a list that scrolls on its own while more of it is
 * below (the sidebar at 960 × 600: Settings' last sections, older chats), so a
 * cut-off row reads as "scroll for more", not as the end. The mask only needs
 * an opaque colour; the canvas token is one.
 */
export const SCROLL_HINT_CLASS =
  'data-[more=true]:[mask-image:linear-gradient(to_bottom,var(--color-canvas)_calc(100%-1.5rem),transparent)]';

export function useScrollHint<T extends HTMLElement>(): { ref: RefObject<T | null>; more: boolean } {
  const ref = useRef<T>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const check = () => setMore(element.scrollTop + element.clientHeight < element.scrollHeight - 1);
    check();
    element.addEventListener('scroll', check, { passive: true });
    // The list's own size (the window) and its content's (chats arriving) both change what is below.
    const resize = new ResizeObserver(check);
    resize.observe(element);
    for (const child of element.children) resize.observe(child);
    return () => {
      element.removeEventListener('scroll', check);
      resize.disconnect();
    };
  }, []);
  return { ref, more };
}
