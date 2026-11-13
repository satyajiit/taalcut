// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, Continue with ChatGPT · genre: atmospheric studio app · system: DESIGN.md v0.3
 * OpenAI's own words, word for word (PRD 8.3): the button, "Using ChatGPT plan" and "Manage usage". The browser
 *   opens; the panel waits with Cancel and Open it again; a browser that never comes back (5 minutes) folds the
 *   panel back with one line. Tokens stay in main; the page only learns "signed in".
 * states: default (Continue with ChatGPT, primary) · hover/focus/active (Button) · disabled (offline: the line says
 *   why) · loading (waiting for the browser: a status line, Cancel, Open it again) · error (ErrorLine with its fix)
 *   · success (the row says "Using ChatGPT plan", announced; the panel keeps Manage usage)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, CHATGPT_PROVIDER, type AccountsState, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine } from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { CONTINUE, MANAGE_USAGE } from '../../../features/settings/accounts/sign-ins';
import { BrowserLink } from '../../../chat/external-link';

/** No word from the browser for this long: the sign-in is given up and nothing is kept. */
const BROWSER_TIMEOUT_MS = 5 * 60_000;

type Phase = 'idle' | 'waiting' | 'timed-out';

export function ChatGptWay({
  state,
  online,
  onSignedIn,
}: {
  state: AccountsState;
  online: boolean;
  onSignedIn: () => void;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<TaalcutError | null>(null);
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => () => attempt.current?.abort(), []);

  const signIn = async () => {
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setPhase('waiting');
    setError(null);
    const timer = setTimeout(() => {
      controller.abort();
      setPhase('timed-out');
    }, BROWSER_TIMEOUT_MS);
    const result = await callRpc(
      backend.accounts.signIn({ provider: CHATGPT_PROVIDER }, { signal: controller.signal }),
    );
    clearTimeout(timer);
    // Cancelled, timed out or replaced by Open it again: that attempt's answer is no longer wanted.
    if (controller.signal.aborted) return;
    attempt.current = null;
    setPhase('idle');
    if (!result.ok) setError(result.error);
    else onSignedIn();
  };
  const cancel = () => {
    attempt.current?.abort();
    attempt.current = null;
    setPhase('idle');
  };

  // Signed in: the row says "Using ChatGPT plan"; the panel keeps OpenAI's own link.
  if (state.chatgpt.signedIn)
    return <BrowserLink href={state.chatgpt.manageUsageUrl}>{i18n._(MANAGE_USAGE)}</BrowserLink>;

  return (
    <div className="flex flex-col items-start gap-3">
      {online ? null : (
        <p className="m-0 max-w-[56ch] text-sm text-ink-2">
          {t({ id: 'onboarding.thinking.offline', message: 'Connect to the internet to sign in.' })}
        </p>
      )}
      {phase === 'waiting' ? (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="m-0 text-base text-ink">
            {t({ id: 'onboarding.thinking.chatgpt.waiting', message: 'Finish signing in in your browser.' })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void signIn()}>
              <Trans>Open it again</Trans>
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="primary"
          data-action="chatgpt-sign-in"
          disabled={!online}
          onClick={() => void signIn()}
        >
          {i18n._(CONTINUE)}
        </Button>
      )}
      {phase === 'timed-out' ? (
        <p role="status" className="m-0 text-sm text-ink-2">
          <Trans>The browser didn’t come back, so nothing was kept. Try again when you’re ready.</Trans>
        </p>
      ) : null}
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}
