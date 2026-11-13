// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { type RefObject, useEffect, useState } from 'react';

/** True while the element is in the viewport and the tab is shown: Kaatu's timers and breath run only then. */
export function useOnScreen(target: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const el = target.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setSeen(entry?.isIntersecting ?? false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  useEffect(() => {
    const update = () => setShown(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return seen && shown;
}
