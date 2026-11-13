// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: sidebar row (link) · genre: atmospheric studio app · system: DESIGN.md v0.3
 * open: icon, word, and optional shortcut; on the rail: the icon in a 40 px square, its name in a tooltip
 * motion: the current row's raised mark glides in from the last one (CurrentIndicator) and its icon ticks once
 *   (ActivationTick); the hover mark glides between sibling rows (HoverIndicator); the word fades with the fold (FoldLabel)
 * states: default · hover (gliding hover surface, ink) · focus (base ring, instant) · active (pressed surface) ·
 *   current (raised mark, ink, the area's accent on its icon) · disabled: n/a (links) ·
 *   loading/error/success: n/a (navigation)
 */
import {
  ActivationTick,
  cn,
  CurrentIndicator,
  FoldFade,
  FoldLabel,
  HoverIndicator,
  RailTooltip,
  ShortcutKeys,
  useSidebarFold,
} from '@taalcut/ui';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { MouseEvent } from 'react';

export interface NavItemProps {
  to: LinkProps['to'];
  icon: LucideIcon;
  label: string;
  active: boolean;
  /** The area's accent for its icon: shown only while the area is the current one (DESIGN.md, A4). */
  iconClass?: string;
  /** Optional keyboard shortcut shown on the right when open and in the rail tooltip. */
  shortcut?: string;
  /** Shared hover-glide scope. */
  scope?: string;
  /** A row in a dense list: slightly smaller height. */
  compact?: boolean;
  /**
   * Current only on its own path, not under it: the router otherwise marks a
   * link current on every page below it.
   */
  exact?: boolean;
  /** Runs before the link goes: one that steps back through history instead cancels it (Settings' Back to app). */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
}

/** A sidebar row: icon plus word, or on the rail the icon alone. */
export const NAV_ITEM_CLASS = cn(
  'group/row relative flex h-[2.125rem] w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-md px-3 type-label text-ink-2 no-underline',
  'transition-[color,scale] duration-(--dur-micro) ease-(--ease-out) hover:text-ink',
  // Press feedback (UX4): the row gives by 2 %, as the kit's buttons do, and its hover mark takes the pressed tone.
  'active:scale-[0.98] motion-reduce:active:scale-100',
);

/** On the rail a row is the icon's square, centred on the rail, at the open row's height (nothing moves up or down). */
export const RAIL_ITEM_CLASS = 'w-10 justify-center gap-0 px-0';

/**
 * A sidebar link: icon plus word, with the raised mark when it is the current
 * page. Only the current area's icon takes its accent; the rest stay ink-3,
 * and so does the current one while the window is not the active one.
 */
export function NavItem({
  to,
  icon: Icon,
  label,
  active,
  iconClass,
  shortcut,
  scope = 'sidebar',
  compact = false,
  exact = false,
  onClick,
  className,
}: NavItemProps) {
  const { rail } = useSidebarFold();
  return (
    <RailTooltip label={label} {...(shortcut ? { shortcut } : {})} disabled={!rail}>
      <Link
        to={to}
        {...(exact ? { activeOptions: { exact: true } } : {})}
        aria-current={active ? 'page' : undefined}
        {...(onClick ? { onClick } : {})}
        className={cn(
          NAV_ITEM_CLASS,
          'aria-[current=page]:text-ink',
          compact && 'h-8 gap-2 text-sm',
          rail && RAIL_ITEM_CLASS,
          className,
        )}
      >
        {active ? <CurrentIndicator scope={scope} /> : <HoverIndicator scope={scope} />}
        <ActivationTick active={active}>
          <Icon
            aria-hidden
            className={cn(
              'shrink-0 transition-colors duration-(--dur-micro) ease-(--ease-out) window-inactive:text-ink-3',
              compact ? 'size-3.5' : 'size-4',
              active ? (iconClass ?? 'text-primary-strong') : 'text-ink-3 group-hover/row:text-ink-2',
            )}
          />
        </ActivationTick>
        <FoldLabel className="relative flex-1">{label}</FoldLabel>
        {shortcut ? (
          <FoldFade className={cn('relative shrink-0', rail && 'hidden')}>
            <ShortcutKeys accelerator={shortcut} />
          </FoldFade>
        ) : null}
      </Link>
    </RailTooltip>
  );
}
