// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ok,
  type AsyncResult,
  type ProductPublishId,
  type ProductPublishRecord,
  type ProductPublishStore,
} from '@taalcut/core';

export interface PublishingRecoveryPorts {
  store: ProductPublishStore;
  dispatch(record: ProductPublishRecord): AsyncResult<unknown>;
  checkpoint(id: ProductPublishId | null): AsyncResult<unknown>;
  now?: () => number;
}

/** Stable ID pages rotate through all outstanding work, even when a worker restarts between pages. */
export function productPublishingRecovery(ports: PublishingRecoveryPorts) {
  const now = ports.now ?? Date.now;
  let running: AsyncResult<void> | null = null;
  async function scan(): AsyncResult<void> {
    const cursor = await ports.store.readReconcileCursor();
    if (!cursor.ok) return cursor;
    const page = await ports.store.list({
      afterId: cursor.value,
      limit: 100,
      statuses: ['approved', 'uploading', 'scheduling', 'unknown', 'scheduled'],
    });
    if (!page.ok) return page;
    const deadline = now() + 30_000;
    let visited = 0;
    for (const record of page.value) {
      if (record.retryAt === null || record.retryAt <= now()) await ports.dispatch(record);
      visited++;
      if (now() >= deadline) break;
    }
    const completedPage = visited === page.value.length;
    const next = completedPage && page.value.length < 100 ? null : page.value[visited - 1]!.id;
    if (next === cursor.value) return ok(undefined);
    const saved = await ports.checkpoint(next);
    return saved.ok ? ok(undefined) : saved;
  }
  return () => {
    if (!running)
      running = scan().finally(() => {
        running = null;
      });
    return running;
  };
}
