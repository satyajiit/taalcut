// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pages: Settings › Accounts › Keys, Subscriptions and Servers (UX4) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the three views where each kind of sign-in is managed, each one section in the Accounts frame: Keys (the seven
 *   providers, write-only), Subscriptions (ChatGPT, then the plans behind their warning), Servers (your own Ollama or
 *   LM Studio). A plan's "Use an API key instead" goes to Keys with that provider's form open.
 * states: the frame's (loading bones, error, a call's failure, the polite line) and each section's own */
import type { WarnedLogin } from '@taalcut/core';
import { useNavigate } from '@tanstack/react-router';
import { AccountsPage } from './accounts-page';
import { KeysBones, ServersBones, SubscriptionsBones } from './accounts-bones';
import { ApiKeys } from './api-keys';
import { LocalServers } from './local-servers';
import { ChatGptSignIn, SubscriptionSignIns } from './sign-ins';
import { useAccounts } from './use-accounts';

/** The API-key provider that is the safer choice for each warned login. */
const SAFER_KEY: Record<WarnedLogin, string | null> = {
  anthropic: 'anthropic',
  xai: 'xai',
  'github-copilot': null,
};

/** Accounts › Keys. `add` (from ?add=) opens that provider's form: a plan's safer choice lands here. */
export function KeysSettings({
  add,
  onAddChange,
}: {
  add: string | null;
  onAddChange: (provider: string | null) => void;
}) {
  const accounts = useAccounts();
  return (
    <AccountsPage view="keys" accounts={accounts} skeleton="settings-accounts-keys" bones={<KeysBones />}>
      {(state) => (
        <ApiKeys
          state={state}
          actions={accounts.keys}
          openProvider={add}
          onOpenProviderChange={onAddChange}
        />
      )}
    </AccountsPage>
  );
}

/** Accounts › Subscriptions. `openWarning` (a warning's feature, from ?warning=) opens that sign-in's card. */
export function SubscriptionsSettings({ openWarning }: { openWarning?: string | undefined }) {
  const accounts = useAccounts();
  const navigate = useNavigate();
  return (
    <AccountsPage
      view="subscriptions"
      accounts={accounts}
      skeleton="settings-accounts-subscriptions"
      bones={<SubscriptionsBones />}
    >
      {(state) => (
        <>
          <ChatGptSignIn state={state} actions={accounts.chatgpt} />
          <SubscriptionSignIns
            state={state}
            actions={accounts.plans}
            openWarning={openWarning}
            onUseApiKey={(provider) => {
              const safer = SAFER_KEY[provider];
              void navigate({ to: '/settings/accounts/keys', search: safer ? { add: safer } : {} });
            }}
          />
        </>
      )}
    </AccountsPage>
  );
}

/** Accounts › Servers: bring your own model server, which most people never need. */
export function ServersSettings() {
  const accounts = useAccounts();
  return (
    <AccountsPage
      view="servers"
      accounts={accounts}
      skeleton="settings-accounts-servers"
      bones={<ServersBones />}
    >
      {(state) => <LocalServers state={state} actions={accounts.servers} />}
    </AccountsPage>
  );
}
