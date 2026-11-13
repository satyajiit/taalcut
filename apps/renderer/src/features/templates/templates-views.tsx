// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Templates' views (UX4 tpl) · system: DESIGN.md v0.6 + UX4 (the kit's ViewLinks;
 *   design-tpl.md, "a page does one job")
 * the Templates area's four jobs as the kit's ViewLinks, in Page's views slot: Your templates (the list), New (make
 *   one from a reel or a file), Start from… (starters, formats, community) and Saved on Instagram, each led by its
 *   glyph. Each is its own page, so Back, the crumb and ⌘[ work as for any page; the thumb glides between them and
 *   the page under it swaps at once (the shell's page turn skips a view press). A folder of yours is Your templates
 *   too, so the first view stays current there
 * states: the kit's ViewLink: default · hover · focus-visible · active (gives by 2 %) · current; disabled, loading,
 *   error, success: n/a (links to pages; each page names its own)
 */
import { useLingui } from '@lingui/react/macro';
import { ViewLink, ViewLinks } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { TEMPLATE_ICONS } from './template-icons';

export type TemplatesView = 'mine' | 'new' | 'start' | 'saved';

/** Where you are in Templates, and the way to its other three jobs. `children` sit at the row's other end. */
export function TemplatesViews({ current, children }: { current: TemplatesView; children?: ReactNode }) {
  const { t } = useLingui();
  return (
    <div
      className="flex min-w-0 flex-1 basis-full flex-wrap items-center justify-between gap-x-4 gap-y-3"
      data-slot="templates-views-row"
    >
      <ViewLinks label={t`Templates`} data-slot="templates-views">
        <ViewLink asChild current={current === 'mine'} icon={TEMPLATE_ICONS.mine}>
          <Link activeOptions={{ exact: true }} to="/templates">{t`Your templates`}</Link>
        </ViewLink>
        <ViewLink asChild current={current === 'new'} icon={TEMPLATE_ICONS.new}>
          <Link activeOptions={{ exact: true }} to="/templates/new">{t`New`}</Link>
        </ViewLink>
        <ViewLink asChild current={current === 'start'} icon={TEMPLATE_ICONS.startFrom}>
          <Link activeOptions={{ exact: true }} to="/templates/start">{t`Start from…`}</Link>
        </ViewLink>
        <ViewLink asChild current={current === 'saved'} icon={TEMPLATE_ICONS.saved}>
          <Link activeOptions={{ exact: true }} to="/templates/saved">{t`Saved on Instagram`}</Link>
        </ViewLink>
      </ViewLinks>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
