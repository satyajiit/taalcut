// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: segment thumb (UX4, from Segmented) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + the UX4 motion grammar
 * the raised thumb under the current option of a pill (Segmented, Tabs, ViewLinks): it glides between options on
 *   --dur-short, --ease-out, no overshoot, by transform alone: two end caps that move and a middle that moves and
 *   stretches (scaleX), so options of different widths glide without animating width or height. Its edge is
 *   rule-strong, so the current option reads at 3:1 in dark, not by the lift alone (DESIGN.md's open item, UX3).
 *   Not a shared-layout animation: in a long chat those measure every laid-out element on the page.
 * reduced motion: the thumb moves at once (base.css lets only colours and opacity ease) */
import { useLayoutEffect, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { cn } from '#lib/cn';

export interface ThumbBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Glide to here (it was somewhere else before); false: be here at once. */
  readonly moved: boolean;
}

const same = (a: ThumbBox | null, b: Omit<ThumbBox, 'moved'>) =>
  a !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Where a pill's thumb was last, by the pill's name: a pill that is rebuilt on every page (Make's views, one per
 * page) starts its thumb where the last one left it and glides to its own option, so moving between the views
 * still reads as one control. Only a position, kept for this window's life.
 */
const lastThumb = new Map<string, Omit<ThumbBox, 'moved'>>();

/**
 * Measures the current option inside `container` (the first match of `selector`) after layout, again when the
 * container changes size (it wraps, a count appears) and when an option's state changes (`data-state`,
 * `aria-current`, `aria-checked`), so a thumb follows a selection made anywhere.
 */
export function useThumb(
  container: RefObject<HTMLElement | null>,
  selector: string,
  memory?: string,
): ThumbBox | null {
  const [thumb, setThumb] = useState<ThumbBox | null>(null);
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    const place = (moved: boolean) => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) return setThumb(null);
      const at = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      if (memory) lastThumb.set(memory, at);
      // A resize that moved nothing leaves a glide in progress alone.
      setThumb((was) => (same(was, at) ? was : { ...at, moved: moved && was !== null }));
    };
    const remembered = memory ? lastThumb.get(memory) : undefined;
    if (remembered) {
      // Start where the last pill of this name left off, then glide once that position has been drawn.
      setThumb({ ...remembered, moved: false });
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => place(true));
      });
    } else place(false);
    // A resize (a font arriving, a window) moves the options under the thumb: put it back in the same frame, before
    // it is drawn, so it never shows a frame past its track (the pseudo-locale check caught one, UX4). Committed
    // now rather than on React's next task, which on a busy machine can be a few frames late.
    const resized = () => flushSync(() => place(false));
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized);
    resize?.observe(root);
    // A face that loads can change an option's width without changing the track's (two options trading widths).
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    fonts?.addEventListener?.('loadingdone', resized);
    const states = new MutationObserver(() => place(true));
    states.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'aria-current', 'aria-checked'],
    });
    return () => {
      cancelAnimationFrame(frame);
      fonts?.removeEventListener?.('loadingdone', resized);
      resize?.disconnect();
      states.disconnect();
    };
  }, [container, selector, memory]);
  return thumb;
}

/** The middle piece's drawn width: it is stretched from this with scaleX to span the chosen option. */
const MIDDLE = 64;
const PIECE =
  'pointer-events-none absolute top-0 left-0 border-rule-strong bg-raised shadow-sm window-inactive:shadow-none';
/** Each piece's clip: a cap keeps its outer half; all keep 4 px above and below for the shadow. */
const CLIP_LEFT = 'inset(-4px 50% -4px -4px)';
const CLIP_MIDDLE = 'inset(-4px 0)';
const CLIP_RIGHT = 'inset(-4px -4px -4px 50%)';
/** The glide, on transform only, once the thumb has somewhere to come from. */
const GLIDE = 'transition-transform duration-(--dur-short) ease-(--ease-out)';

/**
 * The raised thumb under the chosen option: a left and a right cap (a pill's round ends, each clipped to its outer
 * half) that move, and a middle that moves and stretches between them. The caps are never scaled, so the round
 * ends stay round mid-glide; the middle overlaps each by half a pixel so no seam shows.
 * `as="li"` inside a list (a `<ul>` may only hold list items).
 */
export function SegmentThumb({ x, y, w, h, moved, as: Root = 'span' }: ThumbBox & { as?: 'span' | 'li' }) {
  const glide = moved && GLIDE;
  const cap = { width: h, height: h };
  return (
    <Root aria-hidden data-slot="segment-thumb" data-x={x} data-w={w} className="contents">
      <span
        className={cn(PIECE, 'rounded-pill border', glide)}
        style={{ ...cap, transform: `translate(${x}px, ${y}px)`, clipPath: CLIP_LEFT }}
      />
      <span
        className={cn(PIECE, 'origin-top-left border-y', glide)}
        style={{
          width: MIDDLE,
          height: h,
          transform: `translate(${x + h / 2 - 0.5}px, ${y}px) scaleX(${Math.max(0, w - h + 1) / MIDDLE})`,
          clipPath: CLIP_MIDDLE,
        }}
      />
      <span
        className={cn(PIECE, 'rounded-pill border', glide)}
        style={{ ...cap, transform: `translate(${x + w - h}px, ${y}px)`, clipPath: CLIP_RIGHT }}
      />
    </Root>
  );
}
