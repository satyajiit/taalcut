// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: card-frame · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (A3; UX round 1: the title at the card size, text-lg 700) · states: n/a (static frame; its
 *   buttons carry the eight states) */

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '#lib/cn';

export interface CardFrameProps extends Omit<ComponentProps<'article'>, 'title'> {
  /** The card's `type`, for tests and styling hooks. */
  cardType: string;
  /** Optional, small and neutral. Decision cards don't need one: the title says it. */
  icon?: ReactNode;
  title: ReactNode;
  /** A status chip or similar, at the right of the title. */
  aside?: ReactNode;
}

/**
 * The frame for the cards that ask you to decide (DESIGN.md v0.2, A3):
 * approval, consent and cost. A hairline all round on the raised surface,
 * xl radius, no shadow, no edge, no wash. Nothing else in the chat is a card,
 * and a card never holds another card.
 */
export function CardFrame({ cardType, icon, title, aside, className, children, ...props }: CardFrameProps) {
  return (
    <article
      data-slot="smart-card"
      data-card-type={cardType}
      className={cn(
        'flex max-w-[42rem] flex-col gap-3 rounded-xl border border-rule bg-raised p-4 text-ink',
        className,
      )}
      {...props}
    >
      <header className="flex items-start gap-2">
        {icon ? (
          <span aria-hidden className="mt-1 inline-flex shrink-0 text-ink-3 [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <h3 className="m-0 min-w-0 flex-1 text-lg font-bold text-balance">{title}</h3>
        {aside ? <div className="flex min-h-6 shrink-0 items-center gap-2">{aside}</div> : null}
      </header>
      {children}
    </article>
  );
}

/** Text the model or the user wrote: shown as is, never translated. */
export function UserContent({ className, ...props }: ComponentProps<'span'>) {
  const truncates = typeof className === 'string' && /\btruncate\b/.test(className);
  return (
    <span
      data-user-content
      className={cn(
        truncates ? 'whitespace-nowrap' : 'whitespace-pre-wrap in-[.truncate]:whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}
