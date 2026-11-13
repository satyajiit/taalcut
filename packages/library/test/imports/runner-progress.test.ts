// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, expect, it, vi } from 'vitest';
import {
  err,
  newId,
  ok,
  ValidationError,
  type ImportDraft,
  type ImportItemOutcome,
  type ImportSession,
  type Result,
} from '@taalcut/core';
import type { ImportAdapter, ImportRunContext, PreparedImportItem } from '../../src/index';
import { createImportRunner } from '../../src/imports/runner';
import type { ImportStore } from '../../src/imports/store';

afterEach(() => vi.useRealTimers());
async function fixture(size = 5000) {
  vi.useFakeTimers();
  let time = 0;
  const draft: ImportDraft = {
    id: newId<'ImportDraft'>(),
    method: 'files',
    sourceLabel: 'Shoot',
    sourceId: null,
    destinationLabel: 'Originals',
    storage: 'copy',
    selectedIds: [],
    selectAll: true,
    excludedIds: [],
    onlyNew: false,
    allowNetwork: false,
    watch: false,
    recursive: true,
    createdAt: 0,
    updatedAt: 0,
    sessionId: null,
  };
  let session: ImportSession = {
    id: newId<'ImportSession'>(),
    draftId: draft.id,
    method: 'files',
    sourceLabel: 'Shoot',
    sourceId: null,
    status: 'running',
    stage: 'receiving',
    createdAt: 0,
    updatedAt: 0,
    finishedAt: null,
    safeToDisconnect: false,
    capabilities: { pause: true, resume: true, cancel: true, retryFailed: true, byteResume: false },
    progress: {
      totalItems: size,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      archivedItems: 0,
      receivedBytes: 0,
      totalBytes: size * 10000,
      bytesPerSecond: null,
      etaSeconds: null,
      currentFile: null,
    },
  };
  const items: PreparedImportItem[] = Array.from({ length: size }, (_, index) => ({
    item: {
      id: String(index),
      name: `${index}.mp4`,
      sizeBytes: 10000,
      capturedAt: null,
      thumbnailUrl: null,
      duplicate: false,
      captureId: null,
      required: true,
      supported: true,
      warning: null,
    },
    locator: {},
  }));
  const persisted = new Map(
    items.map(({ item }) => [
      item.id,
      {
        itemId: item.id,
        name: item.name,
        state: 'pending' as const,
        receivedBytes: 0,
        result: null,
        error: null,
      } as ImportItemOutcome,
    ]),
  );
  let settled!: () => void;
  const terminal = new Promise<void>((resolve) => {
    settled = resolve;
  });
  const store = {
    outcomes: vi.fn(() => [...persisted.values()]),
    session: vi.fn(() => session),
    saveSession: vi.fn((value: ImportSession) => {
      session = value;
      if (value.status !== 'running') settled();
    }),
    putOutcome: vi.fn((_id, outcome: ImportItemOutcome) => {
      persisted.set(outcome.itemId, outcome);
    }),
    transaction: <T>(execute: () => T) => execute(),
    checkpoint: vi.fn(),
  };
  let context!: ImportRunContext;
  let finish!: (result: Result<void>) => void;
  const done = new Promise<Result<void>>((resolve) => {
    finish = resolve;
  });
  const adapter: ImportAdapter = {
    capabilities: session.capabilities,
    prepare: async () => ok({ sourceLabel: '', destinationLabel: '', items }),
    run: async (ctx) => {
      context = ctx;
      return done;
    },
  };
  const changed = vi.fn();
  const runner = createImportRunner(store as unknown as ImportStore, changed, () => time);
  runner.launch(session, draft, items, null, adapter);
  await Promise.resolve();
  return {
    context,
    runner,
    store,
    persisted,
    changed,
    session: () => session,
    at: (next: number) => {
      time = next;
    },
    finish: async (result: Result<void> = ok(undefined)) => {
      finish(result);
      await terminal;
      await Promise.resolve();
    },
  };
}
const receiving = (bytes: number): ImportItemOutcome => ({
  itemId: '0',
  name: '0.mp4',
  state: 'receiving',
  receivedBytes: bytes,
  result: null,
  error: null,
});
it('reads a large selection once and caps same-state progress persistence at four writes per second', async () => {
  const f = await fixture();
  f.context.report(receiving(0));
  f.context.progress({ currentFile: '0.mp4' });
  f.store.putOutcome.mockClear();
  f.store.saveSession.mockClear();
  f.store.session.mockClear();
  for (let tick = 1; tick <= 1000; tick++) {
    f.at(tick);
    f.context.report(receiving(tick));
    f.context.progress({ currentFile: '0.mp4', receivedBytes: tick });
  }
  expect(f.store.outcomes).toHaveBeenCalledTimes(1);
  expect(f.store.putOutcome).toHaveBeenCalledTimes(4);
  expect(f.store.saveSession).toHaveBeenCalledTimes(4);
  expect(f.store.session).toHaveBeenCalledTimes(4);
  expect(f.session().progress).toMatchObject({ receivedBytes: 1000, bytesPerSecond: 1000 });
  f.context.report({
    ...receiving(1000),
    state: 'imported',
    result: { kind: 'asset', assetId: newId<'Asset'>(), sourceId: newId<'Source'>() },
  });
  expect(f.persisted.get('0')?.state).toBe('imported');
  expect(f.session().progress.completedItems).toBe(1);
  expect(f.changed).toHaveBeenLastCalledWith(true);
  await f.finish();
  expect(f.persisted.size).toBe(5000);
  expect(f.store.outcomes).toHaveBeenCalledTimes(1);
  expect(f.session().status).toBe('partial');
});
it('flushes the last throttled receipt before settlement and cancels trailing timers', async () => {
  const f = await fixture(1);
  f.context.report(receiving(0));
  f.at(10);
  f.context.report(receiving(777));
  expect(f.persisted.get('0')?.receivedBytes).toBe(0);
  await f.finish();
  expect(f.persisted.get('0')?.receivedBytes).toBe(777);
  expect(f.session().progress.receivedBytes).toBe(777);
  const writes = f.store.saveSession.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.store.saveSession).toHaveBeenCalledTimes(writes);
});
it('persists terminal failures immediately and saves a bulk adapter failure without rereading receipts', async () => {
  const f = await fixture();
  f.context.report({
    ...receiving(0),
    itemId: '1',
    state: 'failed',
    error: ValidationError({ field: 'copy' }),
  });
  expect(f.persisted.get('1')?.state).toBe('failed');
  expect(f.session().progress.failedItems).toBe(1);
  f.store.saveSession.mockClear();
  await f.finish(err(ValidationError({ field: 'device' })));
  expect(f.session().progress.failedItems).toBe(5000);
  expect(f.store.saveSession).toHaveBeenCalledTimes(2);
  expect(f.store.outcomes).toHaveBeenCalledTimes(1);
  expect(f.persisted.get('1')?.error?.params).toEqual({ field: 'copy' });
  expect([...f.persisted.values()].every((item) => item.state === 'failed')).toBe(true);
});
it('preserves transport throughput and indeterminate totals during coalesced progress', async () => {
  const f = await fixture(1);
  f.at(300);
  f.context.progress({ receivedBytes: 600, totalBytes: null, bytesPerSecond: 91, etaSeconds: null });
  expect(f.session().progress).toMatchObject({
    receivedBytes: 600,
    totalBytes: null,
    bytesPerSecond: 91,
    etaSeconds: null,
  });
  await f.finish();
});
