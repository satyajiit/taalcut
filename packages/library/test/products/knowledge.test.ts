// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, productSchema, unwrap, type ProductKnowledge } from '@taalcut/core';
import { expect, it } from 'vitest';
import { createProductStore } from '../../src';
import { productKnowledgeSearch } from '../../src/migrations/0048-product-knowledge-search';
import { openTestDb } from '../helpers';

const COVERAGE = 'taalcut:index-coverage';
async function fixture() {
  const db = openTestDb({ file: false });
  const store = createProductStore(db);
  const sources = [newId<'CreationSource'>(), newId<'CreationSource'>()];
  const product = productSchema.parse({
    id: newId<'Product'>(),
    name: 'Editor',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    sources: sources.map((id) => ({ id, kind: 'url', label: 'Docs', url: 'https://example.com' })),
  });
  unwrap(await store.save(product, 0));
  const doc = (source: number, locator: string, text = 'Useful workflow evidence'): ProductKnowledge => ({
    id: newId<'ProductKnowledge'>(),
    productId: product.id,
    sourceId: sources[source]!,
    locator,
    digest: `${source}:${locator}:${text}`,
    title: locator,
    text,
    capturedAt: 1,
  });
  return { db, store, product, sources, doc };
}

it('reaches every document beyond 2,000 across sources with coverage-first stable pages', async () => {
  const f = await fixture();
  const first = Array.from({ length: 2200 }, (_, index) => f.doc(0, `file-${index}.md`));
  const second = Array.from({ length: 20 }, (_, index) => f.doc(1, `site-${index}`));
  first.push(f.doc(0, COVERAGE, 'Repository scan was limited; missing evidence is not an absent feature.'));
  second.push(f.doc(1, COVERAGE, 'Website excerpts are partial.'));
  unwrap(await f.store.replaceKnowledge(f.product.id, f.sources[0]!, first));
  unwrap(await f.store.replaceKnowledge(f.product.id, f.sources[1]!, second));
  const initial = unwrap(await f.store.knowledgePage(f.product.id, { limit: 71 }));
  expect(initial.items.slice(0, 2).map((item) => item.locator)).toEqual([COVERAGE, COVERAGE]);
  const ids = initial.items.map((item) => item.id);
  let after = initial.nextCursor;
  while (after) {
    const page = unwrap(await f.store.knowledgePage(f.product.id, { after, limit: 71 }));
    expect(page.items.length).toBeLessThanOrEqual(71);
    ids.push(...page.items.map((item) => item.id));
    after = page.nextCursor;
  }
  expect(new Set(ids).size).toBe(2222);
  expect(ids).toHaveLength(2222);
  expect(new Set(ids)).toEqual(new Set([...first, ...second].map((item) => item.id)));
  const recall = unwrap(await f.store.knowledge(f.product.id));
  expect(recall).toHaveLength(200);
  expect(recall.slice(0, 2).every((item) => item.locator === COVERAGE)).toBe(true);
  expect(new Set(recall.slice(2, 4).map((item) => item.sourceId)).size).toBe(2);
  const selected = first.find((item) => !recall.some((sample) => sample.id === item.id))!;
  expect(unwrap(await f.store.knowledgeByIds(f.product.id, [selected.id, selected.id]))).toEqual([selected]);
  expect(unwrap(await f.store.knowledgeByIds(newId<'Product'>(), [selected.id]))).toEqual([]);
  expect((await f.store.knowledgeByIds(f.product.id, Array(101).fill(selected.id))).ok).toBe(false);
  expect((await f.store.knowledgePage(f.product.id, { after: "' OR 1=1" })).ok).toBe(false);
});

it('finds late relevant documents with indexed ranked recall and retains source warnings during search', async () => {
  const f = await fixture();
  const first = Array.from({ length: 2100 }, (_, index) => f.doc(0, `old-${index}.md`));
  const relevant = f.doc(0, 'late-feature.md', 'Zebrastack collaborative routing workflow');
  const otherSource = f.doc(1, 'routing-docs', 'Zebrastack workflow from the website');
  const coverage = f.doc(1, COVERAGE, 'This source index is bounded. Some pages were omitted.');
  unwrap(await f.store.replaceKnowledge(f.product.id, f.sources[0]!, [...first, relevant]));
  unwrap(await f.store.replaceKnowledge(f.product.id, f.sources[1]!, [otherSource, coverage]));
  const recall = unwrap(await f.store.knowledge(f.product.id, 'Zebrastack routing'));
  expect(recall[0]!.id).toBe(coverage.id);
  expect(new Set(recall.slice(1).map((item) => item.id))).toEqual(new Set([relevant.id, otherSource.id]));
  const page = unwrap(await f.store.knowledgePage(f.product.id, { query: 'Zebrastack', limit: 2 }));
  const tail = unwrap(
    await f.store.knowledgePage(f.product.id, { query: 'Zebrastack', after: page.nextCursor!, limit: 2 }),
  );
  expect(new Set([...page.items, ...tail.items].map((item) => item.id))).toEqual(
    new Set([coverage.id, relevant.id, otherSource.id]),
  );
  expect(tail.nextCursor).toBeNull();
  expect(unwrap(await f.store.knowledgePage(f.product.id, { query: '% _ "*' })).items).toEqual([coverage]);
  const plan = f.db.driver
    .prepare(
      'EXPLAIN QUERY PLAN SELECT body_json FROM product_knowledge WHERE product_id=? AND id>? ORDER BY id LIMIT 50',
    )
    .all(f.product.id, '');
  expect(plan.some((row) => String(row['detail']).includes('product_knowledge_page'))).toBe(true);
});

it('backfills search on upgrade and keeps it synchronized with replacements and detached sources', async () => {
  const f = await fixture();
  f.db.driver.exec(productKnowledgeSearch.down);
  const original = f.doc(0, 'feature.md', 'Zebrastack launch');
  unwrap(await f.store.replaceKnowledge(f.product.id, f.sources[0]!, [original]));
  f.db.driver.exec(productKnowledgeSearch.up);
  expect(unwrap(await f.store.knowledge(f.product.id, 'Zebrastack'))[0]!.id).toBe(original.id);
  const updated = { ...original, id: newId<'ProductKnowledge'>(), digest: 'new', text: 'Orbit edit' };
  unwrap(await f.store.replaceKnowledge(f.product.id, f.sources[0]!, [updated]));
  expect(unwrap(await f.store.knowledge(f.product.id, 'Zebrastack'))).toEqual([]);
  expect(unwrap(await f.store.knowledge(f.product.id, 'Orbit'))[0]!.id).toBe(updated.id);
  unwrap(await f.store.save({ ...f.product, sources: [], revision: 2 }, 1));
  expect(f.db.driver.prepare('SELECT COUNT(*) AS n FROM product_knowledge_fts').get()?.['n']).toBe(0);
});
