// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

/** The page's main area takes focus, as Skip to content gives it: the next Tab is in the page. */
export function focusMain(): boolean {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return false;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus({ preventScroll: true });
  return true;
}

/** Whether nothing in the page has focus: the body, or the main area Skip to content or a lost focus left it on. */
export function nothingFocused(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.querySelector('main');
}

/**
 * Focus across navigation when the page takes away what had it: Return on a
 * project's row opens the project, and the row goes with the list. The new
 * page's main area gets focus (DESIGN.md "Skip to content"), so the next Tab
 * goes on into the page rather than starting again at the window bar
 * (WCAG 2.4.3). Only focus the leaving page had: a sidebar or bar control
 * that stays keeps it, and so does anything the person moved focus to
 * meanwhile. Back and Forward then put it on what had it there (scroll
 * memory), which counts the main area as nothing focused.
 *
 * It watches from the navigation until the next one, or until the person
 * moves focus or clicks: the router reports a page rendered as its location
 * changes, which can be before the old page leaves (its bones, a redirect).
 * The old page can hide what had focus before it removes it (while the bones
 * show), which drops focus without a removal: a blur that leaves nothing
 * focused counts too. A window losing focus keeps the page's active element,
 * so switching apps doesn't.
 */
export function watchLostFocus(router: Pick<ReturnType<typeof useRouter>, 'subscribe'>): () => void {
  let held: HTMLElement | null = null;
  let removals: MutationObserver | null = null;
  const stop = () => {
    removals?.disconnect();
    removals = null;
    held?.removeEventListener('focusout', blurred);
    held = null;
    document.removeEventListener('focusin', moved, true);
    document.removeEventListener('pointerdown', stop, true);
  };
  /** Focus went somewhere else: theirs, not lost. */
  function moved(event: FocusEvent) {
    if (event.target !== held) stop();
  }
  const check = () => {
    const active = document.activeElement;
    if (!held || (active === held && held.isConnected)) return;
    if (held.isConnected && active && active !== document.body) return;
    stop();
    if (!active || active === document.body) focusMain();
  };
  /** Read once the blur has settled: during it the element may still count as active. */
  function blurred() {
    queueMicrotask(check);
  }
  const offBefore = router.subscribe('onBeforeNavigate', ({ pathChanged }) => {
    // A search or filter change on the same page leaves its rows, and the watch, as they are.
    if (!pathChanged) return;
    stop();
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active.tagName === 'MAIN' || !active.closest('main')) return;
    held = active;
    held.addEventListener('focusout', blurred);
    // A removal is seen in the microtask after it, before anything else can read focus.
    removals = new MutationObserver(check);
    removals.observe(document.body, { subtree: true, childList: true });
    document.addEventListener('focusin', moved, true);
    document.addEventListener('pointerdown', stop, true);
  });
  const offRendered = router.subscribe('onRendered', check);
  return () => {
    offBefore();
    offRendered();
    stop();
  };
}

export function useLostFocus(): void {
  const router = useRouter();
  useEffect(() => watchLostFocus(router), [router]);
}
