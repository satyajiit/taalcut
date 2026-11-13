// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: template search fuses template_fts's words with the template index's document and slot vectors.
 * LRN1-FIX: it is the Templates page's one answer: the words read within the filters, the trend filter, a slot
 * match's place and intent, and a whole answer within TEMPLATE_SEARCH_MAX_HITS.
 */
import { join } from 'node:path';
import {
  err,
  ok,
  TEMPLATE_SEARCH_MAX_HITS,
  templateListQuerySchema,
  templateSearchQuerySchema,
  templateVectorId,
  unwrap,
  ValidationError,
  type Embedder,
  type Template,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createTemplateSearch,
  createTemplateStore,
  openVectorIndex,
  TEMPLATE_SEARCH_V1,
  type TemplateSearchFusion,
  sqliteVecPath,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb, tempDir } from '../helpers';
import { template } from './documents';

const DIMS = 8;
const DIGEST = '0123456789abcdef';
const axis = (index: number) => Float32Array.from({ length: DIMS }, (_, at) => (at === index ? 1 : 0));

/** Query texts the fake embedder knows, each along one axis. */
const QUERIES: Record<string, Float32Array> = {
  'golden hour by the sea': axis(0),
  'pouring a latte': axis(1),
  'night bazaar': axis(2),
};

function embedder(fail = false): Embedder {
  return {
    space: { model: 'test', revision: '1', dimensions: DIMS, indexName: 'test_space' },
    embedTexts: async (texts) =>
      fail ? err(ValidationError({ field: 'texts' })) : ok(texts.map((text) => QUERIES[text] ?? axis(7))),
  };
}

async function world() {
  const db: LibraryDatabase = openTestDb({ extensions: [sqliteVecPath()] });
  const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
  const index = unwrap(openVectorIndex(db, { name: 'test_space_tpl', dimensions: DIMS }));
  const add = async (
    name: string,
    doc: number,
    slots: readonly number[],
    options = {},
  ): Promise<Template> => {
    const document = template(options);
    unwrap(await store.create(document, { name, projectId: null, listed: true }));
    unwrap(
      index.upsert([
        {
          id: templateVectorId({ kind: 'template', templateId: document.id, digest: DIGEST }),
          vector: axis(doc),
          metadata: { sourceId: document.id, kind: 'template' },
        },
        ...slots.map((direction, at) => ({
          id: templateVectorId({
            kind: 'intent',
            templateId: document.id,
            slotId: nth(document.slots, at).id,
            digest: DIGEST,
          }),
          vector: axis(direction),
          metadata: { sourceId: document.id, kind: 'intent' },
        })),
      ]),
    );
    return document;
  };
  const sunset = await add('Sunset beach reel', 0, [3, 3, 3]);
  const coffee = await add('Morning routine', 4, [5, 1, 5], {
    intents: ['alarm clock ringing', 'pouring coffee', 'walking out the door'],
    overlay: 'after a late night',
  });
  const market = await add('City nights', 2, [6, 6, 6], {
    intents: ['street food stall', 'neon signs', 'crowd at the market'],
  });
  // Floors measured in this test's space: an axis orthogonal to the query (cosine 0) doesn't count.
  const fusion = {
    ...TEMPLATE_SEARCH_V1,
    floors: { space: 'test_space', similarity: { meaning: 0.5, slot: 0.5 } },
  };
  const search = (fail = false, use: TemplateSearchFusion = fusion) =>
    createTemplateSearch({ db, vectors: index, embedder: embedder(fail), fusion: use });
  return { db, store, index, search, sunset, coffee, market };
}

const query = (text: string, extra: Record<string, unknown> = {}) =>
  templateSearchQuerySchema.parse({ text, ...extra });

/** The list's item at `index`; a test fails here when it is missing. */
function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item at ${index} of ${list.length}`);
  return item;
}

describe('template search', () => {
  it('finds a template by meaning when no word matches', async () => {
    const { search, sunset } = await world();
    const result = unwrap(await search().search(query('golden hour by the sea')));
    expect(result.degraded).toBeNull();
    expect(result.fusion).toBe('template-search-v1');
    expect(result.hits[0]?.summary.id).toBe(sunset.id);
    expect(result.hits[0]?.matchedBy).toEqual(['meaning']);
  });

  it('names the slot whose intent matched', async () => {
    const { search, coffee } = await world();
    const [hit] = unwrap(await search().search(query('pouring a latte'))).hits;
    expect(hit?.summary.id).toBe(coffee.id);
    expect(hit?.matchedBy).toContain('slot');
    expect(hit?.slotId).toBe(nth(coffee.slots, 1).id);
    // Its place and intent as the head has them, so a row says "slot 2's intent: pouring coffee" without a read.
    expect(hit?.slot).toEqual({ index: 1, intent: 'pouring coffee' });
  });

  it('ranks a template matched by words and meaning above one matched by either alone', async () => {
    const { search, market } = await world();
    const hits = unwrap(await search().search(query('night bazaar'))).hits;
    expect(hits[0]?.summary.id).toBe(market.id);
    expect(hits[0]?.matchedBy).toEqual(['words', 'meaning']);
    expect(hits[1]?.matchedBy).toEqual(['words']);
    expect(nth(hits, 0).score).toBeGreaterThan(nth(hits, 1).score);
  });

  it('answers from words alone, and says so, without an embedder or when embedding fails', async () => {
    const { db, search, coffee } = await world();
    const failed = unwrap(await search(true).search(query('pouring coffee')));
    expect(failed.degraded).toBe('keyword-only');
    expect(failed.hits.map((hit) => hit.summary.id)).toEqual([coffee.id]);
    const none = createTemplateSearch({ db, vectors: null, embedder: null });
    expect(unwrap(await none.search(query('coffee'))).degraded).toBe('keyword-only');
  });

  it("keeps list's filters: archived only when asked, by tag, and the limit", async () => {
    const { store, search, sunset } = await world();
    unwrap(await store.setMeta(sunset.id, { archived: true }));
    const ids = async (extra: Record<string, unknown>) =>
      unwrap(await search().search(query('golden hour by the sea', extra))).hits.map((hit) => hit.summary.id);
    expect(await ids({})).not.toContain(sunset.id);
    expect((await ids({ includeArchived: true }))[0]).toBe(sunset.id);
    unwrap(await store.setMeta(sunset.id, { archived: false, tags: ['travel'] }));
    expect(await ids({ tags: ['travel'] })).toEqual([sunset.id]);
    expect(await ids({ limit: 1 })).toHaveLength(1);
  });

  it('applies floors only in the space they were measured in: elsewhere every neighbour counts', async () => {
    const { search, sunset } = await world();
    const elsewhere = {
      ...TEMPLATE_SEARCH_V1,
      floors: { space: 'other_space', similarity: { meaning: 0.5 } },
    };
    const hits = unwrap(await search(false, elsewhere).search(query('golden hour by the sea'))).hits;
    expect(hits).toHaveLength(3);
    expect(hits.find((hit) => hit.summary.id === sunset.id)?.matchedBy).toContain('meaning');
  });

  it('never passes the text to FTS5 as syntax', async () => {
    const { search } = await world();
    expect((await search(true).search(query('"coffee" OR NEAR(a b) *'))).ok).toBe(true);
  });

  it('finds by any word where the list asks for every one: the Templates page reads only this answer', async () => {
    const { store, search, coffee } = await world();
    const words = 'someone pouring coffee with text on screen';
    // templates.list's free text needs every word ("with", "screen" …) as a prefix: nothing has them all.
    const listed = unwrap(await store.list(templateListQuerySchema.parse({ query: words })));
    expect(listed.items).toEqual([]);
    // Search drops the stopwords and asks for any term: the template with "pouring coffee" is found by its words.
    const found = unwrap(await search(true).search(query(words))).hits;
    expect(found.map((hit) => hit.summary.id)).toEqual([coffee.id]);
    expect(found[0]?.matchedBy).toEqual(['words']);
  });

  it('reads the words within the filters, so a scope’s matches aren’t crowded out by the rest', async () => {
    const { store, search, sunset, coffee } = await world();
    // One word hit fused: library-wide, one of the two templates with these words takes the only place.
    const narrow = { ...TEMPLATE_SEARCH_V1, wordLimit: 1 };
    const ids = async (extra: Record<string, unknown>) =>
      unwrap(await search(true, narrow).search(query('morning beach', extra))).hits.map(
        (hit) => hit.summary.id,
      );
    const everywhere = await ids({});
    expect(everywhere).toHaveLength(1);
    const other = everywhere[0] === sunset.id ? coffee.id : sunset.id;
    unwrap(await store.setMeta(other, { tags: ['travel'] }));
    expect(await ids({ tags: ['travel'] })).toEqual([other]);
  });

  it('takes the trend filter as the list does, with the stored setting', async () => {
    const { store, search, sunset, coffee, market } = await world();
    unwrap(await store.setMeta(sunset.id, { trendFreshness: { date: '2020-01-01', source: 'user' } }));
    unwrap(await store.setMeta(coffee.id, { trendFreshness: { date: '2999-01-01', source: 'user' } }));
    const ids = async (stale: boolean) =>
      unwrap(await search(true).search(query('beach coffee market', { stale }))).hits.map(
        (hit) => hit.summary.id,
      );
    expect(await ids(true)).toEqual([sunset.id]);
    expect((await ids(false)).sort()).toEqual([coffee.id, market.id].sort());
  });

  it('returns a whole answer: template-search-v1’s lists hold fewer templates than one search returns', () => {
    const { wordLimit, knn } = TEMPLATE_SEARCH_V1;
    expect(wordLimit + 2 * knn).toBeLessThanOrEqual(TEMPLATE_SEARCH_MAX_HITS);
    expect(query('sea', { limit: TEMPLATE_SEARCH_MAX_HITS }).limit).toBe(TEMPLATE_SEARCH_MAX_HITS);
  });
});
