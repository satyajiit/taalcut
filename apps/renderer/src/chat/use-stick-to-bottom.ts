// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** How close to the end still counts as "at the end" (a line or so). */
const SLACK = 48;

function scrollParent(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * The transcript's control you moved to with the keyboard (its ring shows) or the disclosure toggle you just
 * activated, if it has one on screen.
 */
function heldControlIn(content: HTMLElement): HTMLElement | null {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !content.contains(focused)) return null;
  const isDisclosure =
    focused.dataset.slot === 'run-activity-toggle' || focused.parentElement?.dataset.slot === 'reasoning';
  const held = (isDisclosure || focused.matches(':focus-visible')) && focused.getClientRects().length > 0;
  return held ? focused : null;
}

/**
 * Scrolls `box` to its end, but only as far as the transcript's held control keeps its top in view
 * (its scroll-padding included), and never back up past where it was. False when it stopped short of the end.
 */
function followEnd(box: HTMLElement, content: HTMLElement): boolean {
  const before = box.scrollTop;
  box.scrollTop = box.scrollHeight;
  const held = heldControlIn(content);
  if (!held) return true;
  const viewTop = box.getBoundingClientRect().top + (parseFloat(getComputedStyle(box).scrollPaddingTop) || 0);
  const over = viewTop - held.getBoundingClientRect().top;
  if (over <= 0) return true;
  box.scrollTop = Math.max(before, box.scrollTop - over);
  return false;
}

/**
 * Keeps a growing transcript at its end while you are at the end, and lets
 * it be once you scroll up (then `atEnd` is false: show "Jump to latest").
 * New text as it streams, a card that opens, a step that expands: all of it
 * follows, because the content's size is watched, not the item count. The
 * scroller's scroll-padding keeps focused things clear of the sticky composer.
 *
 * Following never takes the control you moved to with the keyboard out of
 * view (WCAG 2.4.11): it goes only as far as that control's top reaches the
 * top of the view, and stops there as if you had scrolled up (IX3-F4).
 */
export function useStickToBottom(
  content: RefObject<HTMLElement | null>,
  composer: RefObject<HTMLElement | null>,
  ready: boolean,
): { atEnd: boolean; toEnd: (smooth?: boolean) => void } {
  const [atEnd, setAtEnd] = useState(true);
  const pinned = useRef(true);
  const scroller = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = content.current;
    if (!ready || !el) return undefined;
    const box = scrollParent(el);
    scroller.current = box;
    let lastTop = box.scrollTop;
    const onScroll = () => {
      const top = box.scrollTop;
      // Only scrolling up lets go of the end. The browser also scrolls on its own when content
      // grows (scroll anchoring) or shrinks (clamping), and that scroll event can come before the
      // resize below has followed the growth: it must not count as leaving the end.
      if (box.scrollHeight - top - box.clientHeight <= SLACK) pinned.current = true;
      else if (top < lastTop) pinned.current = false;
      lastTop = top;
      setAtEnd(pinned.current);
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    const follow = new ResizeObserver(() => {
      if (!pinned.current) return onScroll();
      // Stopped short of the end for the keyboard's focus: as if you had scrolled up (IX3-F4).
      pinned.current = followEnd(box, el);
      setAtEnd(pinned.current);
    });
    follow.observe(el);
    const bar = composer.current;
    const pad = new ResizeObserver(() => {
      if (bar) box.style.scrollPaddingBottom = `${bar.offsetHeight + 16}px`;
    });
    if (bar) pad.observe(bar);
    // Open at the end: the latest is what you came back for.
    box.scrollTop = box.scrollHeight;
    return () => {
      box.removeEventListener('scroll', onScroll);
      follow.disconnect();
      pad.disconnect();
      box.style.scrollPaddingBottom = '';
    };
  }, [content, composer, ready]);

  const toEnd = useCallback((smooth = false) => {
    const box = scroller.current;
    if (!box) return;
    pinned.current = true;
    setAtEnd(true);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (typeof box.scrollTo === 'function')
      box.scrollTo({ top: box.scrollHeight, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    else box.scrollTop = box.scrollHeight;
  }, []);

  return { atEnd, toEnd };
}
