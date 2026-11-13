// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: Settings › Memory › Cloud models (LRN1-MEM) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.3 · one switch row in its own hairline frame: "Use memory with
 *   cloud models", and under it one plain sentence that says what happens now: memory stays on this Mac (Local only,
 *   or the agent's model is here), goes with requests to the named providers, or is left out of them
 * states: loading (the row's bones) · error (the cause and Try again) · default · hover · focus · active (the kit's
 *   Switch) · busy (the write on its way) · failed (the switch back, the cause under the row) · success (the new
 *   sentence is the answer)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { MemoryStatus } from '@taalcut/core';
import { Skeleton } from '@taalcut/ui';
import type { ReactNode } from 'react';
import type { Reloadable } from '../../../backend/use-rpc';
import { providerName } from '../providers';
import { BoneRows } from '../bones';
import { LoadError } from '../fields';
import { SwitchRow } from '../switch-row';
import type { MemoryActions } from './use-memory-actions';

const CLOUD_BONES = [{ title: '34%', lines: ['72%', '48%'], control: 'switch' }] as const;

function Where({ status }: { status: MemoryStatus }) {
  const { i18n } = useLingui();
  const names = status.providers.map((provider) => providerName(i18n, provider) ?? provider).join(', ');
  if (status.prompts === 'on-device')
    return status.localOnly ? (
      <Trans>Local only is on, so the agent works on this Mac and your memory never leaves it.</Trans>
    ) : (
      <Trans>The agent works on this Mac, so your memory never leaves it.</Trans>
    );
  if (status.prompts === 'cloud')
    return names ? (
      <Trans>
        Your memory goes with each request the agent sends to {names}. Turn this off to keep it on this Mac.
      </Trans>
    ) : (
      <Trans>Your memory goes with each request the agent sends to a cloud model.</Trans>
    );
  return (
    <Trans>
      Off: the agent’s requests to cloud models leave your memory out, so chats won’t use what you saved here.
    </Trans>
  );
}

export function MemoryCloud({
  status,
  actions,
}: {
  status: Reloadable<MemoryStatus>;
  actions: Pick<MemoryActions, 'setCloudPrompts' | 'cloudBusy' | 'cloudError'>;
}) {
  const data = status.data;
  let body: ReactNode = null;
  if (status.status === 'error' && !data)
    body = (
      <LoadError
        error={status.error}
        onRetry={status.reload}
        what={<Trans>Where your memory goes didn’t load.</Trans>}
      />
    );
  else if (data)
    body = (
      <SwitchRow
        data-setting="memory-cloud"
        label={<Trans>Use memory with cloud models</Trans>}
        description={<Where status={data} />}
        checked={data.cloudPrompts}
        busy={actions.cloudBusy}
        error={actions.cloudError}
        onChange={(enabled) => void actions.setCloudPrompts(enabled)}
      />
    );
  return (
    <Skeleton
      name="settings-memory-cloud"
      loading={!data && status.status !== 'error'}
      fixture={<BoneRows rows={CLOUD_BONES} />}
    >
      {body}
    </Skeleton>
  );
}
