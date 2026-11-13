// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ALL_SAVED_COLLECTION_ID,
  createCommandBus,
  createMemoryAuditLogStore,
  formatInstagramNetscapeCookies,
  INSTAGRAM_SAVED_COMMANDS,
  INSTAGRAM_WARNING,
  newId,
  ok,
  unwrap,
  type InstagramCollection,
  type InstagramSavedReel,
  type InstagramSavedStore,
  type InstagramSessionProvider,
  type InstagramWebSession,
  type TemplateId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createInstagramSavedCommands,
  createInstagramSavedService,
  createInstagramWebClient,
  MAX_AUTO_BREAKDOWNS_PER_SYNC,
  referenceFetchArgs,
} from '../src/index';

function createMemoryInstagramStore(): InstagramSavedStore {
  const collections = new Map<string, InstagramCollection>();
  const reels = new Map<string, InstagramSavedReel>();

  return {
    async listCollections() {
      return ok([...collections.values()]);
    },
    async getCollection(id) {
      return ok(collections.get(id) ?? null);
    },
    async upsertCollections(items) {
      for (const item of items) {
        const prev = collections.get(item.id);
        collections.set(item.id, {
          id: item.id,
          name: item.name,
          mediaCount: item.mediaCount,
          coverUrl: item.coverUrl,
          watched: prev?.watched ?? false,
          autoBreakdown: prev?.autoBreakdown ?? false,
          lastSyncedAt: item.lastSyncedAt ?? prev?.lastSyncedAt ?? null,
          updatedAt: 1000,
        });
      }
      return ok([...collections.values()]);
    },
    async setWatch({ collectionId, watched, autoBreakdown }) {
      const prev = collections.get(collectionId)!;
      const next: InstagramCollection = {
        ...prev,
        watched,
        autoBreakdown: watched ? autoBreakdown : false,
        updatedAt: 2000,
      };
      collections.set(collectionId, next);
      return ok(next);
    },
    async listReels(query) {
      let items = [...reels.values()];
      if (query.collectionId && query.collectionId !== ALL_SAVED_COLLECTION_ID) {
        items = items.filter((r) => r.collectionId === query.collectionId);
      }
      if (query.onlyUnlinked) {
        items = items.filter((r) => r.templateId === null);
      }
      return ok({ items: items.slice(0, query.limit ?? 50), nextCursor: null });
    },
    async upsertReels(items) {
      const addedShortcodes: string[] = [];
      for (const item of items) {
        const prev = reels.get(item.shortcode);
        const nextCollectionId =
          item.collectionId === ALL_SAVED_COLLECTION_ID &&
          prev &&
          prev.collectionId !== ALL_SAVED_COLLECTION_ID
            ? prev.collectionId
            : item.collectionId;
        if (!prev || prev.collectionId !== nextCollectionId) {
          addedShortcodes.push(item.shortcode);
        }
        reels.set(item.shortcode, {
          ...item,
          collectionId: nextCollectionId,
          templateId: prev?.templateId ?? null,
        });
      }
      return ok({ addedShortcodes });
    },
    async linkTemplate(shortcode, templateId: TemplateId | null) {
      const prev = reels.get(shortcode)!;
      reels.set(shortcode, { ...prev, templateId });
      return ok({ previousTemplateId: prev.templateId });
    },
  };
}

function fakeSession(): {
  provider: InstagramSessionProvider;
  invalidated: () => boolean;
} {
  let active: InstagramWebSession | null = {
    username: 'satyajit',
    headers: {
      cookie: 'sessionid=s1; csrftoken=c1; ds_user_id=u1',
      'x-csrftoken': 'c1',
    },
    cookiesNetscape: formatInstagramNetscapeCookies({
      sessionId: 's1',
      csrfToken: 'c1',
      dsUserId: 'u1',
    }),
  };
  let wasInvalidated = false;
  return {
    invalidated: () => wasInvalidated,
    provider: {
      async getSession() {
        return ok(active);
      },
      async invalidate() {
        wasInvalidated = true;
        active = null;
        return ok(undefined);
      },
    },
  };
}

describe('Instagram Saved client, service, and commands', () => {
  it('parses collections and saved Reels from the Instagram Web API and skips non-video photos', async () => {
    const { provider } = fakeSession();
    const client = createInstagramWebClient({
      sessionProvider: provider,
      clock: { now: () => 5000 },
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/collections/list/')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  collection_id: 'ALL_MEDIA_AUTO_COLLECTION',
                  collection_name: 'All Posts',
                  collection_type: 'ALL_MEDIA_AUTO_COLLECTION',
                  collection_media_count: 10,
                },
                {
                  collection_id: '180123456',
                  collection_name: 'Reels Ideas',
                  collection_type: 'MEDIA',
                  collection_media_count: 4,
                  cover_media: {
                    image_versions2: {
                      candidates: [{ url: 'https://cdn.instagram.com/cover.jpg' }],
                    },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                media: {
                  pk: '9001',
                  code: 'REEL_ONE',
                  media_type: 2,
                  product_type: 'clips',
                  video_duration: 15.4,
                  taken_at: 1700000000,
                  caption: { text: 'Transitions tutorial' },
                  user: { username: 'editor_pro' },
                  image_versions2: {
                    candidates: [{ url: 'https://cdn.instagram.com/thumb1.jpg' }],
                  },
                },
              },
              {
                // Photo post (media_type 1): should be ignored.
                media: {
                  pk: '9002',
                  code: 'PHOTO_ONLY',
                  media_type: 1,
                },
              },
            ],
            more_available: false,
          }),
          { status: 200 },
        );
      },
    });

    const collections = unwrap(await client.fetchCollections());
    expect(collections.map((c) => ({ id: c.id, name: c.name }))).toEqual([
      { id: ALL_SAVED_COLLECTION_ID, name: 'All Posts' },
      { id: '180123456', name: 'Reels Ideas' },
    ]);

    const reels = unwrap(await client.fetchCollectionReels('180123456'));
    expect(reels).toEqual([
      {
        shortcode: 'REEL_ONE',
        mediaPk: '9001',
        collectionId: '180123456',
        permalink: 'https://www.instagram.com/reel/REEL_ONE/',
        caption: 'Transitions tutorial',
        authorHandle: 'editor_pro',
        durationMs: 15_400,
        thumbnailUrl: 'https://cdn.instagram.com/thumb1.jpg',
        savedAt: 5000,
      },
    ]);
  });

  it('invalidates the session when Instagram returns login_required or HTTP 401', async () => {
    const { provider, invalidated } = fakeSession();
    const client = createInstagramWebClient({
      sessionProvider: provider,
      clock: { now: () => 5000 },
      fetch: async () =>
        new Response(JSON.stringify({ message: 'login_required', status: 'fail' }), { status: 400 }),
    });

    const result = await client.fetchCollections();
    expect(!result.ok && result.error.code).toBe('templates.instagram_session_expired');
    expect(invalidated()).toBe(true);
  });

  it('syncs watched collections, caps auto-breakdown at 5 reels, and supports undoable watch/link commands', async () => {
    const { provider } = fakeSession();
    const store = createMemoryInstagramStore();
    const autoBrokenDown: string[] = [];

    const client = createInstagramWebClient({
      sessionProvider: provider,
      clock: { now: () => 5000 },
      fetch: async (input) => {
        const url = String(input);
        if (url.includes('/collections/list/')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  collection_id: 'col_inspo',
                  collection_name: 'Inspo',
                  collection_type: 'MEDIA',
                  collection_media_count: 7,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            items: Array.from({ length: 7 }, (_, idx) => ({
              media: {
                pk: `pk_${idx}`,
                code: `CODE_${idx}`,
                media_type: 2,
                product_type: 'clips',
                video_duration: 12,
              },
            })),
            more_available: false,
          }),
          { status: 200 },
        );
      },
    });

    const service = createInstagramSavedService({
      store,
      client,
      sessionProvider: provider,
      acknowledgements: {
        latest: async () =>
          ok({
            featureId: INSTAGRAM_WARNING.feature,
            termsVersion: INSTAGRAM_WARNING.termsVersion,
            acknowledgedAt: 4000,
            context: null,
          }),
      },
      onAutoBreakdown: async (reels) => {
        autoBrokenDown.push(...reels.map((r) => r.shortcode));
        return reels.length;
      },
    });

    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: { now: () => 5000 } });
    for (const cmd of createInstagramSavedCommands({ store, service }).all) {
      bus.register(cmd);
    }

    const origin = { source: 'ui' as const, actor: 'user' };

    // First sync discovers the collection.
    unwrap(
      await bus.dispatch(INSTAGRAM_SAVED_COMMANDS.syncCollection, { projectId: null }, origin),
    );

    // Enable watch + autoBreakdown on col_inspo.
    unwrap(
      await bus.dispatch(
        INSTAGRAM_SAVED_COMMANDS.setWatch,
        { projectId: null, collectionId: 'col_inspo', watched: true, autoBreakdown: true },
        origin,
      ),
    );

    // Syncing col_inspo pulls 7 reels and caps auto-breakdown at MAX_AUTO_BREAKDOWNS_PER_SYNC (5).
    const syncReceipt = unwrap(
      await bus.dispatch(
        INSTAGRAM_SAVED_COMMANDS.syncCollection,
        { projectId: null, collectionId: 'col_inspo' },
        origin,
      ),
    );
    expect(syncReceipt.result).toMatchObject({
      syncedReels: 7,
      addedReels: 7,
      queuedBreakdowns: MAX_AUTO_BREAKDOWNS_PER_SYNC,
    });
    expect(autoBrokenDown).toHaveLength(MAX_AUTO_BREAKDOWNS_PER_SYNC);

    // Link a template and undo it.
    const tplId = newId<'Template'>();
    unwrap(
      await bus.dispatch(
        INSTAGRAM_SAVED_COMMANDS.linkTemplate,
        { projectId: null, shortcode: 'CODE_0', templateId: tplId },
        origin,
      ),
    );
    expect(unwrap(await store.listReels({ onlyUnlinked: false, limit: 10 })).items[0]?.templateId).toBe(
      tplId,
    );

    unwrap(await bus.undo(null, { source: 'shortcut', actor: 'user' }));
    expect(unwrap(await store.listReels({ onlyUnlinked: false, limit: 10 })).items[0]?.templateId).toBeNull();
  });

  it('includes --cookies scratch:ig-cookies.txt in referenceFetchArgs when requested', () => {
    const args = referenceFetchArgs('https://www.instagram.com/reel/ABC/', {
      cookiesFile: 'scratch:ig-cookies.txt',
    });
    expect(args).toContain('--cookies');
    expect(args[args.indexOf('--cookies') + 1]).toBe('scratch:ig-cookies.txt');
  });
});
