// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4
 * Hallmark · component: sidebar fold (panel, words, the page beside it) · genre: atmospheric studio app
 * system: DESIGN.md v0.3 · the sidebar folds to an icon rail and opens again
 * motion: one continuous movement (--dur-short, --ease-out) that starts in the frame after the click. The page
 *   takes its final width at once; the sidebar's edge moves as a clip (the panel slides left while its contents
 *   slide right by as much, so they stay put and the edge passes over them), the page slides by half the
 *   distance (centred content stays continuous). The words fade in the first 40% (CSS transitions); on the way
 *   back they return over the second half. Web Animations on transform and opacity only, so the compositor runs
 *   it; no React render until the fold ends (the rail's own layout). Turns round mid-way from where it is.
 *   Reduced motion: it switches at once.
 * states: n/a (layout; the rows inside carry the states)
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { cn } from '#lib/cn';
import { FOLD_DISTANCE } from '#lib/motion';
import { currentFold, foldTo, onFold, playFold, settleFold, showsFold, type Fold } from './fold-clock';

export interface SidebarFold {
  /** The icon rail is in place (closed and settled): rows are icon-sized and show tooltips. */
  rail: boolean;
}

// Only the rail changes it: folding starts without re-rendering the rows (their words fade by CSS).
const OPEN: SidebarFold = { rail: false };
const RAIL: SidebarFold = { rail: true };
const FoldContext = createContext<SidebarFold>(OPEN);

export function useSidebarFold(): SidebarFold {
  return useContext(FoldContext);
}

/** A row's words: they fade as the sidebar closes and stay, unseen, for screen readers on the rail. */
export function FoldLabel({ children, className }: { children: ReactNode; className?: string }) {
  const { rail } = useSidebarFold();
  return (
    <span data-slot="fold-label" className={rail ? 'sr-only' : cn('relative min-w-0 truncate', className)}>
      {children}
    </span>
  );
}

/** Something only the open sidebar shows (a heading, a list, a shortcut): fades with the words. */
export function FoldFade({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="fold-fade" className={className} {...props}>
      {children}
    </div>
  );
}

const shift = (progress: number) => `translateX(${-FOLD_DISTANCE * progress}px)`;
const counter = (progress: number) => `translateX(${FOLD_DISTANCE * progress}px)`;

/** The panel's part of a fold: its clip slides left and its body right, from where the fold was. */
function animatePanel(clip: HTMLElement, body: HTMLElement, fold: Fold): Animation | null {
  const edge = playFold(clip, [{ transform: shift(fold.from) }, { transform: shift(fold.to) }], fold);
  playFold(body, [{ transform: counter(fold.from) }, { transform: counter(fold.to) }], fold);
  if (edge) showsFold(fold, edge);
  return edge;
}

export interface SidebarPanelProps extends Omit<ComponentProps<'aside'>, 'children'> {
  /** Folded to the rail (the stored choice); a change folds or opens it. */
  collapsed: boolean;
  children: ReactNode;
}

/**
 * The sidebar. Takes its new width at once (the page beside it lays out once);
 * its colour, edge and contents are drawn in a 240 px clip that the fold
 * moves, so nothing sticks out past the edge and nothing reflows on the way.
 * Once closed, the contents take the rail's layout. Provides the fold to every
 * row inside.
 */
export function SidebarPanel({ collapsed, className, children, ...props }: SidebarPanelProps) {
  const [settled, setSettled] = useState(collapsed);
  // Opening leaves the rail at once, in this render.
  if (!collapsed && settled) setSettled(false);
  const rail = collapsed && settled;
  const clip = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      settleFold(collapsed);
      return undefined;
    }
    const fold = foldTo(collapsed);
    if (!clip.current || !body.current) return undefined;
    const running = animatePanel(clip.current, body.current, fold);
    if (!collapsed) return undefined;
    let live = true;
    const done = () => {
      if (live && currentFold() === fold) setSettled(true);
    };
    if (!running) done();
    else void running.finished.then(done, () => undefined);
    return () => {
      live = false;
    };
  }, [collapsed]);

  const closing = collapsed && !rail;
  return (
    <FoldContext.Provider value={rail ? RAIL : OPEN}>
      <aside
        data-slot="sidebar"
        data-collapsed={collapsed || undefined}
        data-rail={rail || undefined}
        className={cn('relative z-10 flex shrink-0 flex-col', collapsed ? 'w-14' : 'w-60', className)}
        {...props}
      >
        <div
          ref={clip}
          data-slot="sidebar-clip"
          className={cn('absolute inset-y-0 left-0 overflow-hidden', rail ? 'w-14' : 'w-60')}
          style={closing ? { transform: shift(1) } : undefined}
        >
          <div
            ref={body}
            data-slot="sidebar-content"
            className={cn('flex h-full flex-col bg-sidebar', rail ? 'w-14' : 'w-60')}
            style={closing ? { transform: counter(1) } : undefined}
          >
            {children}
          </div>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-sidebar-border" />
        </div>
      </aside>
    </FoldContext.Provider>
  );
}

/**
 * The page beside the sidebar: it takes its new width at once and, as the
 * sidebar folds, slides by half the edge's travel, so content centred in it
 * moves continuously. Contained, so its relayout stays inside it.
 */
export function FoldShift({ className, children }: { className?: string; children: ReactNode }) {
  const page = useRef<HTMLDivElement>(null);
  useLayoutEffect(
    () =>
      onFold((fold) => {
        const el = page.current;
        if (!el) return;
        const from = (-FOLD_DISTANCE / 2) * (fold.from - fold.to);
        playFold(el, [{ transform: `translateX(${from}px)` }, { transform: 'none' }], fold);
      }),
    [],
  );
  return (
    <div ref={page} data-slot="fold-page" className={cn('[contain:layout_paint]', className)}>
      {children}
    </div>
  );
}
