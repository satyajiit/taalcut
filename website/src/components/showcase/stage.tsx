// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a feature's showcase stage · mode: Operate · system: WEB2 Remix Vernacular
 * states: n/a (a frame; the reel and the app window in it carry their own states)
 * Where a feature works: the section's h2 beside its icon chip and one line on how to use what is below, then the
 * stage. A feature about a reel stands its reel (9:16, playing, its segment bar on top) beside the coded app window;
 * on a wide screen the reel stays in view beside the window as you work, on a narrow one it sits above it. */

import { MousePointerClick } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { SHOWCASE_HINTS } from './hints';
import { Rise } from './rise';

export function ShowcaseSection({
  id,
  slug,
  children,
}: {
  readonly id: string;
  readonly slug: string;
  readonly children: ReactNode;
}) {
  const words = SHOWCASE_HINTS[slug];
  if (!words) return null;
  const { title, hint } = words;
  const HintIcon = MousePointerClick;
  return (
    <section aria-labelledby={id} className="px-gutter pb-section-bottom">
      <div className="mx-auto max-w-site">
        <Rise className="mb-8 grid grid-cols-1 gap-x-10 gap-y-3 lg:grid-cols-12 lg:items-end">
          <h2 id={id} className="m-0 flex items-center gap-3 type-site-subhead text-ink lg:col-span-5">
            {title}
          </h2>
          <p className="m-0 flex max-w-[46em] items-start gap-2.5 type-site-body text-ink-2 lg:col-span-7 lg:justify-self-end">
            <span aria-hidden className="inline-flex h-[1lh] shrink-0 items-center text-ink-3">
              <HintIcon strokeWidth={ICON_STROKE} className="size-5" />
            </span>
            <span>{hint}</span>
          </p>
        </Rise>
        {children}
      </div>
    </section>
  );
}

/** The reel and the window side by side on a wide screen, the reel above on a narrow one. */
export function StageGrid({
  reel,
  children,
  className,
}: {
  readonly reel?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 items-start gap-10 xl:gap-14',
        reel ? 'xl:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)]' : undefined,
        className,
      )}
    >
      {reel ? <div className="mx-auto w-[min(15rem,62vw)] xl:sticky xl:top-24 xl:w-full">{reel}</div> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
