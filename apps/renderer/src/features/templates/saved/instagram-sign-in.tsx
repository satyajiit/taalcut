// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the Instagram sign-in (Saved on Instagram; UX4 tpl) · system: DESIGN.md v0.6 + UX4
 *   (EmptyState with Kaatu)
 * the one place Taalcut signs in to Instagram: Saved on Instagram shows it while signed out, and Settings › Accounts
 *   links here instead of keeping a copy of its own (research C13). An empty state: Kaatu, what signing in gives
 *   you, that the session stays in the Mac's Keychain and each Reel's video and music stay with its template (REF1),
 *   and Sign in to Instagram. The first time, the warning card asks first (the risk, who bears it, the safer way: paste a link)
 * states: default (Sign in) · warning open (WarningCard, focused; Not now) · loading (Sign in spins) · error (the
 *   cause under it)
 */
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { INSTAGRAM_PROVIDER, INSTAGRAM_WARNING, type TaalcutError } from '@taalcut/core';
import {
  Button,
  EmptyState,
  ErrorLine,
  useAcknowledgement,
  VERB_ICONS,
  WarningCard,
  type AcknowledgementStore,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { translateKey } from '../../settings/model-messages';

export interface InstagramSignInProps {
  readonly ackStore: AcknowledgementStore;
  readonly signingIn: boolean;
  readonly error: TaalcutError | null;
  readonly onSignIn: (acknowledgedAt: number) => void;
  /** Open on the warning card (`?warning=` from Settings › Accounts or the agent), unless it was acknowledged. */
  readonly openWarning?: boolean;
}

export function InstagramSignIn({
  ackStore,
  signingIn,
  error,
  onSignIn,
  openWarning = false,
}: InstagramSignInProps) {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const ack = useAcknowledgement(ackStore, INSTAGRAM_WARNING.feature, INSTAGRAM_WARNING.termsVersion);
  const [warningOpen, setWarningOpen] = useState(openWarning);

  if (warningOpen) {
    return (
      <div data-slot="saved-signin" className="flex max-w-prose flex-col items-start gap-3">
        <WarningCard
          autoFocus
          topic={INSTAGRAM_WARNING.feature}
          termsVersion={INSTAGRAM_WARNING.termsVersion}
          store={ackStore}
          context={{ provider: INSTAGRAM_PROVIDER }}
          title={translateKey(
            i18n,
            INSTAGRAM_WARNING.titleKey,
            msg`Using your Instagram Saved collections in Taalcut`,
          )}
          risk={
            <>
              <p className="m-0">
                {translateKey(
                  i18n,
                  INSTAGRAM_WARNING.bodyKey,
                  msg`Taalcut signs in through an Instagram browser window on this Mac and reads your Saved collections with your browser session.`,
                )}
              </p>
              <p className="m-0 mt-2">
                {translateKey(
                  i18n,
                  INSTAGRAM_WARNING.riskKey,
                  msg`Instagram hasn’t approved other apps reading Saved collections this way. Pasting a public Reel link avoids signing in.`,
                )}
              </p>
            </>
          }
          bearer={
            <Trans>
              You do. It’s your Instagram account, and Taalcut can’t undo a sign-in challenge or limit.
            </Trans>
          }
          saferAlternative={{
            label: t`Paste a Reel link instead`,
            onSelect: () => {
              setWarningOpen(false);
              void navigate({ to: '/templates/new' });
            },
          }}
          onAcknowledged={(a) => {
            setWarningOpen(false);
            onSignIn(a.acknowledgedAt);
          }}
        />
        <Button variant="ghost" size="sm" onClick={() => setWarningOpen(false)}>
          <Trans>Not now</Trans>
        </Button>
      </div>
    );
  }

  return (
    <div data-slot="saved-signin">
      <EmptyState
        titleAs="h2"
        title={<Trans>Sign in to read your Saved collections</Trans>}
        description={
          <Trans>
            Sign in on instagram.com in a dedicated Taalcut window. Your session stays in your Mac’s Keychain,
            and each Reel’s video and music stay on this Mac with its template.
          </Trans>
        }
        action={
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="primary"
              icon={VERB_ICONS.signIn}
              loading={signingIn}
              onClick={() => {
                if (ack.status === 'acknowledged') {
                  void ack.acknowledge().then((a) => onSignIn(a.acknowledgedAt));
                } else {
                  setWarningOpen(true);
                }
              }}
            >
              <Trans>Sign in to Instagram</Trans>
            </Button>
            {error ? <ErrorLine error={error} /> : null}
          </div>
        }
      />
    </div>
  );
}
