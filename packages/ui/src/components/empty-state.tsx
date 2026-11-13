// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: empty-state (rebuilt, UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (Kaatu as companion; the one-Kaatu-per-screen limit is gone)
 * page: the shape of what will be here (children: a drop zone, ghost rows, a ghost timeline) above; then Kaatu
 *   (64 px, idle, dozing after a quiet minute) at the start of the words: the title, one line on what fills it, and
 *   the one action that does. Plain text on the canvas, left-aligned, no box, no icon tile (DESIGN.md, A10).
 * compact: a no-results row inside a list or a panel: the concept's glyph, one line, and its one way out ("Clear
 *   filters"); Kaatu only when asked for, then laid out as the shell's KaatuMoment is (Kaatu at the moment's 48 px on
 *   the row's edge, the line, the action after it), so Kaatu-with-words is one pattern. A wait, a success, a failure
 *   or a tip is a KaatuMoment itself, not an empty state.
 * Kaatu is the brand's `Kaatu`, which honours Show Kaatu: with it off, the words stay and the row closes up.
 * states: n/a (not a control; its action is a Button with the eight states). It arrives as a short cascade (8 px
 *   rise and fade, 40 ms apart); reduced motion: it is simply there.
 * Kaatu stays decorative (aria-hidden): the words carry the meaning. */
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';
import { Kaatu, type MascotMood } from '../brand/mascot';
import { useIdleMood } from '../brand/use-mascot-mood';
import { StaggerGroup, StaggerItem } from '../chat/react-bits-motion';
import { renderIcon, type IconLike } from '../icons/glyph';

export type EmptyStateTone = 'make' | 'library' | 'templates' | 'agent' | 'neutral';

// Only the small glyph takes the area's colour: no wash, no tile (DESIGN.md v0.2, A4 and A10).
const GLYPH: Record<EmptyStateTone, string> = {
  make: 'text-area-make-strong',
  library: 'text-area-library-strong',
  templates: 'text-area-templates-strong',
  agent: 'text-area-agent-strong',
  neutral: 'text-ink-3',
};

export interface EmptyStateProps {
  /** The concept's glyph from the icon registry, beside the title (compact: before the line). */
  icon?: IconLike;
  title: ReactNode;
  /** One or two sentences: what will appear here and how it gets here. Compact: optional, after the title. */
  description?: ReactNode;
  /** The one action that fills the page (PRD 9.4, rule 5), or the one way out of no results. */
  action?: ReactNode;
  tone?: EmptyStateTone;
  /** `page`: an empty area or section. `compact`: a no-results row in a list. */
  variant?: 'page' | 'compact';
  /** h2 under a page title; h1 when the empty state is the whole page; h3 inside a section. Page only. */
  titleAs?: 'h1' | 'h2' | 'h3';
  /** The shape of what will fill the page (a ghost timeline, a drop zone), shown above the words. Page only. */
  children?: ReactNode;
  /**
   * Kaatu beside the words: on by default on a page (idle, or the mood you give), off in a compact row unless
   * asked for. `false` leaves it out (a page that already has a moment of Kaatu).
   */
  kaatu?: boolean | MascotMood;
  /** @deprecated Pass `kaatu` (a mood) instead; a companion given here replaces the default Kaatu. */
  companion?: ReactNode;
  className?: string;
}

/** Kaatu at the empty-state spot: idle, dozing after a quiet minute, or the mood the page asks for. */
function EmptyKaatu({ mood, spot }: { mood: MascotMood | undefined; spot: 'empty' | 'moment' }) {
  const idle = useIdleMood();
  return <Kaatu spot={spot} mood={mood ?? idle} />;
}

const TITLE_ROLE = { h1: 'type-headline', h2: 'type-section', h3: 'type-card-title' } as const;
/** The line steps down with the title, so it never outranks it. */
const LINE_ROLE = { h1: 'type-prose', h2: 'type-prose', h3: 'type-body' } as const;

/**
 * Words for an empty page or a list with nothing in it: what will be here and the one action that fills it, with
 * Kaatu keeping you company. Plain text on the canvas, left-aligned, no box.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  variant = 'page',
  titleAs: Title = 'h2',
  children,
  kaatu,
  companion,
  className,
}: EmptyStateProps) {
  const mood = typeof kaatu === 'string' ? kaatu : undefined;
  if (variant === 'compact') {
    return (
      <div
        data-slot="empty-state"
        data-variant="compact"
        role="status"
        className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 py-3', className)}
      >
        {companion ?? (kaatu ? <EmptyKaatu mood={mood} spot="moment" /> : null)}
        <p className="m-0 flex min-w-0 flex-1 items-baseline gap-2 type-body text-ink">
          {icon ? (
            <span aria-hidden className={cn('inline-flex self-center [&_svg]:size-4', GLYPH[tone])}>
              {renderIcon(icon, 'md')}
            </span>
          ) : null}
          <span className="min-w-0">
            <span className="font-medium">{title}</span>
            {description ? <span className="text-ink-2"> {description}</span> : null}
          </span>
        </p>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    );
  }
  const showKaatu = kaatu !== false;
  return (
    <section data-slot="empty-state" data-variant="page" className={cn('flex flex-col gap-6', className)}>
      {children ? (
        <StaggerGroup>
          <StaggerItem>{children}</StaggerItem>
        </StaggerGroup>
      ) : null}
      <div className="flex items-start gap-5">
        {companion ?? (showKaatu ? <EmptyKaatu mood={mood} spot="empty" /> : null)}
        <StaggerGroup className="flex min-w-0 max-w-prose flex-col items-start gap-4">
          <StaggerItem className="flex flex-col gap-2">
            <Title className={cn('m-0 flex items-center gap-2 text-ink', TITLE_ROLE[Title])}>
              {icon ? (
                <span aria-hidden className={cn('inline-flex shrink-0 [&_svg]:size-5', GLYPH[tone])}>
                  {renderIcon(icon, 'lg')}
                </span>
              ) : null}
              {title}
            </Title>
            {description ? <p className={cn('m-0 text-ink-2', LINE_ROLE[Title])}>{description}</p> : null}
          </StaggerItem>
          {action ? <StaggerItem className="flex flex-wrap items-center gap-2">{action}</StaggerItem> : null}
        </StaggerGroup>
      </div>
    </section>
  );
}
