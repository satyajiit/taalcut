// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: view links (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + the UX4 motion grammar (_orch/ux4/specs/design-kit.md)
 * an area's views as one segmented pill made of links, first on each of their pages: Make's Projects, Exports and
 *   Archived; Templates' three lists; the phone flow's tabs. Each view is a page, so Back, the crumb and ⌘[ work as
 *   for any page. Each is led by its concept's icon and may carry a count. The current one sits on the shared
 *   raised thumb with a rule-strong edge (3:1 in dark) and is aria-current="page"; the thumb glides between views
 *   on transform, and a pill rebuilt on the next page starts where the last one was, so it glides there too.
 *   Router-free: each view is the caller's own link element, given with `asChild`.
 * states: default (ink-2, icon ink-3) · hover (ink, icon ink-2) · focus-visible (the base ring, instant) · active
 *   (pressed: gives by 2 %) · current (the thumb, ink, aria-current="page") · disabled, loading, error, success: n/a
 *   (links to pages; each page names its own state)
 * contrast: ink-2 on sunken ≥ 7:1; ink on raised ≥ 7:1; the thumb's rule-strong edge ≥ 3:1 on sunken in both themes
 * reduced motion: the thumb moves at once and a press doesn't scale (base.css, motion-reduce) */
import { useLingui } from '@lingui/react/macro';
import { Slot } from 'radix-ui';
import { Children, isValidElement, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { PRESS_CONTROL } from '#lib/motion-classes';
import { renderIcon, type IconLike } from '../icons/glyph';
import { SegmentThumb, useThumb } from './segment-thumb';

export interface ViewLinksProps extends Omit<ComponentProps<'nav'>, 'aria-label'> {
  /** The navigation's name: the area's ("Make", "Templates", "From your phone"). */
  label: string;
  /** Keep the thumb's place across pages under this name; defaults to `label`. */
  memory?: string;
  children: ReactNode;
}

/**
 * An area's views as one pill of links (`<nav>` › `<ul>`), with the gliding thumb under the current one.
 * The nav is `data-slot="view-links"` and always carries `data-view-links`, the hook the shell's page turn reads (a
 * navigation that starts here glides the thumb and swaps the page at once). A row that predates the kit may keep its
 * own `data-slot` for its specs (make-views, templates-views, phone-tabs); `data-view-links` stays.
 */
export function ViewLinks({ label, memory, className, children, ...props }: ViewLinksProps) {
  const list = useRef<HTMLUListElement>(null);
  const thumb = useThumb(list, '[data-view-current]', memory ?? label);
  return (
    <nav
      aria-label={label}
      data-slot="view-links"
      className={cn('max-w-full', className)}
      {...props}
      data-view-links=""
    >
      <ul
        ref={list}
        className="relative m-0 inline-flex max-w-full list-none flex-wrap items-center gap-0.5 rounded-pill border border-rule bg-sunken p-0.5"
      >
        {thumb ? <SegmentThumb as="li" {...thumb} /> : null}
        {Children.map(children, (child) =>
          isValidElement(child) ? <li className="flex">{child}</li> : child,
        )}
      </ul>
    </nav>
  );
}

export interface ViewLinkProps extends Omit<ComponentProps<'a'>, 'children'> {
  /** This view is the open page: the thumb sits under it and it is `aria-current="page"`. */
  current?: boolean;
  /** Its concept's glyph from the icon registry (16 px), before the words. */
  icon?: IconLike;
  /** How many are in the view, or on their way (a number is formatted for the language); hidden when 0. */
  count?: number | ReactNode;
  /** Render your router's link as the view (its own children are the words), with this look and these props. */
  asChild?: boolean;
  children: ReactNode;
}

const VIEW = cn(
  // Positioned, so its words paint above the thumb.
  'group/view relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill px-3 type-label whitespace-nowrap',
  PRESS_CONTROL,
  '[&_svg]:shrink-0',
);
const CURRENT = 'text-ink [&_[data-slot=glyph]]:text-ink-2';
const OTHER =
  'text-ink-2 hover:text-ink [&_[data-slot=glyph]]:text-ink-3 hover:[&_[data-slot=glyph]]:text-ink-2';

/** One view in a ViewLinks pill. */
export function ViewLink({
  current = false,
  icon,
  count,
  asChild = false,
  className,
  children,
  ...props
}: ViewLinkProps) {
  const { i18n } = useLingui();
  const shown = typeof count === 'number' ? (count > 0 ? i18n.number(count) : null) : (count ?? null);
  const Root = asChild ? Slot.Root : 'a';
  return (
    <Root
      aria-current={current ? 'page' : undefined}
      data-view-current={current || undefined}
      data-slot="view-link"
      className={cn(VIEW, current ? CURRENT : OTHER, className)}
      {...props}
    >
      {renderIcon(icon, 'md')}
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : children}
      {shown !== null ? (
        <span
          data-slot="view-link-count"
          className="min-w-5 rounded-pill bg-chip px-1.5 text-center type-caption text-ink tabular-nums"
        >
          {shown}
        </span>
      ) : null}
    </Root>
  );
}
