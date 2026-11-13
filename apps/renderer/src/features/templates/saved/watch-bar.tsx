// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · components: a Saved collection's sync line and its watch switches (UX4 tpl) · system:
 *   DESIGN.md v0.6 + UX4 (Switch with its words, ListRow framed)
 * SyncLine, on the collection's page: how many reels it holds and when it was last synced (or that it never was),
 *   and Sync now. WatchSwitches, on Saved's settings: one framed row per collection, its name and count, then Watch
 *   this collection and Read new reels automatically as switches whose words are their hit area (the second only
 *   while the first is on: it opens under it with the kit's Collapse, so the rows below move with it)
 * states: Sync now (the Button's eight; syncing spins; a session that ran out asks to sign in again) · the
 *   switches' (default · hover · focus-visible · on · disabled · loading while saving · invalid when it failed) ·
 *   error (the cause under them, Try again)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  ALL_SAVED_COLLECTION_ID,
  callRpc,
  INSTAGRAM_SAVED_COMMANDS,
  type InstagramCollection,
  type TaalcutError,
} from '@taalcut/core';
import { Button, Collapse, ErrorLine, ListRow, Switch, useFormatters, VERB_ICONS } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { TEMPLATE_ICONS } from '../template-icons';

const isSessionExpired = (error: TaalcutError) =>
  error.code === 'templates.instagram_session_expired' || error.code === 'templates.instagram_auth_required';

/** A collection's name: All Saved in this language, any other as the person named it. */
export function CollectionName({ collection }: { collection: InstagramCollection }) {
  const { t } = useLingui();
  return collection.id === ALL_SAVED_COLLECTION_ID ? (
    <>{t`All Saved`}</>
  ) : (
    <span dir="auto" translate="no">
      {collection.name}
    </span>
  );
}

export function SyncLine({
  collection,
  onChanged,
  onSessionExpired,
}: {
  readonly collection: InstagramCollection;
  readonly onChanged: () => void;
  readonly onSessionExpired?: (error: TaalcutError) => void;
}) {
  const formatters = useFormatters();
  const backend = useBackend();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const synced = collection.lastSyncedAt;
  const lastSyncedText = synced !== null ? formatters.dateTime(synced) : null;
  const lastSyncedIso = synced !== null ? new Date(synced).toISOString() : undefined;

  const syncNow = async () => {
    setSyncing(true);
    setError(null);
    const result = await callRpc(
      backend.commands.dispatch({
        name: INSTAGRAM_SAVED_COMMANDS.syncCollection,
        payload: { projectId: null, collectionId: collection.id },
        source: 'ui',
      }),
    );
    setSyncing(false);
    if (result.ok) return onChanged();
    if (isSessionExpired(result.error)) onSessionExpired?.(result.error);
    setError(result.error);
  };

  return (
    <div data-slot="saved-watch-bar" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 type-body text-ink-2">
          <span className="tabular-nums">
            <Plural value={collection.mediaCount} one="# reel" other="# reels" />
          </span>
          <span aria-hidden className="text-ink-3">
            ·
          </span>
          {lastSyncedText !== null ? (
            <Trans>
              Last synced <time dateTime={lastSyncedIso}>{lastSyncedText}</time>
            </Trans>
          ) : (
            <Trans>Not synced yet. Sync now to read the Reels in this collection.</Trans>
          )}
        </p>
        <Button size="sm" icon={TEMPLATE_ICONS.sync} loading={syncing} onClick={() => void syncNow()}>
          <Trans>Sync now</Trans>
        </Button>
      </div>
      {error ? <ErrorLine error={error} onRetry={() => void syncNow()} /> : null}
    </div>
  );
}

/** One collection's row on Saved's settings: watch it, and read what lands in it. */
export function WatchSwitches({
  collection,
  onChanged,
}: {
  readonly collection: InstagramCollection;
  readonly onChanged: () => void;
}) {
  const backend = useBackend();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);

  const setWatch = async (watched: boolean, autoBreakdown: boolean) => {
    setSaving(true);
    setError(null);
    const result = await callRpc(
      backend.commands.dispatch({
        name: INSTAGRAM_SAVED_COMMANDS.setWatch,
        payload: {
          projectId: null,
          collectionId: collection.id,
          watched,
          autoBreakdown: watched ? autoBreakdown : false,
        },
        source: 'ui',
      }),
    );
    setSaving(false);
    if (result.ok) onChanged();
    else setError(result.error);
  };

  return (
    <ListRow
      data-slot="saved-watch-row"
      leading={TEMPLATE_ICONS.saved}
      title={<CollectionName collection={collection} />}
      meta={<Plural value={collection.mediaCount} one="# reel" other="# reels" />}
    >
      <span className="mt-2 flex flex-col gap-2">
        <Switch
          checked={collection.watched}
          loading={saving}
          invalid={error !== null}
          label={<Trans>Watch this collection</Trans>}
          description={<Trans>New saves show up here without a sync.</Trans>}
          onCheckedChange={(watched) => void setWatch(watched, watched ? collection.autoBreakdown : false)}
        />
        <Collapse open={collection.watched}>
          <Switch
            checked={collection.autoBreakdown}
            disabled={!collection.watched}
            loading={saving}
            invalid={error !== null}
            label={<Trans>Read new reels automatically</Trans>}
            description={<Trans>Each new save becomes a template on its own.</Trans>}
            onCheckedChange={(autoBreakdown) => void setWatch(collection.watched, autoBreakdown)}
          />
        </Collapse>
        {error ? (
          <span className="flex flex-wrap items-center gap-2">
            <ErrorLine error={error} />
            <Button
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.retry}
              onClick={() => void setWatch(collection.watched, collection.autoBreakdown)}
            >
              <Trans>Try again</Trans>
            </Button>
          </span>
        ) : null}
      </span>
    </ListRow>
  );
}
