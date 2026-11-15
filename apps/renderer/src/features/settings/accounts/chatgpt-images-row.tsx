// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { Trans, useLingui } from '@lingui/react/macro';
import { CHATGPT_IMAGE_PROVIDER, type AccountsState } from '@taalcut/core';
import { Button, Chip, ProviderLogo, VERB_ICONS } from '@taalcut/ui';
import { describeError } from '../model-messages';
import { SettingRow } from '../rows';

/**
 * CVR2: why the last try at the plan's images did not connect, as a sentence (the page was closed and the sign-in
 * timed out, OpenAI refused it, the sign-in could not start); undefined when no try failed.
 */
export function imagesFailure(i18n: I18n, state: AccountsState): string | undefined {
  const attempt = state.chatgpt.imagesAttempt;
  if (attempt?.state !== 'failed' || state.chatgpt.imagesSignedIn) return undefined;
  return describeError(i18n, {
    messageKey: `errors.${attempt.errorCode ?? 'models.sign_in_failed'}`,
    params: { provider: CHATGPT_IMAGE_PROVIDER },
  });
}

/** CVR2: the images' page is open in the browser now, whoever opened it (Continue with ChatGPT, this row, a fix). */
export const imagesWaiting = (state: AccountsState): boolean =>
  state.chatgpt.imagesAttempt?.state === 'waiting' && !state.chatgpt.imagesSignedIn;

/**
 * Image authorization is separate from the chat plan connection and never replaces it. Continue with ChatGPT asks
 * for it right after the chat sign-in, on a second page in the browser; this row shows whether it connected, and
 * connects or disconnects it on its own. CVR2: while that page is open the row says so, and when it ended without
 * connecting the row says why and offers it again.
 */
export function ChatGptImagesRow({
  state,
  actions,
}: {
  state: AccountsState;
  actions: {
    pending: string | null;
    signIn(provider: string): Promise<void>;
    signOut(provider: string): Promise<void>;
  };
}) {
  const { i18n } = useLingui();
  const signedIn = state.chatgpt.imagesSignedIn === true;
  const busy = actions.pending === CHATGPT_IMAGE_PROVIDER;
  const failure = imagesFailure(i18n, state);
  return (
    <SettingRow
      data-provider={CHATGPT_IMAGE_PROVIDER}
      icon={
        <span className="flex size-8 shrink-0 items-center justify-center">
          <ProviderLogo provider="openai-codex" size="md" />
        </span>
      }
      title={<Trans>ChatGPT images</Trans>}
      description={
        busy || imagesWaiting(state) ? (
          <span role="status">
            <Trans>Finish signing in in your browser, then come back.</Trans>
          </span>
        ) : failure ? (
          <span role="status" className="text-danger-strong">
            {failure}
          </span>
        ) : (
          <Trans>
            Generate images using your ChatGPT plan. Connect images separately; your chat connection stays in
            place.
          </Trans>
        )
      }
      status={
        signedIn ? (
          <Chip tone="success">
            <Trans>Images connected</Trans>
          </Chip>
        ) : failure ? (
          <Chip tone="warning">
            <Trans>Not connected</Trans>
          </Chip>
        ) : null
      }
      control={
        signedIn ? (
          <Button
            variant="ghost"
            size="sm"
            icon={VERB_ICONS.signOut}
            disabled={actions.pending !== null}
            onClick={() => void actions.signOut(CHATGPT_IMAGE_PROVIDER)}
          >
            <Trans>Disconnect images</Trans>
          </Button>
        ) : (
          <Button
            variant="secondary"
            icon={VERB_ICONS.signIn}
            loading={busy}
            disabled={actions.pending !== null && !busy}
            onClick={() => void actions.signIn(CHATGPT_IMAGE_PROVIDER)}
          >
            <Trans>Connect ChatGPT images</Trans>
          </Button>
        )
      }
    />
  );
}
