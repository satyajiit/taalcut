// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: actual visual direction or an honestly labelled video brief.
 * States: loading, preview failure, unfinished brief, generated preview, campaign status and continuation. */

import { useLingui } from '@lingui/react/macro';
import { RationalTime, type ProductCampaign } from '@taalcut/core';
import { Button, cn, CONCEPT_ICONS, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { CreationPreview } from '../create/create-preview';
import { Loading, LoadError } from '../settings/fields';

export function ProductVideo({
  campaign,
  title,
  status,
  featured,
}: {
  campaign: ProductCampaign;
  title: string;
  status: string;
  featured: boolean;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const project = useRpcQuery(
    (signal) => backend.creation.get({ projectId: campaign.projectId }, { signal }),
    [backend, campaign.projectId],
  );
  useBackendEvents(['command.changed'], ({ payload }) => {
    if (payload.name.startsWith('creation.')) project.reload();
  });
  const preview = project.data?.draft?.visualPreviewAssetId;
  const duration = project.data ? i18n.number(RationalTime.toSeconds(project.data.brief.duration)) : '';
  const Format = CONCEPT_ICONS.format;
  const aspect = project.data?.brief.formats[0] ?? '9:16';
  const ratio = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5 }[aspect];
  return (
    <article
      className={cn(
        'flex min-w-0 flex-col gap-5',
        featured &&
          'md:grid md:grid-cols-[minmax(180px,0.85fr)_minmax(0,1fr)] md:items-center md:gap-8 lg:col-span-2',
      )}
    >
      <div
        className={cn(
          'flex min-h-72 min-w-0 flex-col items-center justify-center gap-3 rounded-xl bg-well p-5',
          featured && 'min-h-88',
        )}
      >
        {project.status === 'loading' && !project.data ? <Loading /> : null}
        {project.status === 'error' ? (
          <LoadError
            error={project.error}
            onRetry={project.reload}
            what={t`The video preview didn’t load.`}
          />
        ) : null}
        {project.data ? (
          <div
            data-slot="product-video-frame"
            data-aspect={aspect}
            className={cn(
              'flex w-full flex-col items-center justify-center overflow-hidden rounded-md border border-rule-strong bg-raised text-center [&>section]:h-full [&>section]:w-full [&_img]:h-full [&_img]:max-h-none [&_img]:rounded-none',
              !preview && 'gap-4 p-4',
            )}
            style={{ aspectRatio: ratio, maxWidth: Math.min(340, 300 * ratio) }}
          >
            {preview ? (
              <CreationPreview assetId={preview} compact />
            ) : (
              <>
                <Format aria-hidden className="size-6 text-ink-3" />
                <p className="m-0 max-w-36 type-meta text-pretty text-ink-2">{t`Video brief · preview not created yet`}</p>
              </>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col items-start gap-5">
        <div className="min-w-0">
          <h3 className={cn('m-0 text-balance text-ink', featured ? 'type-page-title' : 'type-card-title')}>
            <UserContent>{title}</UserContent>
          </h3>
          {project.data?.brief.prompt ? (
            <UserContent className="mt-3 block max-w-prose type-body text-ink-2">
              {project.data.brief.prompt}
            </UserContent>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 type-meta text-ink-2">
            <span>{status}</span>
            <time dateTime={new Date(campaign.createdAt).toISOString()}>
              {i18n.date(campaign.createdAt, { dateStyle: 'medium' })}
            </time>
          </div>
          {project.data ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 type-meta text-ink-2">
              <Format aria-hidden className="size-4" />
              <UserContent>{project.data.brief.formats.join(' · ')}</UserContent>
              <span>· {t`${duration} seconds`}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={featured ? 'primary' : 'secondary'}
            asChild
            icon={VERB_ICONS.next}
            iconPlacement="end"
          >
            <Link to="/create/$projectId" params={{ projectId: campaign.projectId }}>{t`Open video`}</Link>
          </Button>
          {campaign.conversationId ? (
            <Button size="sm" variant="ghost" asChild icon={CONCEPT_ICONS.chat}>
              <Link
                to="/chat/$conversationId"
                params={{ conversationId: campaign.conversationId }}
              >{t`Continue chat`}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
