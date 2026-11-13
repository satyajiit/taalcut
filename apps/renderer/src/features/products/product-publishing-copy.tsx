// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: account copy and the exact export form one explicit approval surface.
 * States: editable copy, draft approval, queued/scheduled/published, uncertain outcome, failure and cancellation. */

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
  PRODUCT_PUBLISH_COMMANDS as C,
  type ProductPublishRecord,
  type RenderSnapshot,
  type productPublishDraftSchema,
} from '@taalcut/core';
import { Button, CONCEPT_ICONS, Input, Select, UserContent, VERB_ICONS } from '@taalcut/ui';
import type { z } from 'zod';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useRpcQuery } from '../../backend/use-rpc';
import { useMediaUrls } from '../../services/provider';
import { CreationText } from '../create/create-fields';
import { Field, Loading, LoadError } from '../settings/fields';

type Draft = z.output<typeof productPublishDraftSchema>;
export const PLATFORMS = {
  youtube: msg`YouTube Shorts`,
  instagram: msg`Instagram Reels`,
  x: msg`X`,
  linkedin: msg`LinkedIn`,
  facebook: msg`Facebook`,
};
const STATUS = {
  draft: msg`Awaiting approval`,
  approved: msg`Approved · queued`,
  uploading: msg`Uploading`,
  scheduling: msg`Confirming schedule`,
  unknown: msg`Checking provider outcome`,
  scheduled: msg`Scheduled`,
  published: msg`Published`,
  failed: msg`Needs attention`,
  cancelled: msg`Cancelled`,
};

export function DraftCopy({
  draft,
  account,
  onChange,
}: {
  draft: Draft;
  account: string;
  onChange: (draft: Draft) => void;
}) {
  const { t, i18n } = useLingui();
  return (
    <article className="flex min-w-0 flex-col gap-5 rounded-xl border border-rule bg-raised p-6">
      <h3 className="m-0 type-section text-ink">
        {i18n._(PLATFORMS[draft.platform])} · <UserContent>{account}</UserContent>
      </h3>
      {draft.title !== undefined ? (
        <Field htmlFor={`title-${draft.accountId}`} label={t`Title`}>
          <Input
            id={`title-${draft.accountId}`}
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
          />
        </Field>
      ) : null}
      {draft.platform === 'youtube' ? (
        <Field htmlFor={`visibility-${draft.accountId}`} label={t`Visibility`}>
          <Select
            id={`visibility-${draft.accountId}`}
            value={String(draft.providerSettings['privacyStatus'] ?? 'public')}
            onChange={(event) =>
              onChange({
                ...draft,
                providerSettings: { ...draft.providerSettings, privacyStatus: event.target.value },
              })
            }
          >
            <option value="public">{t`Public`}</option>
            <option value="unlisted">{t`Unlisted`}</option>
            <option value="private">{t`Private`}</option>
          </Select>
        </Field>
      ) : null}
      <Field htmlFor={`copy-${draft.accountId}`} label={t`Caption or description`}>
        <CreationText
          id={`copy-${draft.accountId}`}
          value={draft.content}
          onChange={(event) => onChange({ ...draft, content: event.target.value })}
        />
      </Field>
      {draft.platform === 'youtube' ? (
        <Field htmlFor={`tags-${draft.accountId}`} label={t`Search tags, separated by commas`}>
          <Input
            id={`tags-${draft.accountId}`}
            value={draft.tags.join(', ')}
            onChange={(event) =>
              onChange({
                ...draft,
                tags: event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      ) : null}
      {draft.platform === 'x' ? (
        <p className="m-0 type-meta text-ink-2">{t`X’s weighted limit is checked with its official parser before these posts can be saved.`}</p>
      ) : null}
    </article>
  );
}

export function Publication({
  record,
  account,
  render,
  onChanged,
}: {
  record: ProductPublishRecord;
  account: string;
  render?: RenderSnapshot;
  onChanged: () => void;
}) {
  const { t, i18n } = useLingui();
  const command = useCommand();
  const Time = CONCEPT_ICONS.date;
  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-rule p-6">
      <h3 className="m-0 type-section text-ink">
        {i18n._(PLATFORMS[record.platform])} · <UserContent>{account}</UserContent>
      </h3>
      <p className="m-0 type-label text-ink-2">{i18n._(STATUS[record.status])}</p>
      <time className="flex flex-wrap items-center gap-2 type-body text-ink" dateTime={record.scheduledAt}>
        <Time aria-hidden className="size-4 shrink-0 text-ink-2" />
        {i18n.date(new Date(record.scheduledAt), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: record.timezone,
        })}{' '}
        · <UserContent>{record.timezone}</UserContent>
      </time>
      {render ? (
        <>
          <p className="m-0 type-meta text-ink-2">
            <UserContent>{render.name}</UserContent> · {i18n.number(render.width)} ×{' '}
            {i18n.number(render.height)} · {i18n.number(render.rate.num / render.rate.den)} {t`fps`}
          </p>
          {record.status === 'draft' ? <RenderPreview render={render} /> : null}
        </>
      ) : null}
      {record.platform === 'youtube' ? (
        <p className="m-0 type-body text-ink-2">
          {t`Visibility:`}{' '}
          {record.providerSettings['privacyStatus'] === 'private'
            ? t`Private`
            : record.providerSettings['privacyStatus'] === 'unlisted'
              ? t`Unlisted`
              : t`Public`}
        </p>
      ) : null}
      {record.title ? <UserContent className="type-label text-ink">{record.title}</UserContent> : null}
      <UserContent className="whitespace-pre-wrap type-body text-ink-2">{record.content}</UserContent>
      {record.tags.length ? (
        <UserContent className="type-meta text-ink-2">{record.tags.join(', ')}</UserContent>
      ) : null}
      {record.status === 'unknown' ? (
        <p className="m-0 type-body text-ink-2">{t`Postiz may have received this post. Check its publishing history before creating a replacement; Taalcut will not send it again automatically.`}</p>
      ) : null}
      {record.status === 'failed' ? (
        <p className="m-0 type-body text-danger-strong">{t`Review the current video, account and platform requirements, then prepare a new post.`}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {record.status === 'draft' ? (
          <Button
            variant="primary"
            icon={VERB_ICONS.approve}
            disabled={!render}
            loading={command.pending}
            onClick={async () => {
              const approved = await command.run({
                name: C.approve,
                payload: { id: record.id, expectedRevision: record.revision },
              });
              if (approved.ok) await command.run({ name: C.dispatch, payload: { id: record.id } });
              onChanged();
            }}
          >{t`Approve this post and schedule`}</Button>
        ) : null}
        {['draft', 'approved', 'failed'].includes(record.status) && !record.remotePostId ? (
          <Button
            variant="ghost"
            icon={VERB_ICONS.close}
            disabled={command.pending}
            onClick={async () => {
              await command.run({
                name: C.cancel,
                payload: { id: record.id, expectedRevision: record.revision },
              });
              onChanged();
            }}
          >{t`Cancel this post`}</Button>
        ) : null}
        {['unknown', 'uploading', 'scheduling', 'scheduled'].includes(record.status) ? (
          <Button
            variant="ghost"
            icon={VERB_ICONS.checkAgain}
            loading={command.pending}
            onClick={async () => {
              await command.run({ name: C.reconcile, payload: { id: record.id } });
              onChanged();
            }}
          >{t`Check publishing status`}</Button>
        ) : null}
        {record.publishedUrl ? (
          <Button variant="ghost" asChild icon={VERB_ICONS.openOutside}>
            <a href={record.publishedUrl} target="_blank" rel="noreferrer">{t`View published post`}</a>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function RenderPreview({ render }: { render: RenderSnapshot }) {
  const { t } = useLingui();
  const backend = useBackend();
  const media = useMediaUrls();
  const video = useRpcQuery(
    (signal) => backend.renders.mediaUrl({ renderId: render.id, kind: 'video' }, { signal }),
    [backend, render.id],
  );
  return video.data ? (
    <video
      className="max-h-96 w-full rounded-lg bg-surface object-contain"
      controls
      preload="metadata"
      aria-label={t`Review exported video`}
      src={media.preview(video.data.url) ?? undefined}
    >
      <track kind="captions" />
    </video>
  ) : video.status === 'error' ? (
    <LoadError error={video.error} onRetry={video.reload} what={t`Video preview didn’t load.`} />
  ) : (
    <Loading />
  );
}
