// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: page head · mode: Persuade/Read · system: WEB2 Remix Vernacular
 * states: resting (server HTML, every word shown) · without JavaScript (resting). Not a control; what a page puts in
 *   it carries its own states, and its art its own motion.
 * The top of a content page (/ai, /faq, /about, /press, the legal pages): the h1 in the site's display type on its own
 * (no icon tile beside it), the answer-first lead, the page's own controls under it (a search, a copy button, the date
 * a notice changed), and the page's art on the right from 1024 px up (stickers, Kaatu, a mark), stacked under the
 * words below that. Above the fold at load, so nothing here waits to arrive: the art carries the life (Kaatu's act,
 * stickers leaning to the pointer). `compact` is the reading pages' smaller head. */

import type { ReactNode } from 'react';
import { cn } from '#lib/cn';

export interface PageHeadProps {
  readonly title: string;
  readonly lead: ReactNode;
  /** Under the lead: the page's own controls. */
  readonly children?: ReactNode;
  /** The right-hand art: stickers, Kaatu, a mark. Decorative parts mark themselves aria-hidden. */
  readonly art?: ReactNode;
  /** The smaller head of a reading page (the legal pages). */
  readonly compact?: boolean;
  readonly className?: string;
}

export function PageHead({ title, lead, children, art, compact = false, className }: PageHeadProps) {
  return (
    <header data-slot="page-head" className={cn('px-gutter pt-12 sm:pt-16', compact ? 'pb-10 sm:pb-12' : 'pb-section-bottom', className)}>
      <div
        className={cn(
          'mx-auto grid max-w-site items-center gap-x-12 gap-y-12',
          art ? 'lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]' : '',
        )}
      >
        <div className="flex min-w-0 flex-col">
          <h1 className={cn('max-w-[14ch] text-balance text-ink', compact ? 'type-site-headline' : 'type-site-display')}>{title}</h1>
          <p className="mt-6 max-w-[36em] type-site-lead text-pretty text-ink-2">{lead}</p>
          {children ? <div className="mt-8 flex flex-col gap-4">{children}</div> : null}
        </div>
        {art ? <div className="relative min-w-0">{art}</div> : null}
      </div>
    </header>
  );
}
