// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a showcase's region inside the app window, and a key as a hint names it · mode: Operate ·
 *   system: WEB2 Remix Vernacular
 * the app window is the frame now (components/ui/app-window): the region is the window's page, named for assistive
 *   technology, with the app's own padding and nothing drawn around it. The key is a keycap: the raised face, a
 *   heavier bottom edge, the mono figures
 * states: n/a (a frame and a label; what sits in them carries its own states) */

import type { ReactNode } from 'react';
import { cn } from '#lib/cn';

export function ShowcasePlate({
  label,
  slug,
  className,
  children,
}: {
  /** What the region shows, for assistive tech (a region's name). */
  readonly label: string;
  /** The feature it belongs to: the e2e tests find each showcase by it. */
  readonly slug: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      data-showcase={slug}
      className={cn('relative min-w-0 p-4 sm:p-5', className)}
    >
      {children}
    </div>
  );
}

/** A key as a hint names it, in the page's words or inside the window. */
export function Key({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-flex min-w-[1.6em] items-center justify-center rounded-md border border-rule-strong bg-raised shadow-sticker px-[0.35em] font-mono text-[0.85em] leading-[1.35] font-medium text-ink">
      {children}
    </kbd>
  );
}
