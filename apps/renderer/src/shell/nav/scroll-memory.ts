// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useRouter, type ParsedLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { HistoryLedger } from './history-ledger';
import { nothingFocused } from './lost-focus';
import { useHistoryLedger } from './use-history-nav';

/** The page's scrolling column: the shell's main area, or Settings'. */
export function mainScroller(): HTMLElement | null {
  return document.querySelector('main')?.closest<HTMLElement>('[data-slot=scroll-area]') ?? null;
}

/** Places remembered: plenty for a session's way back, without growing for ever. */
const REMEMBERED = 200;
/** What the person does that means they have taken over: the restore stops where it is. */
const TAKE_OVER = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

const keyOf = (location: ParsedLocation) => location.state.__TSR_key ?? location.href;

/** The path of a link's target, without its search or hash. */
const linkPath = (link: Element) => (link.getAttribute('href') ?? '').split(/[?#]/)[0] ?? '';

/** What had focus on a page when you left it, found again when you come back: a link by its target, a list's row by its place. */
type FocusMark =
  { readonly path: string } | { readonly list: string; readonly index: string } | { readonly id: string };

/** A row's place: its index, and the slot of the list it is drawn in. */
const rowOf = (row: Element) => ({
  index: row.getAttribute('data-index'),
  list: row.parentElement?.closest('[data-slot]')?.getAttribute('data-slot') ?? null,
});

/** Where a page was left: its scroll offset, and what had focus with how far below the top of the view it sat. */
interface Place {
  readonly top: number;
  readonly focus: { readonly mark: FocusMark; readonly at: number } | null;
}

/** How far below the top of the scroller's view an element is. */
const offsetIn = (scroller: HTMLElement, element: HTMLElement) =>
  element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

/**
 * Marks what has focus in the page as you leave it: a link (the clip, the
 * project), a row of a list (a template, by the list's slot and the row's
 * index), anything else by its id. With nothing focused (a shortcut, the
 * menu), the page's link to where you are going. Focus in the sidebar or the
 * bar stays where it is.
 */
function markOf(active: Element | null, to: string): FocusMark | null {
  if (!active || active === document.body) return { path: to };
  if (!active.closest('main')) return null;
  if (active instanceof HTMLAnchorElement) return { path: linkPath(active) };
  const row = active.closest('[data-index]');
  const { index, list } = row ? rowOf(row) : { index: null, list: null };
  if (index && list) return { list, index };
  return active.id ? { id: active.id } : { path: to };
}

function find(scroller: HTMLElement, mark: FocusMark): HTMLElement | null {
  let found: Element | null | undefined;
  if ('path' in mark)
    found = [...scroller.querySelectorAll('a[href]')].find((a) => linkPath(a) === mark.path);
  else if ('id' in mark) found = document.getElementById(mark.id);
  else
    found = [...scroller.querySelectorAll('[data-index]')].find((row) => {
      const place = rowOf(row);
      return place.index === mark.index && place.list === mark.list;
    });
  return found instanceof HTMLElement && scroller.contains(found) ? found : null;
}

/** The place of the page on screen as you leave it for `to`. Focus is kept only for what the page draws. */
function placeOf(scroller: HTMLElement | null, to: string): Place {
  const mark = scroller ? markOf(document.activeElement, to) : null;
  const target = scroller && mark ? find(scroller, mark) : null;
  if (!scroller || !mark || !target) return { top: scroller?.scrollTop ?? 0, focus: null };
  return { top: scroller.scrollTop, focus: { mark, at: offsetIn(scroller, target) } };
}

/**
 * Brings a page back to where you left it, and holds it there as the page comes back rather than by a clock: each
 * change to it (its list arriving, the rows a virtual list draws, a strip above the list filling in or settling)
 * puts it back again. Until what had focus (the clip, the template, the project) is drawn, that is the scroll
 * offset, as far as the page reaches so far; once it is, that item goes back to where it sat on screen, and gets
 * focus the first time, so arrows carry on from there. Focus moves only if nothing has it (the main area a lost
 * focus went to counts as nothing), so a Back button you are pressing keeps it. The page is held until you scroll, click or type, something else scrolls it (an assistive
 * technology, the page itself) or you go to another page; the browser's own scroll anchoring is off meanwhile, so
 * any other scroll is someone else's. Until UX2-FIXUP it gave up after 2.5 s and stopped as soon as the offset was
 * back, so on a busy Mac a list came back at its top, or moved as the page above it settled.
 */
function restore(scroller: HTMLElement, place: Place): () => void {
  let frame = 0;
  let stopped = false;
  let focused = false;
  let expected = scroller.scrollTop;
  const anchoring = scroller.style.overflowAnchor;
  const schedule = () => {
    if (!stopped && !frame) frame = requestAnimationFrame(step);
  };
  const changes = new MutationObserver(schedule);
  const sizes = new ResizeObserver(schedule);
  const reachable = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    changes.disconnect();
    sizes.disconnect();
    scroller.removeEventListener('scroll', moved);
    for (const type of TAKE_OVER) window.removeEventListener(type, stop, true);
    scroller.style.overflowAnchor = anchoring;
  };
  /** A scroll this didn't make, other than the page growing shorter under it (the next change puts it back). */
  function moved() {
    const top = scroller.scrollTop;
    if (Math.abs(top - expected) >= 1 && !(top < expected && top >= reachable() - 1)) stop();
  }
  const scrollTo = (top: number) => {
    if (Math.abs(top - scroller.scrollTop) < 1) return;
    scroller.scrollTop = top;
    expected = scroller.scrollTop;
  };

  function step() {
    frame = 0;
    if (stopped) return;
    const target = place.focus ? find(scroller, place.focus.mark) : null;
    if (!target || !place.focus) return scrollTo(Math.min(place.top, reachable()));
    scrollTo(scroller.scrollTop + offsetIn(scroller, target) - place.focus.at);
    if (focused) return;
    focused = true;
    if (nothingFocused()) target.focus({ preventScroll: true });
  }

  scroller.style.overflowAnchor = 'none';
  for (const type of TAKE_OVER) window.addEventListener(type, stop, true);
  scroller.addEventListener('scroll', moved, { passive: true });
  changes.observe(scroller, { subtree: true, childList: true, attributes: true, characterData: true });
  sizes.observe(scroller);
  for (const child of scroller.children) sizes.observe(child);
  step();
  return stop;
}

/**
 * Scroll and focus across navigation (DESIGN.md "Window", v0.4): a new page
 * opens at its top; Back and Forward bring a page back as you left it. The
 * router's own restoration can't: it restores before a page's list has
 * loaded, and it carries one page's offset into the next in the shell's
 * shared scroll area.
 */
export function watchScrollMemory(
  router: Pick<ReturnType<typeof useRouter>, 'subscribe'>,
  ledger: Pick<HistoryLedger, 'get'>,
): () => void {
  const places = new Map<string, Place>();
  let stopRestore: (() => void) | null = null;
  // The page left for one that hasn't shown yet: the router still counts it as on screen (its `fromLocation`), but
  // the next page's bones have taken its place.
  let leaving: string | null = null;
  const offBefore = router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation, pathChanged }) => {
    stopRestore?.();
    // A search or filter change on the same page keeps its place.
    if (!fromLocation || !pathChanged) return;
    const key = keyOf(fromLocation);
    // Kept as it was when you left it, not as the bones that followed left it.
    if (key === leaving) return;
    leaving = key;
    places.delete(key);
    places.set(key, placeOf(mainScroller(), toLocation.pathname));
    if (places.size > REMEMBERED) places.delete(places.keys().next().value ?? key);
  });
  const offRendered = router.subscribe('onRendered', ({ toLocation, pathChanged }) => {
    // Back before the page you were going to showed: to the router you never left (no path change), but the list
    // made way for that page's bones (UX2-FIXUP).
    const cameBack = keyOf(toLocation) === leaving;
    leaving = null;
    if (!pathChanged && !cameBack) return;
    const scroller = mainScroller();
    if (!scroller) return;
    const place = places.get(keyOf(toLocation));
    if (ledger.get().move === 'pop' && place) stopRestore = restore(scroller, place);
    else scroller.scrollTop = 0;
  });
  return () => {
    offBefore();
    offRendered();
    stopRestore?.();
  };
}

export function useScrollMemory(): void {
  const router = useRouter();
  const ledger = useHistoryLedger();
  useEffect(() => watchScrollMemory(router, ledger), [router, ledger]);
}
