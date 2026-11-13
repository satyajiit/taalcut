// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans } from '@lingui/react/macro';
import { CHATGPT_IMAGE_PROVIDER, type AccountsState } from '@taalcut/core';
import { Button, Chip, ProviderLogo, VERB_ICONS } from '@taalcut/ui';
import { SettingRow } from '../rows';

/** Image authorization is separate from the chat plan connection and never replaces it. */
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
  const signedIn = state.chatgpt.imagesSignedIn === true;
  const busy = actions.pending === CHATGPT_IMAGE_PROVIDER;
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
        busy ? (
          <span role="status">
            <Trans>Finish signing in in your browser, then come back.</Trans>
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
