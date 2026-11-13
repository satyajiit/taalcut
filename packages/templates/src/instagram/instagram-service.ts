// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Service for Saved on Instagram: status, cached reads, and syncing saved
 * collections and Reels into `InstagramSavedStore`, with optional automatic
 * breakdown of newly discovered Reels in watched collections.
 */
import {
  ALL_SAVED_COLLECTION_ID,
  INSTAGRAM_WARNING,
  ok,
  systemClock,
  type AcknowledgementStore,
  type AsyncResult,
  type Clock,
  type CommandContext,
  type InstagramCollection,
  type InstagramCollectionUpsert,
  type InstagramReelsPage,
  type InstagramReelsQuery,
  type InstagramSavedReel,
  type InstagramSavedStatus,
  type InstagramSavedStore,
  type InstagramSessionProvider,
  type InstagramSyncResult,
} from '@taalcut/core';
import type { InstagramWebClient } from './instagram-client';

export const MAX_AUTO_BREAKDOWNS_PER_SYNC = 5;

export interface InstagramSavedServiceDeps {
  readonly store: InstagramSavedStore;
  readonly client: InstagramWebClient;
  readonly sessionProvider: InstagramSessionProvider;
  readonly acknowledgements: Pick<AcknowledgementStore, 'latest'>;
  readonly clock?: Clock;
  /** Optional hook that queues Analyst breakdowns for newly saved Reels in an auto-breakdown collection. */
  readonly onAutoBreakdown?: (reels: readonly InstagramSavedReel[]) => Promise<number>;
}

export interface InstagramSavedService {
  status(): AsyncResult<InstagramSavedStatus>;
  collections(): AsyncResult<InstagramCollection[]>;
  reels(query: InstagramReelsQuery): AsyncResult<InstagramReelsPage>;
  sync(input?: {
    readonly collectionId?: string;
    readonly context?: CommandContext;
  }): AsyncResult<InstagramSyncResult>;
}

export function createInstagramSavedService(deps: InstagramSavedServiceDeps): InstagramSavedService {
  const clock = deps.clock ?? systemClock;

  return {
    async status() {
      const [sessionRes, collectionsRes, ack] = await Promise.all([
        deps.sessionProvider.getSession(),
        deps.store.listCollections(),
        deps.acknowledgements.latest(INSTAGRAM_WARNING.feature),
      ]);
      const session = sessionRes.ok ? sessionRes.value : null;
      const collections = collectionsRes.ok ? collectionsRes.value : [];
      const watchedCollections = collections.filter((c) => c.watched).length;
      const lastSyncedAt = collections.reduce<number | null>(
        (max, c) => (c.lastSyncedAt !== null && (max === null || c.lastSyncedAt > max) ? c.lastSyncedAt : max),
        null,
      );
      const acknowledgedAt =
        ack.ok && ack.value?.termsVersion === INSTAGRAM_WARNING.termsVersion
          ? ack.value.acknowledgedAt
          : null;

      return ok({
        signedIn: session !== null,
        username: session?.username ?? null,
        warning: INSTAGRAM_WARNING,
        acknowledgedAt,
        watchedCollections,
        lastSyncedAt,
      });
    },

    async collections() {
      return deps.store.listCollections();
    },

    async reels(query) {
      return deps.store.listReels(query);
    },

    async sync(input) {
      const fetchedCollections = await deps.client.fetchCollections();
      if (!fetchedCollections.ok) return fetchedCollections;

      const upsertedCollections = await deps.store.upsertCollections(
        fetchedCollections.value,
        input?.context,
      );
      if (!upsertedCollections.ok) return upsertedCollections;

      const collections = upsertedCollections.value;
      const targets = input?.collectionId
        ? [input.collectionId]
        : collections.some((c) => c.watched)
          ? collections.filter((c) => c.watched).map((c) => c.id)
          : [ALL_SAVED_COLLECTION_ID];

      let syncedReels = 0;
      let addedReels = 0;
      const autoCandidates: InstagramSavedReel[] = [];
      const syncedCollectionUpserts: InstagramCollectionUpsert[] = [];
      const now = clock.now();

      for (const collectionId of targets) {
        const fetchedReels = await deps.client.fetchCollectionReels(collectionId);
        if (!fetchedReels.ok) return fetchedReels;

        syncedReels += fetchedReels.value.length;
        const upsertedReels = await deps.store.upsertReels(fetchedReels.value, input?.context);
        if (!upsertedReels.ok) return upsertedReels;

        const addedSet = new Set(upsertedReels.value.addedShortcodes);
        addedReels += addedSet.size;

        const col = collections.find((c) => c.id === collectionId);
        if (col) {
          syncedCollectionUpserts.push({
            id: col.id,
            name: col.name,
            mediaCount:
              col.id === ALL_SAVED_COLLECTION_ID
                ? Math.max(col.mediaCount, fetchedReels.value.length)
                : col.mediaCount,
            coverUrl: col.coverUrl ?? fetchedReels.value[0]?.thumbnailUrl ?? null,
            lastSyncedAt: now,
          });
        }

        if (col?.watched && col.autoBreakdown && addedSet.size > 0 && deps.onAutoBreakdown) {
          const page = await deps.store.listReels({
            collectionId,
            onlyUnlinked: true,
            limit: Math.max(50, fetchedReels.value.length),
          });
          const unlinkedByShortcode = new Map(
            (page.ok ? page.value.items : []).map((r) => [r.shortcode, r]),
          );
          for (const item of fetchedReels.value) {
            if (!addedSet.has(item.shortcode) || autoCandidates.length >= MAX_AUTO_BREAKDOWNS_PER_SYNC) {
              continue;
            }
            const stored = unlinkedByShortcode.get(item.shortcode);
            if (stored) autoCandidates.push(stored);
          }
        }
      }

      if (syncedCollectionUpserts.length > 0) {
        await deps.store.upsertCollections(syncedCollectionUpserts, input?.context);
      }

      let queuedBreakdowns = 0;
      if (autoCandidates.length > 0 && deps.onAutoBreakdown) {
        queuedBreakdowns = await deps.onAutoBreakdown(autoCandidates);
      }

      const refreshedCollections = await deps.store.listCollections();
      return ok({
        collections: refreshedCollections.ok ? refreshedCollections.value : collections,
        syncedReels,
        addedReels,
        queuedBreakdowns,
      });
    },
  };
}
