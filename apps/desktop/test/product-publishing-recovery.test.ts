// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  newId,
  ok,
  unwrap,
  type ProductPublishId,
  type ProductPublishRecord,
  type ProductPublishStore,
} from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { productPublishingRecovery } from '../src/utility/products/publishing-recovery';

it('fairly reconciles more than 1000 unresolved posts across worker restarts', async () => {
  const records = Array.from(
    { length: 1205 },
    () =>
      ({
        id: newId<'ProductPublish'>(),
        retryAt: null,
        status: 'unknown',
        updatedAt: 42,
      }) as ProductPublishRecord,
  ).sort((a, b) => a.id.localeCompare(b.id));
  let cursor: ProductPublishId | null = null;
  const store = {
    readReconcileCursor: async () => ok(cursor),
    list: vi.fn(async (input: Parameters<ProductPublishStore['list']>[0]) =>
      ok(records.filter((record) => !input?.afterId || record.id > input.afterId).slice(0, input?.limit)),
    ),
  } as unknown as ProductPublishStore;
  const visited: ProductPublishId[] = [];
  for (let restart = 0; restart < 13; restart++) {
    const wake = productPublishingRecovery({
      store,
      dispatch: async (record) => {
        visited.push(record.id);
        return ok(undefined);
      },
      checkpoint: async (id) => {
        cursor = id;
        return ok(undefined);
      },
    });
    unwrap(await wake());
  }
  expect(new Set(visited).size).toBe(1205);
  expect(visited).toHaveLength(1205);
  expect(cursor).toBeNull();
  expect(records.every((record) => record.updatedAt === 42)).toBe(true);
});
