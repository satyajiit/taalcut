// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One grid for the window bar and the page (DESIGN.md "Window", UX4). The page's content column and the bar's
 * title and actions are placed from the same numbers, in window coordinates, so the title sits on the column's
 * left edge and the page's actions end on its right edge at every width. The numbers live on <html> as custom
 * properties (page-grid.css derives the column from them):
 * - `--shell-start`: where the page area starts, the sidebar's width (0 without one);
 * - `--bar-title-start`: where the bar's title sits after Back, Forward and the mark; the column never starts
 *   left of it, so a narrow column still lines up with the title. The mark travels with the title, just before it;
 * - `--page-measure`: the page's content width, from its named width; `data-page-grid` says a page is claiming
 *   the grid at all (the editor and onboarding don't, and the bar keeps its own layout there).
 * Everything is set before the browser paints (layout effects), so the title and the column never disagree for
 * a frame, and nothing is measured per frame.
 */

/** The page's content widths. `full` has no cap: the column runs from the title to the gutter. */
export const PAGE_WIDTHS = {
  reading: 'var(--container-page-reading)',
  standard: 'var(--container-page-standard)',
  wide: 'var(--container-page-wide)',
  full: '100vw',
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

const ROOT_ATTRIBUTE = 'data-page-grid';

/** The pages claiming the grid, latest last: the newest one on screen sets it (a page and its bones can overlap). */
const claims: { readonly measure: string }[] = [];

function apply(root: HTMLElement): void {
  const top = claims.at(-1);
  if (!top) {
    root.removeAttribute(ROOT_ATTRIBUTE);
    root.style.removeProperty('--page-measure');
    return;
  }
  root.setAttribute(ROOT_ATTRIBUTE, '');
  root.style.setProperty('--page-measure', top.measure);
}

/**
 * A page takes the grid with its content width (a CSS length, or a named width). Call it from a layout effect and
 * return what it returns as the cleanup: the page before it, if still there, takes the grid back.
 */
export function claimPageGrid(
  width: PageWidth | string,
  root: HTMLElement = document.documentElement,
): () => void {
  const claim = { measure: width in PAGE_WIDTHS ? PAGE_WIDTHS[width as PageWidth] : width };
  claims.push(claim);
  apply(root);
  return () => {
    const at = claims.indexOf(claim);
    if (at >= 0) claims.splice(at, 1);
    apply(root);
  };
}

/** The bar's side of the grid: where the page area starts, and where its title sits on its own. */
export interface ShellGrid {
  /** The sidebar's width in px (0 without a sidebar). */
  shellStart: number;
  /** The title's left edge in px when nothing moves it out to the column. */
  titleStart: number;
}

export function publishShellGrid(
  { shellStart, titleStart }: ShellGrid,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty('--shell-start', `${shellStart}px`);
  root.style.setProperty('--bar-title-start', `${titleStart}px`);
}

/**
 * Where the bar's title stands when nothing moves it out: the heading row's left edge, plus what comes before the
 * title in it (the mark and its gap). Read from the row's own edge and its children's offsets, so the padding that
 * moves the row out to the column never feeds back into it.
 */
export function naturalTitleLeft(heading: HTMLElement, title: HTMLElement): number {
  const first = heading.firstElementChild;
  const before = first instanceof HTMLElement && first !== title ? title.offsetLeft - first.offsetLeft : 0;
  return layoutLeft(heading) + before;
}

/**
 * An element's left edge in the window as laid out, before any transform: the fold slides the bar's parts on the
 * compositor while it runs, and the grid must follow where they end, not where they are mid-move.
 */
export function layoutLeft(element: HTMLElement): number {
  let left = 0;
  let at: HTMLElement | null = element;
  while (at) {
    left += at.offsetLeft;
    at = at.offsetParent instanceof HTMLElement ? at.offsetParent : null;
  }
  return left;
}

/**
 * The Tailwind max-width a page used to pass in its className (`max-w-6xl`, `max-w-[90rem]`), as a length, and the
 * className without it. The page lanes move to `width` in Phase 2; until then their column keeps its width and
 * still lines up with the bar.
 */
const TAILWIND_MAX_WIDTHS: Readonly<Record<string, string>> = {
  '3xl': '48rem',
  '4xl': '56rem',
  '5xl': '64rem',
  '6xl': '72rem',
  '7xl': '80rem',
};

export function splitLegacyWidth(className: string | undefined): {
  measure: string | null;
  className: string | undefined;
} {
  if (!className) return { measure: null, className };
  let measure: string | null = null;
  const rest = className
    .split(/\s+/)
    .filter((token) => {
      const match = /^max-w-(?:\[(.+)\]|(\w+))$/.exec(token);
      if (!match) return true;
      measure = match[1] ?? TAILWIND_MAX_WIDTHS[match[2] ?? ''] ?? measure;
      return false;
    })
    .join(' ');
  return { measure, className: rest || undefined };
}
