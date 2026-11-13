// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › Accounts › Connected (UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the answer to "do I even need this?" first (PRODUCT.md, principle 4): one SettingRows list of what Taalcut can use
 *   right now (the ChatGPT plan, each plan signed in, each key saved with how it did, each server in use), every
 *   row a link to the view that manages it; with nothing connected, Kaatu and one line say so, with the quickest
 *   way in (Continue with ChatGPT) and the other (a key). Then Instagram as one row: its sign-in lives in
 *   Templates › Saved, so this row only says how it stands and goes there.
 * states: loading (the named skeleton) · error (the frame's) · nothing connected (the empty state) · connected (the
 *   rows) · signing in (Continue with ChatGPT spins; the frame's polite line when it lands)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { AccountsState } from '@taalcut/core';
import { Button, CONCEPT_ICONS, Chip, EmptyState, PageSection, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { providerName, SUBSCRIPTION_NAMES } from '../providers';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { AccountsBones } from './accounts-bones';
import { AccountsPage } from './accounts-page';
import { KeyStatus } from './api-keys';
import { InstagramRow } from './instagram-row';
import { CONTINUE, ProviderMark, USING_PLAN } from './sign-ins';
import { useAccounts, type Accounts } from './use-accounts';

const signedIn = (
  <Chip tone="success">
    <Trans>Signed in</Trans>
  </Chip>
);

/** Everything that connects Taalcut to a cloud model right now, each row a way to the view that manages it. */
function ConnectedRows({ state }: { state: AccountsState }) {
  const { t, i18n } = useLingui();
  const rows: ReactNode[] = [];
  if (state.chatgpt.signedIn)
    rows.push(
      <SettingRow
        key="chatgpt"
        icon={<ProviderMark provider="openai-codex" />}
        title={<Trans>ChatGPT Plus, Pro &amp; Team</Trans>}
        description={i18n._(USING_PLAN)}
        status={signedIn}
        action={<Link to="/settings/accounts/subscriptions" />}
      />,
    );
  for (const sub of state.subscriptions.filter((plan) => plan.signedIn)) {
    const name = SUBSCRIPTION_NAMES[sub.provider];
    rows.push(
      <SettingRow
        key={sub.provider}
        icon={<ProviderMark provider={sub.provider} />}
        title={name ? i18n._(name) : sub.provider}
        description={<Trans>Your plan, signed in</Trans>}
        status={signedIn}
        action={<Link to="/settings/accounts/subscriptions" />}
      />,
    );
  }
  for (const key of state.apiKeys.filter((row) => row.configured)) {
    const name = providerName(i18n, key.provider);
    rows.push(
      <SettingRow
        key={`key-${key.provider}`}
        icon={<ProviderMark provider={key.provider} />}
        title={<span translate={name ? undefined : 'no'}>{name ?? key.provider}</span>}
        description={<Trans>API key</Trans>}
        status={<KeyStatus row={key} />}
        action={<Link to="/settings/accounts/keys" />}
      />,
    );
  }
  for (const server of state.localServers.filter((row) => row.baseUrl)) {
    rows.push(
      <SettingRow
        key={`server-${server.kind}`}
        icon={<ProviderMark provider={server.kind} />}
        title={providerName(i18n, server.kind) ?? server.kind}
        description={<span translate="no">{server.baseUrl}</span>}
        status={
          <Chip tone="neutral">
            <Trans>In use</Trans>
          </Chip>
        }
        action={<Link to="/settings/accounts/servers" />}
      />,
    );
  }
  return rows.length > 0 ? <SettingRows aria-label={t`Connected accounts`}>{rows}</SettingRows> : null;
}

/** Nothing connects Taalcut to a cloud model yet: the quickest way in, and the other. */
function NothingConnected({ accounts }: { accounts: Accounts }) {
  const { i18n } = useLingui();
  const busy = accounts.pending === 'openai-codex';
  return (
    <EmptyState
      variant="page"
      titleAs="h3"
      title={<Trans>Nothing connected yet</Trans>}
      description={
        busy ? (
          <span role="status">
            <Trans>Finish signing in in your browser, then come back.</Trans>
          </span>
        ) : (
          <Trans>Cloud models need a sign-in or a key. Your ChatGPT plan is the quickest way in.</Trans>
        )
      }
      action={
        <>
          <Button
            variant="primary"
            icon={VERB_ICONS.signIn}
            loading={busy}
            onClick={() => void accounts.chatgpt.signIn('openai-codex')}
          >
            {i18n._(CONTINUE)}
          </Button>
          <Button asChild variant="secondary" icon={SETTINGS_ICONS.keys}>
            <Link to="/settings/accounts/keys">
              <Trans>Add an API key</Trans>
            </Link>
          </Button>
        </>
      }
    />
  );
}

/**
 * Settings › Accounts (P1-H5, PRD 8.3), its first view: what is connected now. Keys, subscriptions and your own
 * servers each have a view of their own; Instagram's sign-in lives in Templates › Saved.
 */
export function AccountsSettings() {
  const accounts = useAccounts();
  return (
    <AccountsPage
      view="connected"
      accounts={accounts}
      skeleton="settings-accounts"
      bones={<AccountsBones />}
      description={<Trans>Sign-ins and keys Taalcut uses to reach cloud models.</Trans>}
    >
      {(state) => (
        <>
          <PageSection
            icon={SETTINGS_ICONS.connected}
            title={<Trans>Connected now</Trans>}
            description={<Trans>What Taalcut can use right now. Open one to change it.</Trans>}
          >
            <ConnectedRows state={state} />
            {hasModelAccount(state) ? null : <NothingConnected accounts={accounts} />}
          </PageSection>
          {state.instagram ? (
            <PageSection
              icon={CONCEPT_ICONS.saved}
              title={<Trans>Saved on Instagram</Trans>}
              description={
                <Trans>The Reels you saved on Instagram, as templates. You sign in from Saved.</Trans>
              }
            >
              <InstagramRow instagram={state.instagram} />
            </PageSection>
          ) : null}
        </>
      )}
    </AccountsPage>
  );
}

/** Anything at all that reaches a cloud model: a plan, a key or a server of your own. */
function hasModelAccount(state: AccountsState): boolean {
  return (
    state.chatgpt.signedIn ||
    state.subscriptions.some((plan) => plan.signedIn) ||
    state.apiKeys.some((row) => row.configured) ||
    state.localServers.some((row) => Boolean(row.baseUrl))
  );
}
