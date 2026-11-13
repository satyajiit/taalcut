// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok, unwrap, type ProductId, type ProductKnowledge } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { productPromptKnowledge } from '../../src/products/research';
import { productFixture } from './fixture';

it('keeps persisted source coverage ahead of long evidence excerpts without mutating input', () => {
  const document: ProductKnowledge = {
    id: newId<'ProductKnowledge'>(),
    productId: newId<'Product'>(),
    sourceId: newId<'CreationSource'>(),
    locator: 'README.md',
    title: 'Documentation',
    digest: 'hash',
    text: 'e'.repeat(24_000),
    capturedAt: 1,
  };
  const docs = Array.from({ length: 40 }, () => ({ ...document, id: newId<'ProductKnowledge'>() }));
  const notice = {
    ...document,
    id: newId<'ProductKnowledge'>(),
    locator: 'taalcut:index-coverage',
    text: 'Some source files could not be indexed. Do not infer absent features.',
  };
  const selected = productPromptKnowledge([...docs, notice]);
  expect(selected[0]).toEqual(notice);
  expect(selected.reduce((total, item) => total + item.text.length, 0)).toBeLessThanOrEqual(60_000);
  expect(docs[0]!.text.length).toBe(24_000);
});

it('uses product preferences for indexed recall and falls back to diverse evidence when none match', async () => {
  const f = productFixture();
  f.product.preferences.topics = ['Zebrastack routing'];
  const original = f.deps.store.knowledge;
  const knowledge = vi.fn(async (id: ProductId, query?: string) => (query ? ok([]) : original(id)));
  f.deps.store.knowledge = knowledge;
  unwrap(await f.service.research(f.product.id));
  expect(knowledge).toHaveBeenNthCalledWith(1, f.product.id, 'Zebrastack routing');
  expect(knowledge).toHaveBeenNthCalledWith(2, f.product.id);
});
