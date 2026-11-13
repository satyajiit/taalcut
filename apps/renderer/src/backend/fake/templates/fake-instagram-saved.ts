// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fake Instagram Saved store, RPC handlers, and undoable commands for the
 * renderer's in-page fake backend (`createFakeBackend`).
 */
import {
  ALL_SAVED_COLLECTION_ID,
  appContract,
  defineCommand,
  err,
  implementContract,
  INSTAGRAM_SAVED_COMMANDS,
  INSTAGRAM_WARNING,
  instagramCollectionNotFoundError,
  instagramSavedCommandPayloads,
  NotFoundError,
  ok,
  type AnyCommand,
  type EventBus,
  type Id,
  type InstagramCollection,
  type InstagramReelsPage,
  type InstagramReelsQuery,
  type InstagramSavedReel,
  type InstagramSavedStatus,
} from '@taalcut/core';
import type { FakeTemplates } from './fake-templates';
import { HOOK_TEST, MORNING, templateIdOf } from './template-data';

const N = INSTAGRAM_SAVED_COMMANDS;
const P = instagramSavedCommandPayloads;
const PROCEDURES = {
  instagramStatus: appContract.templates.instagramStatus,
  instagramCollections: appContract.templates.instagramCollections,
  instagramReels: appContract.templates.instagramReels,
};

export interface FakeInstagramAuthRead {
  readonly signedIn: boolean;
  readonly username?: string | null | undefined;
  readonly acknowledgedAt?: number | undefined;
}

const SEED_TEMPLATE_ID = '01K7C5M6Q85000000000000001' as Id<'Template'>;

/** LRN1-STY: two more broken-down reels in Reels Inspo, so the collection's style profile has three members. */
const STYLE_PROFILE_REELS: readonly (readonly [string, InstagramSavedReel])[] = [
  [
    'REEL_INSPO_3',
    {
      shortcode: 'REEL_INSPO_3',
      mediaPk: 'pk_inspo_3',
      collectionId: 'col_inspo',
      permalink: 'https://www.instagram.com/reel/REEL_INSPO_3/',
      // eslint-disable-next-line lingui/no-unlocalized-strings -- fake seed caption data, not UI copy
      caption: 'Slow morning routine in five calm shots',
      authorHandle: 'lena.slowcuts',
      durationMs: 16_000,
      thumbnailUrl: null,
      savedAt: 1_760_000_005_000,
      templateId: templateIdOf(MORNING),
    },
  ],
  [
    'REEL_INSPO_4',
    {
      shortcode: 'REEL_INSPO_4',
      mediaPk: 'pk_inspo_4',
      collectionId: 'col_inspo',
      permalink: 'https://www.instagram.com/reel/REEL_INSPO_4/',
      // eslint-disable-next-line lingui/no-unlocalized-strings -- fake seed caption data, not UI copy
      caption: 'Three hooks before the first sip',
      authorHandle: 'dev.vlogs',
      durationMs: 12_400,
      thumbnailUrl: null,
      savedAt: 1_760_000_004_000,
      templateId: templateIdOf(HOOK_TEST),
    },
  ],
];

export function createFakeInstagramSaved(
  events: EventBus,
  _templates: FakeTemplates,
  readAuth: () => FakeInstagramAuthRead,
) {
  const collections = new Map<string, InstagramCollection>([
    [
      ALL_SAVED_COLLECTION_ID,
      {
        id: ALL_SAVED_COLLECTION_ID,
        name: 'All Saved',
        mediaCount: 5,
        coverUrl: null,
        watched: false,
        autoBreakdown: false,
        lastSyncedAt: 1_760_000_000_000,
        updatedAt: 1_760_000_000_000,
      },
    ],
    [
      'col_inspo',
      {
        id: 'col_inspo',
        name: 'Reels Inspo',
        mediaCount: 4,
        coverUrl: null,
        watched: false,
        autoBreakdown: false,
        lastSyncedAt: 1_760_000_000_000,
        updatedAt: 1_760_000_000_000,
      },
    ],
    [
      'col_hooks',
      {
        id: 'col_hooks',
        name: 'Strong Hooks',
        mediaCount: 1,
        coverUrl: null,
        watched: false,
        autoBreakdown: false,
        lastSyncedAt: 1_760_000_000_000,
        updatedAt: 1_760_000_000_000,
      },
    ],
  ]);

  const reels = new Map<string, InstagramSavedReel>([
    [
      'REEL_INSPO_1',
      {
        shortcode: 'REEL_INSPO_1',
        mediaPk: 'pk_inspo_1',
        collectionId: 'col_inspo',
        permalink: 'https://www.instagram.com/reel/REEL_INSPO_1/',
        // eslint-disable-next-line lingui/no-unlocalized-strings -- fake seed caption data, not UI copy
        caption: 'Golden hour street cuts synced to the snare',
        authorHandle: 'maya.edits',
        durationMs: 14_500,
        thumbnailUrl: null,
        savedAt: 1_760_000_030_000,
        templateId: null,
      },
    ],
    [
      'REEL_INSPO_2',
      {
        shortcode: 'REEL_INSPO_2',
        mediaPk: 'pk_inspo_2',
        collectionId: 'col_inspo',
        permalink: 'https://www.instagram.com/reel/REEL_INSPO_2/',
        // eslint-disable-next-line lingui/no-unlocalized-strings -- fake seed caption data, not UI copy
        caption: 'Three-beat jump cut intro for coffee reels',
        authorHandle: 'studio.kaia',
        durationMs: 21_000,
        thumbnailUrl: null,
        savedAt: 1_760_000_020_000,
        templateId: SEED_TEMPLATE_ID,
      },
    ],
    ...STYLE_PROFILE_REELS,
    [
      'REEL_HOOK_1',
      {
        shortcode: 'REEL_HOOK_1',
        mediaPk: 'pk_hook_1',
        collectionId: 'col_hooks',
        permalink: 'https://www.instagram.com/reel/REEL_HOOK_1/',
        // eslint-disable-next-line lingui/no-unlocalized-strings -- fake seed caption data, not UI copy
        caption: 'Cold open question before the beat drops',
        authorHandle: 'rohan.frames',
        durationMs: 18_200,
        thumbnailUrl: null,
        savedAt: 1_760_000_010_000,
        templateId: null,
      },
    ],
  ]);

  const notifyChanged = () => {
    events.emit('library.changed', {
      projectId: null,
      entity: 'template',
      change: 'updated',
      ids: [],
    });
  };

  function status(): InstagramSavedStatus {
    const auth = readAuth();
    const list = [...collections.values()];
    const watchedCollections = list.filter((c) => c.watched).length;
    const lastSyncedAt = list.reduce<number | null>(
      (max, c) => (c.lastSyncedAt !== null && (max === null || c.lastSyncedAt > max) ? c.lastSyncedAt : max),
      null,
    );
    return {
      signedIn: auth.signedIn,
      username: auth.signedIn ? (auth.username ?? 'creator.studio') : null,
      warning: INSTAGRAM_WARNING,
      acknowledgedAt: auth.acknowledgedAt ?? null,
      watchedCollections,
      lastSyncedAt,
    };
  }

  function listCollections(): InstagramCollection[] {
    return [...collections.values()];
  }

  function listReels(query: InstagramReelsQuery): InstagramReelsPage {
    const search = query.query?.trim().toLowerCase();
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    let cursorSavedAt: number | null = null;
    let cursorShortcode = '';
    if (query.cursor) {
      const sep = query.cursor.indexOf(':');
      if (sep > 0) {
        cursorSavedAt = Number(query.cursor.slice(0, sep));
        cursorShortcode = query.cursor.slice(sep + 1);
      }
    }
    const filtered = [...reels.values()]
      .filter((r) => {
        if (
          query.collectionId &&
          query.collectionId !== ALL_SAVED_COLLECTION_ID &&
          r.collectionId !== query.collectionId
        ) {
          return false;
        }
        if (query.onlyUnlinked && r.templateId !== null) return false;
        if (search) {
          const hay = `${r.caption ?? ''} ${r.authorHandle ?? ''} ${r.shortcode}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        if (cursorSavedAt !== null && Number.isFinite(cursorSavedAt)) {
          if (r.savedAt > cursorSavedAt) return false;
          if (r.savedAt === cursorSavedAt && r.shortcode >= cursorShortcode) return false;
        }
        return true;
      })
      .sort((a, b) => (b.savedAt !== a.savedAt ? b.savedAt - a.savedAt : b.shortcode.localeCompare(a.shortcode)));
    const hasMore = filtered.length > limit;
    const pageItems = hasMore ? filtered.slice(0, limit) : filtered;
    const last = pageItems[pageItems.length - 1];
    return {
      items: pageItems,
      nextCursor: hasMore && last ? `${last.savedAt}:${last.shortcode}` : null,
    };
  }

  const commands: AnyCommand[] = [
    defineCommand({
      name: N.setWatch,
      payload: P[N.setWatch],
      sideEffect: 'write',
      project: () => null,
      handle: ({ collectionId, watched, autoBreakdown }) => {
        const before = collections.get(collectionId);
        if (!before) return err(instagramCollectionNotFoundError({ collectionId }));
        const next: InstagramCollection = {
          ...before,
          watched,
          autoBreakdown: watched ? autoBreakdown : false,
          updatedAt: Date.now(),
        };
        collections.set(collectionId, next);
        notifyChanged();
        return ok({
          result: next,
          inverse: {
            name: N.setWatch,
            payload: {
              projectId: null,
              collectionId,
              watched: before.watched,
              autoBreakdown: before.autoBreakdown,
            },
          },
        });
      },
    }),
    defineCommand({
      name: N.syncCollection,
      payload: P[N.syncCollection],
      sideEffect: 'external',
      project: () => null,
      handle: ({ collectionId }) => {
        const now = Date.now();
        const allCols = [...collections.values()];
        const targets = collectionId
          ? [collectionId]
          : allCols.some((c) => c.watched)
            ? allCols.filter((c) => c.watched).map((c) => c.id)
            : [ALL_SAVED_COLLECTION_ID];
        for (const id of targets) {
          const col = collections.get(id);
          if (col) {
            collections.set(id, { ...col, lastSyncedAt: now, updatedAt: now });
          }
        }
        notifyChanged();
        return ok({
          result: {
            collections: listCollections(),
            syncedReels: reels.size,
            addedReels: 0,
            queuedBreakdowns: 0,
          },
        });
      },
    }),
    defineCommand({
      name: N.linkTemplate,
      payload: P[N.linkTemplate],
      sideEffect: 'write',
      project: () => null,
      handle: ({ shortcode, templateId }) => {
        const before = reels.get(shortcode);
        if (!before) return err(NotFoundError({ entity: 'instagramSavedReel', id: shortcode }));
        reels.set(shortcode, { ...before, templateId });
        notifyChanged();
        return ok({
          result: { shortcode, templateId },
          inverse: {
            name: N.linkTemplate,
            payload: { projectId: null, shortcode, templateId: before.templateId },
          },
        });
      },
    }),
  ];

  const tpl = implementContract(PROCEDURES);
  const router = {
    instagramStatus: tpl.instagramStatus.handler(() => status()),
    instagramCollections: tpl.instagramCollections.handler(() => listCollections()),
    instagramReels: tpl.instagramReels.handler(({ input }) => listReels(input)),
  };

  return { router, commands, status, listCollections, listReels };
}

export type FakeInstagramSaved = ReturnType<typeof createFakeInstagramSaved>;
