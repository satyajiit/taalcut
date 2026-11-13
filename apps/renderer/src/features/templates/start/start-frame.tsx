// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page frame: Start from… (/templates/start, /formats, /community; UX4 tpl) · system: DESIGN.md
 *   v0.6 + UX4 (Page, ViewLinks, PageTip; design-tpl.md)
 * the owner's one place for everything ready-made (2026-10-28): the area's views first, a first-visit tip, then
 *   this place's own views (Starters, Formats, Community: links, each its own page, so Back and the URL hold the
 *   view), one sentence on the open view, and its cards. The window bar reads "Templates › Start from…" on the
 *   starters, "Templates › Start from… › Formats" (or › Community) on the others: the views' own crumbs.
 *   Every card ends the same way: Use for a video, or Copy to my templates (start-card.tsx)
 * states: each view's (starters-row.tsx, formats.tsx, hub-page.tsx); the tip shows until it is dismissed
 * motion: both views' thumbs glide; the page under them swaps at once
 */
import { useLingui } from '@lingui/react/macro';
import { ViewLink, ViewLinks } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { PageTip } from '../../kaatu/page-tip';
import { Page } from '../../../shell/page';
import { TEMPLATE_ICONS } from '../template-icons';
import { TemplatesViews } from '../templates-views';

export type StartView = 'starters' | 'formats' | 'community';

function StartViews({ current }: { current: StartView }) {
  const { t } = useLingui();
  return (
    // The kit's own slot (view-links): the shell's page turn knows a view switch by it and lets the cards swap at once.
    <ViewLinks label={t`Start from…`}>
      <ViewLink asChild current={current === 'starters'} icon={TEMPLATE_ICONS.starter}>
        <Link activeOptions={{ exact: true }} to="/templates/start">{t`Starters`}</Link>
      </ViewLink>
      <ViewLink asChild current={current === 'formats'} icon={TEMPLATE_ICONS.format}>
        <Link activeOptions={{ exact: true }} to="/templates/start/formats">{t`Formats`}</Link>
      </ViewLink>
      <ViewLink asChild current={current === 'community'} icon={TEMPLATE_ICONS.community}>
        <Link activeOptions={{ exact: true }} to="/templates/start/community">{t`Community`}</Link>
      </ViewLink>
    </ViewLinks>
  );
}

export function StartFrame({
  view,
  tip = true,
  children,
}: {
  view: StartView;
  /** Off while the view is an empty state of its own (the community when it can't be reached): it teaches. */
  tip?: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const name = { starters: t`Starters`, formats: t`Formats`, community: t`Community` }[view];
  const line = {
    starters: t`Template shapes made for one kind of footage: a trip, a day, a tip to camera. Taalcut fills them with your clips.`,
    formats: t`No reel to copy? Pick a format and Taalcut plans the cuts itself, in a new chat.`,
    community: t`Templates other people shared: the cuts, the beats and where text goes, never their videos. Free to use and change.`,
  }[view];
  return (
    // The starters are Start from… itself; another view is a page under it, so the bar names it after the crumb.
    <Page
      title={view === 'starters' ? t`Start from…` : name}
      width="wide"
      views={<TemplatesViews current="start" />}
    >
      <div className="flex flex-col gap-6" data-slot="start-from" data-view={view}>
        {tip ? (
          <PageTip id="templates-start">
            {t`Use for a video starts a chat that makes one with it. Copy keeps it in Your templates to change first.`}
          </PageTip>
        ) : null}
        <div className="flex flex-col gap-3">
          <StartViews current={view} />
          <h2 className="sr-only">{name}</h2>
          <p className="m-0 max-w-prose type-body text-ink-2" data-slot="start-line">
            {line}
          </p>
        </div>
        {children}
      </div>
    </Page>
  );
}
