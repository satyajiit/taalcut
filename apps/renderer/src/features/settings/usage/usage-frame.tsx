// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the frame of a Usage view (UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * one Settings page per view: the bar reads "Usage" on the overview and "Usage › Breakdown" on the others (the
 *   view's name is the page's detail, as the phone flow's tabs are); the views and the filter bar under the bar;
 *   then the view's sections, 40 px apart. The empty case (nothing ever called a model) is the kit's EmptyState
 *   with Kaatu, and the one way to fill it: Start a chat. A cap can still be set before anything is spent, so the
 *   line points at Budgets.
 * states: n/a (a frame; its sections carry theirs) */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, EmptyState, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsPage } from '../settings-page';
import { UsageViews, type UsageViewId } from './usage-views';

/** The bar's detail for each view but the overview, which is Usage itself. */
function useViewName(view: UsageViewId): string | null {
  const { t } = useLingui();
  switch (view) {
    case 'overview':
      return null;
    case 'breakdown':
      return t`Breakdown`;
    case 'budgets':
      return t`Budgets`;
    case 'requests':
      return t`Requests`;
  }
}

export function UsageFrame({
  current,
  filters,
  description,
  children,
}: {
  current: UsageViewId;
  /** The period and filter bar, for the views it scopes. */
  filters?: ReactNode;
  /** One sentence under the views: what this view is for. */
  description?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const detail = useViewName(current);
  return (
    <SettingsPage
      title={t`Usage`}
      {...(detail ? { detail } : {})}
      {...(description ? { description } : {})}
      views={<UsageViews current={current}>{filters}</UsageViews>}
    >
      {children}
    </SettingsPage>
  );
}

/** Nothing ever called a model: what will be here, and the one way to fill it. */
export function NothingYet() {
  return (
    <EmptyState
      icon={SETTINGS_ICONS.usage}
      title={<Trans>Nothing has used a model yet</Trans>}
      description={
        <Trans>
          When one is, what it cost and where it went shows here. You can set a budget before anything is
          spent.
        </Trans>
      }
      action={
        <Button asChild icon={VERB_ICONS.newChat}>
          <Link to="/chat">
            <Trans>Start a chat</Trans>
          </Link>
        </Button>
      }
    />
  );
}
