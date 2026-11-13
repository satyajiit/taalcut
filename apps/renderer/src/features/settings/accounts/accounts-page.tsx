// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Settings › Accounts' frame (UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the four views of Accounts (Connected, Keys, Subscriptions, Servers) as the kit's ViewLinks under the bar, each its
 *   own page: Connected first, the answer to "do I even need this?"; the others are where each kind of sign-in is
 *   managed. Every view shares one frame: the stream's failure (Try again), the last call's failure, its named
 *   skeleton while the state first arrives, and one polite live line for what landed.
 * states: loading (the view's named skeleton) · error (LoadError with Try again) · a call failed (a danger notice) ·
 *   success (the polite line; the button's own tick) */
import { Trans, useLingui } from '@lingui/react/macro';
import type { AccountsState } from '@taalcut/core';
import { Skeleton } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { LoadError, Notice } from '../fields';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsPage, SettingsViews } from '../settings-page';
import type { Accounts } from './use-accounts';

export type AccountsView = 'connected' | 'keys' | 'subscriptions' | 'servers';

/** Accounts' views: what is connected, then keys, subscriptions and your own servers. */
export function AccountsViews({ current }: { current: AccountsView }) {
  const { t } = useLingui();
  return (
    <SettingsViews
      label={t`Accounts`}
      current={current}
      views={[
        {
          id: 'connected',
          label: t`Connected`,
          icon: SETTINGS_ICONS.connected,
          link: <Link to="/settings/accounts">{t`Connected`}</Link>,
        },
        {
          id: 'keys',
          label: t`Keys`,
          icon: SETTINGS_ICONS.keys,
          link: <Link to="/settings/accounts/keys">{t`Keys`}</Link>,
        },
        {
          id: 'subscriptions',
          label: t`Subscriptions`,
          icon: SETTINGS_ICONS.subscriptions,
          link: <Link to="/settings/accounts/subscriptions">{t`Subscriptions`}</Link>,
        },
        {
          id: 'servers',
          label: t`Servers`,
          icon: SETTINGS_ICONS.servers,
          link: <Link to="/settings/accounts/servers">{t`Servers`}</Link>,
        },
      ]}
    />
  );
}

/**
 * One view of Accounts: the shared frame, then the view's content once the state is in. `skeleton` names the
 * view's bones and draws them (`bones`) while the state first arrives.
 */
export function AccountsPage({
  view,
  accounts,
  skeleton,
  bones,
  description,
  children,
}: {
  view: AccountsView;
  accounts: Accounts;
  skeleton: string;
  bones: ReactNode;
  description?: ReactNode;
  children: (state: AccountsState) => ReactNode;
}) {
  const { t } = useLingui();
  const { stream } = accounts;
  const names: Record<Exclude<AccountsView, 'connected'>, string> = {
    keys: t`Keys`,
    subscriptions: t`Subscriptions`,
    servers: t`Servers`,
  };
  return (
    <SettingsPage
      title={t`Accounts`}
      {...(view === 'connected' ? {} : { detail: names[view] })}
      views={<AccountsViews current={view} />}
      description={description}
    >
      {stream.status === 'error' && !stream.data ? (
        <LoadError
          error={stream.error}
          onRetry={accounts.retry}
          what={<Trans>Accounts didn’t load.</Trans>}
        />
      ) : null}
      {accounts.failure ? (
        <Notice tone="danger" role="alert">
          {accounts.failure}
        </Notice>
      ) : null}
      <Skeleton name={skeleton} loading={stream.status === 'loading' && !stream.data} fixture={bones}>
        {stream.data ? (
          <div className="flex min-w-0 flex-col gap-10 [&>[data-slot=page-section]]:mt-0!">
            {children(stream.data)}
          </div>
        ) : null}
      </Skeleton>
      <p aria-live="polite" className="sr-only">
        {accounts.announcement}
      </p>
    </SettingsPage>
  );
}
