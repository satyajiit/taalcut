// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM: the memory index writer and the ranker. Sync embeds what it is told about and drops what is gone or
 * can't be embedded now; reconcile fills an empty index and drops vectors a cascade orphaned; following the event
 * bus keeps the index in step after commits. The ranker returns every candidate when there are k or fewer, fuses
 * meaning, words and recency otherwise, and still ranks while the embedding model isn't served.
 */
import {
  createEventBus,
  err,
  memoryIndexName,
  newId,
  unwrap,
  type Embedder,
  type MemoryItem,
} from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryIndexer,
  createMemoryRanker,
  createMemoryStore,
  openVectorIndex,
  sqliteVecPath,
} from '../../src/index';
import { createFakeEmbedder, FAKE_DIMENSIONS, FAKE_SPACE } from '../fixtures/fake-embedder';
import { openTestDb } from '../helpers';
import { memoryItem, scopes } from './memory-setup';

function setup(embedder: Embedder = createFakeEmbedder()) {
  const db = openTestDb({ extensions: [sqliteVecPath()] });
  const index = unwrap(
    openVectorIndex(db, { name: memoryIndexName(FAKE_SPACE.indexName), dimensions: FAKE_DIMENSIONS }),
  );
  const store = createMemoryStore(db);
  const indexer = createMemoryIndexer({ db, index, embedder });
  const add = async (...items: MemoryItem[]) => {
    for (const item of items) unwrap(await store.create(item));
    return items.map((item) => item.id);
  };
  return { db, index, store, indexer, add };
}

const failing: Embedder = {
  space: FAKE_SPACE,
  embedTexts: async () => err({ code: 'models.not_ready', messageKey: 'models.notReady', retryable: true }),
};

describe('memory index writer (LRN1-MEM)', () => {
  it('embeds the items it syncs, with their scope, and drops the ones gone from the store', async () => {
    const { db, index, store, indexer, add } = setup();
    const { project, projectId } = await scopes(db);
    const [user, decision] = await add(
      memoryItem({ text: 'Never use whip transitions.' }),
      memoryItem({ scope: project, text: 'Open on the beach at sunset.' }),
    );
    expect(unwrap(await indexer.sync([user!, decision!, user!]))).toEqual({
      embedded: 2,
      removed: 0,
      pending: 0,
    });
    expect(unwrap(index.ids({ kind: 'project', sourceId: projectId }))).toEqual([decision]);
    expect(unwrap(index.ids({ kind: 'user' }))).toEqual([user]);
    unwrap(await store.remove(user!));
    expect(unwrap(await indexer.sync([user!]))).toEqual({ embedded: 0, removed: 1, pending: 0 });
    expect(index.count()).toBe(1);
  });

  it("drops an item's old vector when its new text can't be embedded, and reconcile embeds it later", async () => {
    const embedder = createFakeEmbedder();
    const live = { ...embedder, embedTexts: vi.fn(embedder.embedTexts) };
    const { index, store, indexer, add } = setup(live);
    const [id] = await add(memoryItem({ text: 'Captions in bold yellow.' }));
    unwrap(await indexer.sync([id!]));
    const item = unwrap(await store.get(id!));
    unwrap(await store.put({ ...item, text: 'Captions at the beach.', revision: 2 }, 1));
    live.embedTexts.mockImplementationOnce(failing.embedTexts);
    expect(unwrap(await indexer.sync([id!]))).toEqual({ embedded: 0, removed: 1, pending: 1 });
    expect(index.count()).toBe(0);
    expect(unwrap(await indexer.reconcile())).toEqual({ embedded: 1, removed: 0, pending: 0 });
    expect(unwrap(index.ids())).toEqual([id]);
  });

  it('fills an empty index, keeps vectors it has, and drops the ones a cascade orphaned', async () => {
    const embedder = createFakeEmbedder();
    const { db, index, indexer, add } = setup(embedder);
    const { project, projectId, template } = await scopes(db);
    const ids = await add(
      memoryItem({ text: 'Never use whip transitions.' }),
      memoryItem({ scope: project, text: 'Keep the drone opener.' }),
      memoryItem({ scope: template, text: 'Sunset montage reached export.', source: 'learned' }),
    );
    expect(unwrap(await indexer.reconcile())).toEqual({ embedded: 3, removed: 0, pending: 0 });
    expect(new Set(unwrap(index.ids()))).toEqual(new Set(ids));
    db.driver.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    const calls = embedder.calls.length;
    const report = unwrap(await indexer.reconcile());
    expect(report).toMatchObject({ embedded: 0, pending: 0 });
    expect(embedder.calls.length).toBe(calls);
    expect(new Set(unwrap(index.ids()))).toEqual(new Set([ids[0], ids[2]]));
  });

  it('reports pending items when the embedder is not served yet', async () => {
    const { index, indexer, add } = setup(failing);
    await add(memoryItem(), memoryItem({ text: 'Always add captions.' }));
    expect(unwrap(await indexer.reconcile())).toEqual({ embedded: 0, removed: 0, pending: 2 });
    expect(index.count()).toBe(0);
  });

  it('follows committed memory changes, and reconciles after a project is deleted', async () => {
    const { db, index, indexer, add } = setup();
    const { project, projectId } = await scopes(db);
    const events = createEventBus({ clock: { now: () => 1 } });
    const stop = indexer.follow(events);
    const [id] = await add(memoryItem({ scope: project, text: 'Keep the drone opener.' }));
    events.emit('library.changed', { projectId: null, entity: 'memory', change: 'created', ids: [id!] });
    await vi.waitFor(() => expect(index.count()).toBe(1));
    db.driver.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    events.emit('library.changed', { projectId, entity: 'project', change: 'deleted', ids: [projectId] });
    await vi.waitFor(() => expect(index.count()).toBe(0));
    stop();
  });
});

describe('memory ranker (LRN1-MEM)', () => {
  const texts = [
    'Never use whip transitions.',
    'Captions in bold yellow.',
    'Prefer the beach shots at sunset.',
    'Keep intros under two seconds.',
    'Music should build to the drop.',
    'Night shots need the warm grade.',
  ];

  async function ranked(space: 'served' | 'absent') {
    const { db, index, store, indexer, add } = setup();
    const { project } = await scopes(db);
    const ids = await add(
      ...texts.map((text) => memoryItem({ text })),
      memoryItem({ scope: project, text: 'Sunset beach finale.' }),
    );
    unwrap(await indexer.reconcile());
    const embedder = createFakeEmbedder();
    const ranker = createMemoryRanker({
      store,
      space: async () => (space === 'served' ? { index, embedder } : null),
    });
    return { ids, ranker, project, embedder };
  }

  it('returns every candidate, newest first, when there are k or fewer', async () => {
    const { ids, ranker } = await ranked('served');
    const all = unwrap(await ranker.rank({ scopes: [{ kind: 'user' }], query: 'beach', k: 10 }));
    expect(all.map((entry) => entry.item.id)).toEqual(ids.slice(0, texts.length).reverse());
    expect(all.every((entry) => entry.score === 1 && entry.matchedBy.join() === 'recency')).toBe(true);
  });

  it('fuses meaning, words and recency for the top k, only within the scopes asked for', async () => {
    const { ids, ranker, project, embedder } = await ranked('served');
    const top = unwrap(
      await ranker.rank({ scopes: [{ kind: 'user' }, project], query: 'sunset beach', k: 2 }),
    );
    expect(top.map((entry) => entry.item.id)).toEqual([ids[6], ids[2]]);
    expect(top[0]!.matchedBy).toEqual(['meaning', 'words', 'recency']);
    expect(top[0]!.score).toBeGreaterThan(0.5);
    expect(top[0]!.score).toBeLessThanOrEqual(1);
    expect(embedder.calls).toEqual([['sunset beach']]);
    const userOnly = unwrap(await ranker.rank({ scopes: [{ kind: 'user' }], query: 'sunset beach', k: 1 }));
    expect(userOnly.map((entry) => entry.item.id)).toEqual([ids[2]]);
  });

  it('ranks by words and recency while the embedding model is not served, and by recency with no query', async () => {
    const { ids, ranker } = await ranked('absent');
    const scope = [{ kind: 'user' as const }];
    const words = unwrap(await ranker.rank({ scopes: scope, query: 'whip transitions', k: 2 }));
    expect(words[0]!.item.id).toBe(ids[0]);
    expect(words[0]!.matchedBy).toEqual(['words', 'recency']);
    const recent = unwrap(await ranker.rank({ scopes: scope, query: '  ', k: 2 }));
    expect(recent.map((entry) => entry.item.id)).toEqual([ids[5], ids[4]]);
  });

  it('ranks nothing for scopes that hold nothing', async () => {
    const { ranker } = await ranked('served');
    const none = unwrap(
      await ranker.rank({
        scopes: [{ kind: 'project', projectId: newId<'Project'>() }],
        query: 'beach',
        k: 2,
      }),
    );
    expect(none).toEqual([]);
  });
});
