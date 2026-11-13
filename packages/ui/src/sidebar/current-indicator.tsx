// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: current-row indicator, gliding hover indicator, and activation tick · genre: atmospheric studio app · system: DESIGN.md v0.3
 * motion: the raised mark glides from the last current row to the new one (translate and scale on the Web
 *   Animations API, --dur-short, --ease-out, no overshoot); the hover mark glides between sibling rows as the
 *   pointer moves across a list (--dur-micro, --ease-out); the new row's icon gives one small tick (scale 0.8 → 1).
 *   As the sidebar folds, the row-wide mark fades while an icon-sized one appears in its place (CSS, styles.css),
 *   so the mark shrinks to the icon's square without anything being scaled out of shape.
 *   Reduced motion: the mark moves at once, no tick.
 * states: n/a (marks; the rows carry the states)
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { cssEase, DUR, EASE_OUT } from '#lib/motion';

interface HoverSample {
  row: WeakRef<Element>;
  rect: DOMRect;
  at: number;
}

/**
 * Per-scope indicator state for gliding current and hover marks. Holds DOM
 * elements via WeakRef so unmounted rows never stay pinned in memory.
 */
export interface IndicatorStore {
  getLastRow(scope: string): Element | null;
  setLastRow(scope: string, row: Element | null): void;
  getLastHover(scope: string): { row: Element; rect: DOMRect; at: number } | null;
  setLastHover(scope: string, row: Element, rect: DOMRect, at: number): void;
  reset(): void;
}

export function createIndicatorStore(): IndicatorStore {
  const lastRowByScope = new Map<string, WeakRef<Element>>();
  const lastHoverByScope = new Map<string, HoverSample>();
  return {
    getLastRow(scope) {
      return lastRowByScope.get(scope)?.deref() ?? null;
    },
    setLastRow(scope, row) {
      if (row) lastRowByScope.set(scope, new WeakRef(row));
      else lastRowByScope.delete(scope);
    },
    getLastHover(scope) {
      const sample = lastHoverByScope.get(scope);
      const row = sample?.row.deref();
      if (!sample || !row) return null;
      return { row, rect: sample.rect, at: sample.at };
    },
    setLastHover(scope, row, rect, at) {
      lastHoverByScope.set(scope, { row: new WeakRef(row), rect, at });
    },
    reset() {
      lastRowByScope.clear();
      lastHoverByScope.clear();
    },
  };
}

const defaultIndicatorStore = createIndicatorStore();
const IndicatorStoreContext = createContext<IndicatorStore>(defaultIndicatorStore);

export const IndicatorStoreProvider = IndicatorStoreContext.Provider;

/** Clears the default indicator store (for unit tests). */
export function resetIndicatorStore(): void {
  defaultIndicatorStore.reset();
}

const HOVER_HANDOFF_MS = 180;

/** Nothing moves: reduced motion, or no Web Animations (an old engine, a test's DOM). */
function still(el: Element): boolean {
  return (
    typeof el.animate !== 'function' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

const MARK = 'absolute inset-y-0 left-0 rounded-md bg-raised shadow-sm window-inactive:shadow-none';
// The sidebar's own hover and pressed tones, so a hovered row stays below the current row's raised mark in dark.
const HOVER_MARK =
  'absolute inset-y-0 left-0 rounded-md bg-sidebar-hover group-active/row:bg-sidebar-pressed';

/**
 * The raised mark behind the current row. Render it inside the current row
 * only (the row positioned): when another row in the same `scope` becomes
 * current, its mark glides in from this one's place.
 */
export function CurrentIndicator({ scope = 'sidebar', className }: { scope?: string; className?: string }) {
  const store = useContext(IndicatorStoreContext);
  const mark = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = mark.current;
    const row = el?.parentElement ?? null;
    const previous = store.getLastRow(scope);
    store.setLastRow(scope, row);
    if (!el || !row || !previous || previous === row || !previous.isConnected || still(el)) return;
    const from = previous.getBoundingClientRect();
    const to = row.getBoundingClientRect();
    const dy = from.top - to.top;
    if (Math.abs(dy) < 1 || to.height === 0) return;
    el.animate(
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not words
      [{ transform: `translateY(${dy}px) scaleY(${from.height / to.height})` }, { transform: 'none' }],
      { duration: DUR.short * 1000, easing: cssEase(EASE_OUT) },
    );
  }, [scope, store]);

  useEffect(() => {
    const row = mark.current?.parentElement;
    if (!row) return;
    const record = () => {
      store.setLastHover(scope, row, row.getBoundingClientRect(), performance.now());
    };
    row.addEventListener('pointerleave', record);
    return () => row.removeEventListener('pointerleave', record);
  }, [scope, store]);

  return (
    <span
      ref={mark}
      aria-hidden
      data-slot="current-indicator"
      className={cn('pointer-events-none absolute inset-0 origin-top', className)}
    >
      <span data-slot="current-row-mark" className={cn(MARK, 'right-0')} />
      <span data-slot="current-icon-mark" className={cn(MARK, 'w-10')} />
    </span>
  );
}

/**
 * Shared-geometry hover mark behind an inactive row (`group/row`). When the
 * pointer moves from one row to another in the same `scope`, the hover pill
 * glides from the previous row's bounds to this row on the compositor.
 */
export function HoverIndicator({ scope = 'sidebar', className }: { scope?: string; className?: string }) {
  const store = useContext(IndicatorStoreContext);
  const mark = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = mark.current;
    const row = el?.parentElement ?? null;
    if (!el || !row) return;
    const onEnter = () => {
      const now = performance.now();
      const prev = store.getLastHover(scope);
      const to = row.getBoundingClientRect();
      store.setLastHover(scope, row, to, now);
      if (
        !prev ||
        prev.row === row ||
        !prev.row.isConnected ||
        now - prev.at > HOVER_HANDOFF_MS ||
        still(el)
      ) {
        return;
      }
      const dy = prev.rect.top - to.top;
      if (Math.abs(dy) < 1 || to.height === 0) return;
      el.animate(
        // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS value, not words
        [{ transform: `translateY(${dy}px) scaleY(${prev.rect.height / to.height})` }, { transform: 'none' }],
        { duration: DUR.micro * 1000, easing: cssEase(EASE_OUT) },
      );
    };
    const onLeave = () => {
      store.setLastHover(scope, row, row.getBoundingClientRect(), performance.now());
    };
    row.addEventListener('pointerenter', onEnter);
    row.addEventListener('pointerleave', onLeave);
    return () => {
      row.removeEventListener('pointerenter', onEnter);
      row.removeEventListener('pointerleave', onLeave);
    };
  }, [scope, store]);

  return (
    <span
      ref={mark}
      aria-hidden
      data-slot="hover-indicator"
      className={cn(
        'pointer-events-none absolute inset-0 origin-top opacity-0 transition-opacity duration-(--dur-micro) ease-(--ease-out)',
        'group-hover/row:opacity-100 in-[.is-hover]:opacity-100',
        className,
      )}
    >
      <span data-slot="current-row-mark" className={cn(HOVER_MARK, 'right-0')} />
      <span data-slot="current-icon-mark" className={cn(HOVER_MARK, 'w-10')} />
    </span>
  );
}

/** Wraps a row's icon: when the row becomes the current one, the icon ticks once. Not on first show. */
export function ActivationTick({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  const icon = useRef<HTMLSpanElement>(null);
  const was = useRef(active);
  useEffect(() => {
    const el = icon.current;
    if (el && active && !was.current && !still(el)) {
      el.animate([{ transform: 'scale(0.8)' }, { transform: 'none' }], {
        duration: DUR.short * 1000,
        easing: cssEase(EASE_OUT),
      });
    }
    was.current = active;
  }, [active]);
  return (
    <span
      ref={icon}
      data-slot="activation-tick"
      className={cn('relative inline-grid place-items-center', className)}
    >
      {children}
    </span>
  );
}
