// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import type { HistoryLedger } from './history-ledger';
import { focusMain } from './lost-focus';
import { watchViewPresses } from './page-turn';
import { useHistoryLedger } from './use-history-nav';

/** The page's name as the window bar shows it: its crumbs, its name and what is open, each once. */
export function pageName(root: ParentNode = document): string {
  const title = root.querySelector('[data-slot=window-bar] [data-slot=window-title]');
  if (!title) return '';
  const words: string[] = [];
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) words.push(text);
  }
  return words.join(', ');
}

/** Whether focus is nowhere: on the body, as when what had it went with the page. */
function onBody(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/** Whether focus is somewhere the new page should take it from: nowhere, the main area, the sidebar or the bar. */
function focusLeftBehind(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.querySelector('main')) return true;
  // A dialog (⌘K closing, a confirmation) or the page itself (a composer it focused) keeps it.
  if (active.closest('[role=dialog]') || active.closest('[role=alertdialog]') || active.closest('main'))
    return false;
  return true;
}

/**
 * After the page changes (UX4, audit P2-2): its name is read out politely, and a page opened anew takes focus on
 * its main area, as Skip to content gives it, so the next Tab is in the page and not nine stops away in the bar
 * and the sidebar. A page the person came back to (Back, Forward, a crumb that steps back) keeps "Coming back":
 * scroll memory puts focus back on what they opened there. Focus that the page has given something of its own (a
 * composer) stays there.
 */
export function watchPageArrival(
  router: Pick<ReturnType<typeof useRouter>, 'subscribe'>,
  ledger: Pick<HistoryLedger, 'get'>,
  announce: (name: string) => void,
): () => void {
  let frame = 0;
  const off = router.subscribe('onRendered', ({ fromLocation, pathChanged }) => {
    if (!fromLocation || !pathChanged) return;
    const cameBack = ledger.get().move === 'pop';
    cancelAnimationFrame(frame);
    // A frame on, the bar holds the new page's title (it portals in after the page renders).
    frame = requestAnimationFrame(() => {
      const name = pageName();
      if (name) announce(name);
      // Coming back, scroll memory puts focus on what you opened there, and it counts the main area as nothing
      // focused; a page with nothing to put back (the app, after Settings remounted it) would leave it on the body.
      if (cameBack ? onBody() : focusLeftBehind()) focusMain();
    });
  });
  return () => {
    cancelAnimationFrame(frame);
    off();
  };
}

/**
 * The polite live region the page's name is read from, and the watch that fills it. In the root, beside the
 * toasts; visually hidden.
 */
export function PageArrival() {
  const router = useRouter();
  const ledger = useHistoryLedger();
  const region = useRef<HTMLParagraphElement>(null);
  const { i18n } = useLingui();
  useEffect(() => watchViewPresses(), []);
  // A new language isn't a new page: the last name read out goes, rather than stay behind in the old language.
  useEffect(() => {
    if (region.current) region.current.textContent = '';
  }, [i18n.locale]);
  useEffect(() => {
    let timer = 0;
    const off = watchPageArrival(router, ledger, (name) => {
      const el = region.current;
      if (!el) return;
      // Emptied first, so the same name twice (Back to where you were) is read again.
      el.textContent = '';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (el.textContent = name), 60);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [router, ledger]);
  // A polite live region without the status role, so a page's own status line stays the one `status` on screen.
  return (
    <p ref={region} aria-live="polite" aria-atomic="true" data-slot="page-announcer" className="sr-only" />
  );
}
