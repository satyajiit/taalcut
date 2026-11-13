// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: inline handoff to the local Instagram Edits app alongside Postiz scheduling.
 * States: plugin disconnected/inactive, ready to stage, staging in progress, staged confirmation, recoverable error. */
import { useLingui } from '@lingui/react/macro';
import {
  PLUGIN_COMMANDS,
  type Product,
  type ProductCampaign,
  type RenderSnapshot,
  type TaalcutError,
} from '@taalcut/core';
import { Button, Checkbox, Input } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../backend/use-command';
import { Field, LoadError } from '../settings/fields';
import { usePlugins } from '../settings/plugins/use-plugins';

export type RenderHandoffTarget = RenderSnapshot & {
  readonly sha256?: string;
};

export function ProductEditsHandoff({
  product,
  campaign: _campaign,
  render,
  title,
  copyText,
  disabled = false,
}: {
  product: Product;
  campaign: ProductCampaign;
  render: RenderHandoffTarget | undefined;
  title?: string;
  copyText?: string;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const plugins = usePlugins();
  const command = useCommand({ toast: false });
  const [audioAssetId, setAudioAssetId] = useState('');
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);

  const editsPlugin = plugins.data?.find((item) => item.manifest.id === 'instagram-edits');
  const canStage =
    editsPlugin?.status === 'active' && editsPlugin.grantedAccess.includes('projects-write');
  const pending = command.pending;

  async function stageInEdits() {
    if (!render) return;
    setError(null);
    setStaged(false);
    const trimmedAudioId = audioAssetId.trim();
    const response = await command.run({
      name: PLUGIN_COMMANDS.call,
      payload: {
        pluginId: 'instagram-edits',
        toolName: 'api.stageReel',
        mode: 'external',
        input: {
          renderId: render.id,
          ...(render.sha256 ? { expectedSha256: render.sha256 } : {}),
          title: title ?? product.name,
          ...(trimmedAudioId ? { audioAssetId: trimmedAudioId, duckAudio: true } : {}),
          ...(includeCaptions && (title || copyText)
            ? {
                captions: [
                  ...(title ? [{ text: title, startTime: 0 }] : []),
                  ...(copyText ? [{ text: copyText, startTime: 1.5 }] : []),
                ],
              }
            : {}),
        },
      },
    });
    if (response.ok) setStaged(true);
    else setError(response.error);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 border-t border-rule pt-6">
      <h4 className="m-0 type-section text-ink">{t`Stage in Instagram Edits`}</h4>
      <p className="m-0 max-w-prose type-body text-ink-2">
        {t`Send the clean video and separate editable caption tracks to the Instagram Edits app on this computer. Attach an Instagram audio ID so you can add collaborators, linked reels and voice translation before sharing.`}
      </p>
      {canStage ? (
        <>
          <Field
            htmlFor="edits-audio-id"
            label={t`Instagram audio ID (optional)`}
            hint={t`Paste a Trending or Saved audioAssetId from Edits to attach licensed music.`}
          >
            <Input
              id="edits-audio-id"
              value={audioAssetId}
              disabled={disabled || pending}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setAudioAssetId(event.target.value);
                setStaged(false);
              }}
            />
          </Field>
          <Checkbox
            label={t`Include editable caption and title layers for Instagram translation`}
            checked={includeCaptions}
            disabled={disabled || pending}
            onCheckedChange={(checked) => {
              setIncludeCaptions(checked);
              setStaged(false);
            }}
          />
          <Button
            variant="secondary"
            className="self-start"
            loading={pending}
            disabled={disabled || !render || pending}
            onClick={() => void stageInEdits()}
          >
            {pending ? t`Staging in Edits…` : t`Stage in Instagram Edits`}
          </Button>
          {staged ? (
            <p role="status" className="m-0 type-body text-ink-2">
              {t`Staged in Instagram Edits. Open the Edits app to add collaborators and share.`}
            </p>
          ) : null}
          {error ? (
            <LoadError
              error={error}
              onRetry={() => void stageInEdits()}
              what={t`Staging in Instagram Edits needs attention.`}
            />
          ) : null}
        </>
      ) : (
        <Button size="sm" variant="secondary" asChild className="self-start">
          <Link to="/settings/plugins/$pluginId" params={{ pluginId: 'instagram-edits' }}>
            {t`Connect Instagram Edits in Settings`}
          </Link>
        </Button>
      )}
    </div>
  );
}
