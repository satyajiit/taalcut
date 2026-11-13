// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage's views (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (the kit's ViewLinks, _orch/ux4/specs/design-set.md)
 * Usage by task, each its own page: Overview (what it cost and what is limited now), Breakdown (where it went),
 *   Budgets (what may be spent) and Requests (every call). The period and the filters are the URL's, so they come
 *   along from view to view; the filter bar sits on the views' row, under the pill, because it scopes every view
 *   but Budgets
 * states: the kit's ViewLink: default · hover · focus-visible · active (gives by 2 %) · current; disabled, loading,
 *   error, success: n/a (links to pages; each page names its own) */
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SettingsViews, type SettingsViewItem } from '../settings-page';
import { SETTINGS_ICONS } from '../settings-icons';

export type UsageViewId = 'overview' | 'breakdown' | 'budgets' | 'requests';

/** Usage's four views, with the filter bar (`children`) under them when the view is scoped by it. */
export function UsageViews({ current, children }: { current: UsageViewId; children?: ReactNode }) {
  const { t } = useLingui();
  // `search` kept: the period and filters travel with you, and Budgets leaves them in place for the way back.
  const views: SettingsViewItem[] = [
    {
      id: 'overview',
      label: t`Overview`,
      icon: SETTINGS_ICONS.overview,
      link: (
        <Link to="/settings/usage" search={true}>
          {t`Overview`}
        </Link>
      ),
    },
    {
      id: 'breakdown',
      label: t`Breakdown`,
      icon: SETTINGS_ICONS.breakdown,
      link: (
        <Link to="/settings/usage/breakdown" search={true}>
          {t`Breakdown`}
        </Link>
      ),
    },
    {
      id: 'budgets',
      label: t`Budgets`,
      icon: SETTINGS_ICONS.budgets,
      link: (
        <Link to="/settings/usage/budgets" search={true}>
          {t`Budgets`}
        </Link>
      ),
    },
    {
      id: 'requests',
      label: t`Requests`,
      icon: SETTINGS_ICONS.requests,
      link: (
        <Link to="/settings/usage/requests" search={true}>
          {t`Requests`}
        </Link>
      ),
    },
  ];
  return (
    <div data-slot="usage-views-row" className="flex min-w-0 flex-1 basis-full flex-col items-start gap-3">
      <SettingsViews label={t`Usage`} current={current} views={views} />
      {children}
    </div>
  );
}
