// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, another subscription · genre: atmospheric studio app · system: DESIGN.md v0.3
 * Claude, Copilot and Grok as Settings › Accounts' own rows (P1-F6): each opens the warning card first (PRD 10.1:
 *   what could happen, who bears the risk, the safer choice as one tap, I understand), then the browser.
 *   Never the default; never preselected.
 * states: the rows' and the warning card's own (default · hover · focus · active · disabled · loading while the
 *   browser is open · error (one line under the list, with the fix) · success (Signed in, announced))
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type AccountsState, type TaalcutError, type WarnedLogin } from '@taalcut/core';
import { ErrorLine } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { SubscriptionRow } from '../../../features/settings/accounts/sign-ins';

export function SubscriptionWay({
  state,
  online,
  onSignedIn,
  onUseApiKey,
}: {
  state: AccountsState;
  online: boolean;
  onSignedIn: () => void;
  /** The warning card's safer choice: an API key with that company instead. */
  onUseApiKey: (provider: WarnedLogin) => void;
}) {
  const { t } = useLingui();
  const backend = useBackend();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);

  const run = async (provider: string, call: () => Promise<unknown>, done?: () => void) => {
    setPending(provider);
    setError(null);
    const result = await callRpc(call());
    setPending(null);
    if (!result.ok) setError(result.error);
    else done?.();
  };

  if (!online)
    return (
      <p className="m-0 text-sm text-ink-2">
        {t({ id: 'onboarding.thinking.offline', message: 'Connect to the internet to sign in.' })}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 max-w-[56ch] text-sm text-ink-2">
        <Trans>
          These companies haven’t approved other apps signing in with their plans, so each one asks you to
          read a short warning first.
        </Trans>
      </p>
      <ul aria-label={t`Subscriptions`} className="m-0 flex list-none flex-col gap-2.5 p-0">
        {state.subscriptions.map((subscription) => (
          <SubscriptionRow
            key={subscription.provider}
            subscription={subscription}
            warningRequested={false}
            onUseApiKey={onUseApiKey}
            actions={{
              pending,
              signIn: (provider, acknowledgedAt) =>
                run(
                  provider,
                  () =>
                    backend.accounts.signIn({
                      provider: subscription.provider,
                      ...(acknowledgedAt === undefined ? {} : { acknowledgedAt }),
                    }),
                  onSignedIn,
                ),
              signOut: (provider) => run(provider, () => backend.accounts.signOut({ provider })),
            }}
          />
        ))}
      </ul>
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}
