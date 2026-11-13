// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CREATION_COMMANDS, FrameRates, newId, type CreationBrief } from '@taalcut/core';
import { Button, Chip, CONCEPT_ICONS, PageSection, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { Page } from '../../shell/page';
import { Loading, LoadError } from '../settings/fields';
import { BriefFields } from './create-fields';
import { CreationSummary } from './create-layout';
import { CreationShelf, EmptyCreationShelf } from './create-shelf';
import { CreationStart, initialCreationBrief } from './create-start';

export function CreatePage() {
  const { t } = useLingui();
  const backend = useBackend();
  const list = useRpcQuery((signal) => backend.creation.list({}, { signal }), [backend]);
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('creation.')) list.reload();
  });
  return (
    <Page
      title={t`Create`}
      width="wide"
      actions={
        <Button size="sm" asChild icon={VERB_ICONS.add}>
          <Link to="/create/new">{t`New video`}</Link>
        </Button>
      }
    >
      <CreationStart />
      {list.status === 'loading' && !list.data ? <Loading /> : null}
      {list.status === 'error' ? (
        <LoadError error={list.error} onRetry={list.reload} what={t`Your creations didn’t load.`} />
      ) : null}
      {list.data?.items.length === 0 ? (
        <EmptyCreationShelf />
      ) : list.data ? (
        <CreationShelf projects={list.data.items} />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule-subtle pt-6">
        <p className="m-0 type-body text-ink-2">{t`Making videos for the same product?`}</p>
        <Button variant="ghost" asChild icon={CONCEPT_ICONS.starter}>
          <Link to="/products">{t`Keep its sources and ideas together`}</Link>
        </Button>
      </div>
    </Page>
  );
}

export function NewCreationPage({
  category = 'product-launch',
  initialTitle,
  initialPrompt,
  initialDurationSeconds,
  audioAssetId,
}: {
  category?: CreationBrief['category'];
  initialTitle?: string | undefined;
  initialPrompt?: string | undefined;
  initialDurationSeconds?: number | undefined;
  audioAssetId?: string | undefined;
}) {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const navigate = useNavigate();
  const [brief, setBrief] = useState<CreationBrief>(() => {
    const base = initialCreationBrief(category, i18n.locale);
    return {
      ...base,
      ...(initialTitle ? { title: initialTitle } : {}),
      ...(initialPrompt ? { prompt: initialPrompt } : {}),
      ...(initialDurationSeconds
        ? {
            duration: {
              value: Math.round(initialDurationSeconds * 60),
              rate: FrameRates.fps60,
            },
          }
        : {}),
    };
  });
  return (
    <Page title={t`New video`} width="wide">
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <PageSection
          title={t`What would you like to make?`}
          icon={CONCEPT_ICONS.request}
          description={t`Start with a brief. Taalcut will research your sources and prepare a script before production.`}
          actions={
            audioAssetId ? (
              <Chip tone="beat">
                <UserContent>{t`Instagram Edits audio #${audioAssetId}`}</UserContent>
              </Chip>
            ) : undefined
          }
        >
          <form
            className="flex flex-col gap-8"
            onSubmit={async (event) => {
              event.preventDefault();
              const projectId = newId<'Project'>();
              const result = await command.run({
                name: CREATION_COMMANDS.create,
                payload: { projectId, brief },
              });
              if (result.ok) await navigate({ to: '/create/$projectId', params: { projectId } });
            }}
          >
            <BriefFields value={brief} onChange={setBrief} disabled={command.pending} />
            <Button
              type="submit"
              variant="primary"
              icon={VERB_ICONS.next}
              iconPlacement="end"
              className="self-start"
              loading={command.pending}
              disabled={!brief.title.trim() || !brief.prompt.trim()}
            >{t`Save brief & add sources`}</Button>
          </form>
        </PageSection>
        <CreationSummary brief={brief} />
      </div>
    </Page>
  );
}
