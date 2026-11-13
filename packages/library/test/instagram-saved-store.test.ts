// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ALL_SAVED_COLLECTION_ID, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createInstagramSavedStore, createTemplateStore } from '../src/index';
import { fakeClock, openTestDb, tempDir } from './helpers';
import { template } from './stores/documents';

describe('InstagramSavedStore', () => {
  it('upserts collections, preserves watch flags, and orders all_saved first', async () => {
    const clock = fakeClock();
    const db = openTestDb({ clock: clock.now });
    const store = createInstagramSavedStore(db);

    const initial = unwrap(
      await store.upsertCollections([
        {
          id: 'col_travel',
          name: 'Travel Transitions',
          mediaCount: 12,
          coverUrl: 'https://example.com/travel.jpg',
          lastSyncedAt: 1000,
        },
        {
          id: ALL_SAVED_COLLECTION_ID,
          name: 'All saved',
          mediaCount: 42,
          coverUrl: null,
          lastSyncedAt: 1000,
        },
      ]),
    );
    expect(initial.map((c) => c.id)).toEqual([ALL_SAVED_COLLECTION_ID, 'col_travel']);
    expect(initial[1]?.watched).toBe(false);

    clock.advance(500);
    const watched = unwrap(
      await store.setWatch({ collectionId: 'col_travel', watched: true, autoBreakdown: true }),
    );
    expect(watched).toMatchObject({ id: 'col_travel', watched: true, autoBreakdown: true });

    clock.advance(500);
    const updated = unwrap(
      await store.upsertCollections([
        {
          id: 'col_travel',
          name: 'Travel Transitions 2026',
          mediaCount: 14,
          coverUrl: 'https://example.com/travel2.jpg',
          lastSyncedAt: 2000,
        },
      ]),
    );
    const travel = updated.find((c) => c.id === 'col_travel');
    expect(travel).toMatchObject({
      name: 'Travel Transitions 2026',
      mediaCount: 14,
      watched: true,
      autoBreakdown: true,
      lastSyncedAt: 2000,
    });
    db.close();
  });

  it('upserts reels, paginates, filters by unlinked and search, and links templates', async () => {
    const clock = fakeClock();
    const db = openTestDb({ clock: clock.now });
    const store = createInstagramSavedStore(db);
    const templates = createTemplateStore(db, { assetsDir: tempDir() });

    unwrap(
      await store.upsertCollections([
        { id: ALL_SAVED_COLLECTION_ID, name: 'All saved', mediaCount: 3, coverUrl: null },
        { id: 'col_hooks', name: 'Hooks', mediaCount: 2, coverUrl: null },
      ]),
    );

    const firstUpsert = unwrap(
      await store.upsertReels([
        {
          shortcode: 'DD111',
          mediaPk: '111',
          collectionId: 'col_hooks',
          permalink: 'https://www.instagram.com/reel/DD111/',
          caption: 'Fast whip pan transition in Kyoto',
          authorHandle: 'creator_one',
          durationMs: 14_200,
          thumbnailUrl: 'https://example.com/111.jpg',
          savedAt: 1000,
        },
        {
          shortcode: 'DD222',
          mediaPk: '222',
          collectionId: 'col_hooks',
          permalink: 'https://www.instagram.com/reel/DD222/',
          caption: 'Morning routine match cut',
          authorHandle: 'creator_two',
          durationMs: 22_000,
          thumbnailUrl: 'https://example.com/222.jpg',
          savedAt: 2000,
        },
        {
          shortcode: 'DD333',
          mediaPk: '333',
          collectionId: ALL_SAVED_COLLECTION_ID,
          permalink: 'https://www.instagram.com/reel/DD333/',
          caption: 'Beat drop montage',
          authorHandle: 'creator_three',
          durationMs: 9500,
          thumbnailUrl: null,
          savedAt: 3000,
        },
      ]),
    );
    expect(firstUpsert.addedShortcodes).toEqual(['DD111', 'DD222', 'DD333']);

    // Re-upserting reports only newly added shortcodes.
    const secondUpsert = unwrap(
      await store.upsertReels([
        {
          shortcode: 'DD222',
          mediaPk: '222',
          collectionId: 'col_hooks',
          permalink: 'https://www.instagram.com/reel/DD222/',
          caption: 'Morning routine match cut (edited)',
          authorHandle: 'creator_two',
          durationMs: 22_000,
          thumbnailUrl: 'https://example.com/222.jpg',
          savedAt: 2000,
        },
      ]),
    );
    expect(secondUpsert.addedShortcodes).toEqual([]);

    // All saved query returns all 3 reels in descending savedAt order.
    const page1 = unwrap(
      await store.listReels({ collectionId: ALL_SAVED_COLLECTION_ID, onlyUnlinked: false, limit: 2 }),
    );
    expect(page1.items.map((r) => r.shortcode)).toEqual(['DD333', 'DD222']);
    expect(page1.nextCursor).toBe('2000:DD222');

    const page2 = unwrap(
      await store.listReels({
        collectionId: ALL_SAVED_COLLECTION_ID,
        onlyUnlinked: false,
        limit: 2,
        cursor: page1.nextCursor ?? undefined,
      }),
    );
    expect(page2.items.map((r) => r.shortcode)).toEqual(['DD111']);
    expect(page2.nextCursor).toBeNull();

    // Search by caption or author handle.
    const searched = unwrap(
      await store.listReels({ query: 'Kyoto', onlyUnlinked: false, limit: 10 }),
    );
    expect(searched.items.map((r) => r.shortcode)).toEqual(['DD111']);

    // Create a minimal template and link it to DD222.
    const doc = template();
    const created = unwrap(
      await templates.create(doc, { name: 'Morning routine', projectId: null, listed: true }),
    );

    const linked = unwrap(await store.linkTemplate('DD222', created.id));
    expect(linked.previousTemplateId).toBeNull();

    const unlinkedOnly = unwrap(
      await store.listReels({ collectionId: 'col_hooks', onlyUnlinked: true, limit: 10 }),
    );
    expect(unlinkedOnly.items.map((r) => r.shortcode)).toEqual(['DD111']);

    // Creating a template with an Instagram reference URL automatically links the matching saved reel.
    const baseDoc = template();
    const refDoc = {
      ...baseDoc,
      origin: {
        ...baseDoc.origin,
        url: 'https://www.instagram.com/reel/DD111/?igsh=xyz',
      },
    };
    const autoLinkedTemplate = unwrap(
      await templates.create(refDoc, { name: 'Kyoto Whip Pan', projectId: null, listed: true }),
    );
    const afterAutoLink = unwrap(
      await store.listReels({ collectionId: 'col_hooks', onlyUnlinked: false, limit: 10 }),
    );
    expect(afterAutoLink.items.find((r) => r.shortcode === 'DD111')?.templateId).toBe(
      autoLinkedTemplate.id,
    );

    // Search with SQLite wildcard characters (% and _) treats them literally.
    const wildcardSearch = unwrap(
      await store.listReels({ query: '100%_match', onlyUnlinked: false, limit: 10 }),
    );
    expect(wildcardSearch.items).toEqual([]);

    // Clearing the store removes all cached collections and reels.
    expect(store.clear).toBeDefined();
    unwrap(await store.clear!());
    expect(unwrap(await store.listCollections())).toEqual([]);
    expect(unwrap(await store.listReels({ onlyUnlinked: false, limit: 10 })).items).toEqual([]);
    db.close();
  });
});

