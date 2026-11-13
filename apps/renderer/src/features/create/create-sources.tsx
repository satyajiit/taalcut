// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  CREATION_COMMANDS,
  newId,
  type AssetId,
  type CreationProject,
  type CreationSourceInput,
  type TaalcutError,
} from '@taalcut/core';
import {
  Button,
  CONCEPT_ICONS,
  Input,
  ListRow,
  ListRows,
  MediaError,
  PageSection,
  Select,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useAssetPages } from '../library/use-asset-pages';
import { Field, LoadError } from '../settings/fields';

export function CreationSources({
  project,
  onChange,
  disabled = false,
}: {
  project: CreationProject;
  onChange: () => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const backend = useBackend();
  const command = useCommand();
  const [url, setUrl] = useState('');
  const [assetId, setAssetId] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const assets = useAssetPages({}, 'added', 'desc');
  const busy = disabled || picking || command.pending;
  const add = async (source: CreationSourceInput) => {
    const result = await command.run({
      name: CREATION_COMMANDS.addSource,
      payload: { projectId: project.projectId, revision: project.revision, source },
    });
    if (result.ok) {
      onChange();
      return true;
    }
    return false;
  };
  const folder = async () => {
    setPicking(true);
    setError(null);
    try {
      const selected = await callRpc(backend.files.pickCreationDirectory());
      if (!selected.ok) return setError(selected.error);
      if (selected.value) await add({ id: newId<'CreationSource'>(), kind: 'directory', ...selected.value });
    } finally {
      setPicking(false);
    }
  };
  return (
    <PageSection
      title={t`Sources`}
      icon={CONCEPT_ICONS.source}
      description={t`Add the website, project folders and media that explain your idea. Taalcut reads only the sources you choose.`}
      className="border-t border-rule-subtle pt-6"
      actions={
        <Button
          size="sm"
          icon={VERB_ICONS.addFolder}
          loading={picking}
          disabled={busy}
          onClick={() => void folder()}
        >{t`Add project folder`}</Button>
      }
    >
      <form
        className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={async (event) => {
          event.preventDefault();
          const label = new URL(url).hostname.slice(0, 200);
          if (await add({ id: newId<'CreationSource'>(), kind: 'url', label, url })) setUrl('');
        }}
      >
        <Field htmlFor="create-url" label={t`Website or document URL`} className="flex-1">
          <Input
            id="create-url"
            type="url"
            required
            value={url}
            maxLength={4000}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          icon={CONCEPT_ICONS.connection}
          disabled={busy || !url.trim()}
        >{t`Add URL`}</Button>
      </form>
      {error ? <MediaError error={error} /> : null}
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field htmlFor="create-asset" label={t`Media from your library`} className="flex-1">
          <Select
            id="create-asset"
            value={assetId}
            disabled={busy}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">{t`Choose media…`}</option>
            {assets.items.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          icon={VERB_ICONS.add}
          disabled={busy || !assetId}
          onClick={async () => {
            const asset = assets.items.find((item) => item.id === assetId);
            if (
              asset &&
              (await add({
                id: newId<'CreationSource'>(),
                kind: 'asset',
                label: asset.name,
                assetId: asset.id,
              }))
            )
              setAssetId('');
          }}
        >{t`Add media`}</Button>
      </div>
      {assets.error ? (
        <LoadError error={assets.error} onRetry={assets.reload} what={t`Your library didn’t load.`} />
      ) : null}
      {assets.total !== null && assets.items.length < assets.total ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => assets.ensure(assets.items.length + 200)}
        >{t`Load more media`}</Button>
      ) : null}
      {project.brief.voice.mode === 'upload' ? (
        <Field htmlFor="create-recording" label={t`Voice recording`}>
          <Select
            id="create-recording"
            value={project.brief.voice.assetId ?? ''}
            disabled={busy}
            onChange={async (event) => {
              const result = await command.run({
                name: CREATION_COMMANDS.updateBrief,
                payload: {
                  projectId: project.projectId,
                  revision: project.revision,
                  brief: {
                    ...project.brief,
                    voice: { ...project.brief.voice, assetId: (event.target.value as AssetId) || null },
                  },
                },
              });
              if (result.ok) onChange();
            }}
          >
            <option value="">{t`Choose a recording…`}</option>
            {assets.items
              .filter((asset) => asset.kind === 'audio')
              .map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
          </Select>
        </Field>
      ) : null}
      <CreationSourceList
        sources={project.sources}
        disabled={busy}
        onRemove={async (sourceId) => {
          const result = await command.run({
            name: CREATION_COMMANDS.removeSource,
            payload: { projectId: project.projectId, revision: project.revision, sourceId },
          });
          if (result.ok) onChange();
        }}
      />
    </PageSection>
  );
}

function CreationSourceList({
  sources,
  disabled,
  onRemove,
}: {
  sources: CreationProject['sources'];
  disabled: boolean;
  onRemove: (sourceId: CreationProject['sources'][number]['id']) => Promise<void>;
}) {
  const { t } = useLingui();
  return (
    <ListRows>
      {sources.map((source) => {
        const name = source.label;
        return (
          <ListRow
            key={source.id}
            static
            size="dense"
            leading={
              source.kind === 'directory'
                ? CONCEPT_ICONS.folder
                : source.kind === 'url'
                  ? CONCEPT_ICONS.connection
                  : CONCEPT_ICONS.clip
            }
            title={<UserContent className="block truncate">{source.label}</UserContent>}
            meta={
              source.kind === 'directory'
                ? t`Project folder`
                : source.kind === 'url'
                  ? t`URL`
                  : t`Library media`
            }
            actions={
              <Button
                size="sm"
                variant="ghost"
                icon={VERB_ICONS.delete}
                disabled={disabled}
                aria-label={t`Remove ${name}`}
                onClick={() => void onRemove(source.id)}
              >{t`Remove`}</Button>
            }
          />
        );
      })}
    </ListRows>
  );
}
