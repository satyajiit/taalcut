// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { claimPageGrid, cn, splitLegacyWidth, type PageWidth } from '@taalcut/ui';
import { useEffect, useLayoutEffect, type ComponentProps, type ReactNode } from 'react';
import { ToolbarActions, ToolbarTitle } from './toolbar';

/**
 * Sets the window title to "<page> · Taalcut" in the current language. Main
 * shows it where macOS names the window: Mission Control, the Window menu, ⌘`.
 */
export function useDocumentTitle(title: string): void {
  const { t } = useLingui();
  useEffect(() => {
    document.title = t`${title} · Taalcut`;
  }, [t, title]);
}

export type { PageWidth };

export interface PageColumnProps extends ComponentProps<'div'> {
  /** The content's width (DESIGN.md "Page"): reading, standard, wide, or full. A CSS length for the bones' few. */
  width?: PageWidth | (string & {});
}

/**
 * The page's column on the page grid (@taalcut/ui page-grid): it claims the grid with its width, so the window
 * bar's title and actions line up with it, and sits where the grid puts it. Every page in the shell is one; the
 * bones and the message pages use it bare.
 */
export function PageColumn({ width = 'standard', className, children, ...props }: PageColumnProps) {
  useLayoutEffect(() => claimPageGrid(width), [width]);
  return (
    <div data-slot="page" data-width={width} className={cn('page-column', className)} {...props}>
      {children}
    </div>
  );
}

export interface PageProps {
  title: string;
  /** What is open in the page (a clip's file name, a template's name), after the bar's chevron, as written. */
  detail?: ReactNode;
  /** One sentence under the views: what the page is for. */
  description?: ReactNode;
  /** The page's own actions: in the window bar, ending on the column's right edge. */
  actions?: ReactNode;
  /** The page's views (the kit's ViewLinks, with anything that belongs on their row), first in the content. */
  views?: ReactNode;
  /** The content's width: `standard` (64rem) unless the page reads (`reading`) or shows footage (`wide`). */
  width?: PageWidth;
  /** The bar names the page with a plain line where the page has its own heading (message pages). */
  titleAs?: 'h1' | 'p';
  children?: ReactNode;
  className?: string;
}

/**
 * The frame of every page in the main area. Its name is the window bar's
 * title (the page's h1, DESIGN.md "Window"), never repeated in the content;
 * its actions sit in the bar on the column's right edge; the content starts
 * with its views, then the description, if there is one. One gutter and one
 * rhythm: 24 px under the bar, 32 px between blocks.
 */
export function Page({
  title,
  detail,
  description,
  actions,
  views,
  width,
  titleAs = 'h1',
  children,
  className,
}: PageProps) {
  useDocumentTitle(title);
  // A page still passing its width as a max-w class (Templates, Library, the clip page until Phase 2) keeps it.
  const legacy = splitLegacyWidth(className);
  return (
    <PageColumn
      width={width ?? legacy.measure ?? 'standard'}
      className={cn('flex flex-col gap-8 pt-6 pb-10', legacy.className)}
    >
      <ToolbarTitle title={title} as={titleAs} {...(detail ? { detail } : {})} />
      {actions ? <ToolbarActions>{actions}</ToolbarActions> : null}
      {views ? (
        <div data-slot="page-views" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {views}
        </div>
      ) : null}
      {description ? <p className="m-0 max-w-[65ch] type-prose text-ink-2">{description}</p> : null}
      {children}
    </PageColumn>
  );
}
