// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(change: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', change);
  return () => list.removeEventListener('change', change);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/**
 * Whether the visitor asked for reduced motion. The server and hydration see `false` (the HTML is the same for
 * everyone), then the browser's answer, so nothing mismatches; CSS covers the moment between.
 */
export function useReducedMotionPref(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
