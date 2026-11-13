// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Make views (UX4) · system: DESIGN.md v0.6 + UX4 (the kit's ViewLinks)
 * the Make area's four views as the kit's ViewLinks, in Page's views slot: Projects, Exports, Archived and Your
 *   style, each led by its concept's icon. The current one sits on the shared thumb (aria-current="page"), which
 *   glides there from the last view's place; each is its own page, so Back, the crumb and ⌘[ work as for any page
 * states: the kit's ViewLink: default · hover · focus-visible · active (gives by 2 %) · current; disabled, loading,
 *   error, success: n/a (links to pages; each page names its own)
 */
import { useLingui } from '@lingui/react/macro';
import { CONCEPT_ICONS, ViewLink, ViewLinks } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export type MakeView = 'projects' | 'exports' | 'archived' | 'style';

/** Projects, Exports, Archived and Your style: where you are in Make, and the way to the others. */
export function MakeViews({ current, className }: { current: MakeView; className?: string }) {
  const { t } = useLingui();
  return (
    <ViewLinks label={t`Make`} data-slot="make-views" className={className}>
      <ViewLink asChild current={current === 'projects'} icon={CONCEPT_ICONS.project}>
        <Link activeOptions={{ exact: true }} to="/projects" search={{}}>
          {t`Projects`}
        </Link>
      </ViewLink>
      <ViewLink asChild current={current === 'exports'} icon={CONCEPT_ICONS.export}>
        <Link activeOptions={{ exact: true }} to="/renders">{t`Exports`}</Link>
      </ViewLink>
      <ViewLink asChild current={current === 'archived'} icon={CONCEPT_ICONS.archived}>
        <Link activeOptions={{ exact: true }} to="/projects" search={{ archived: true }}>
          {t`Archived`}
        </Link>
      </ViewLink>
      <ViewLink asChild current={current === 'style'} icon={CONCEPT_ICONS.styleProfile}>
        <Link activeOptions={{ exact: true }} to="/projects/style">{t`Your style`}</Link>
      </ViewLink>
    </ViewLinks>
  );
}

/** The current list's count after the views, with its place kept by a bone while it loads (no jump). */
export function ViewCount({ children }: { children: ReactNode | null }) {
  return children === null ? (
    <span aria-hidden data-slot="view-count" className="tc-bone block h-3 w-20 rounded-sm bg-hover" />
  ) : (
    <span data-slot="view-count" className="type-meta text-ink-2 tabular-nums">
      {children}
    </span>
  );
}
