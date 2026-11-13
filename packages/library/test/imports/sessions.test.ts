// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { newId, ok, unwrap, type ImportItemOutcome } from '@taalcut/core';
import { createImportSessionService, type ImportAdapter, type ImportRunContext } from '../../src/index';
import { openTestDb } from '../helpers';

const capabilities = { pause: true, resume: true, cancel: true, retryFailed: true, byteResume: false };
const item = (id: string) => ({
  item: {
    id,
    name: `${id}.mp4`,
    sizeBytes: id === 'cloud' ? null : 10,
    capturedAt: null,
    thumbnailUrl: null,
    duplicate: false,
    captureId: null,
    required: true,
    supported: true,
    warning: null,
  },
  locator: { path: `/private/${id}` },
});
function archived(id: string, complete = true): ImportItemOutcome {
  return {
    itemId: id,
    name: `${id}.mp4`,
    state: 'archived',
    receivedBytes: 10,
    result: { kind: 'archived', captureId: newId<'CaptureGroup'>(), complete },
    error: null,
  };
}
function setup(run: ImportAdapter['run'], ids = ['one', 'two']) {
  const db = openTestDb();
  const prepare = vi.fn(async () =>
    ok({
      sourceLabel: 'Camera card',
      destinationLabel: 'Originals',
      items: ids.map(item),
      privateData: { volumeId: 'stable' },
      selectAll: true,
    }),
  );
  const adapter: ImportAdapter = {
    capabilities,
    prepare,
    preflight: async () => ok({ availableBytes: 1000 }),
    run,
  };
  const create = () => createImportSessionService({ db, adapters: { files: adapter } });
  return { db, create, service: create(), prepare };
}
const terminal = async (
  service: ReturnType<typeof createImportSessionService>,
  sessionId: ReturnType<typeof newId<'ImportSession'>>,
) => {
  await vi.waitFor(() => expect(service.session({ sessionId })?.session.status).not.toBe('running'));
};

describe('durable import sessions', () => {
  it('persists private draft inventory while reads and snapshots start no work', async () => {
    const run = vi.fn(async () => ok(undefined));
    const fx = setup(run, ['one', 'cloud']);
    const { draftId } = unwrap(await fx.service.createDraft({ method: 'files', watch: false }));
    await fx.service.close();
    const restored = fx.create();
    expect(restored.draft(draftId)?.sourceLabel).toBe('Camera card');
    expect(restored.items({ draftId, limit: 1 }).nextCursor).toBe('1');
    expect(restored.items({ draftId, query: 'cloud' }).total).toBe(1);
    expect(unwrap(await restored.preflight(draftId))).toMatchObject({
      knownBytes: 10,
      unknownSizeItems: 1,
      selectedItems: 2,
    });
    const abort = new AbortController();
    const updates = restored.watch({}, abort.signal)[Symbol.asyncIterator]();
    expect((await updates.next()).value).toEqual({ sessions: [] });
    abort.abort();
    await updates.return?.();
    expect(run).not.toHaveBeenCalled();
    expect(fx.prepare).toHaveBeenCalledTimes(1);
    await restored.close();
  });
  it('starts once across concurrent calls and does not falsely mark an incomplete archive editable', async () => {
    const run = vi.fn(async (ctx: ImportRunContext) => {
      for (const entry of ctx.items) ctx.report(archived(entry.item.id, false));
      return ok(undefined);
    });
    const fx = setup(run);
    const { draftId } = unwrap(await fx.service.createDraft({ method: 'files', watch: false }));
    const started = await Promise.all([fx.service.start(draftId), fx.service.start(draftId)]);
    const sessionId = unwrap(started[0]!).sessionId;
    expect(unwrap(started[1]!).sessionId).toBe(sessionId);
    await terminal(fx.service, sessionId);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fx.service.session({ sessionId })?.session).toMatchObject({
      status: 'completed',
      stage: 'checking',
      safeToDisconnect: false,
      progress: { archivedItems: 2, completedItems: 0 },
    });
    await fx.service.close();
  });
  it('retries only failed items and keeps successful receipts after cancellation/restart', async () => {
    let attempt = 0;
    const seen: string[][] = [];
    const fx = setup(async (ctx) => {
      attempt++;
      seen.push(ctx.items.map((entry) => entry.item.id));
      for (const entry of ctx.items)
        ctx.report(
          attempt === 1 && entry.item.id === 'two'
            ? {
                ...archived('two'),
                state: 'failed',
                result: null,
                error: { code: 'core.unknown', messageKey: 'errors.core.unknown', retryable: true },
              }
            : archived(entry.item.id),
        );
      return ok(undefined);
    });
    const { draftId } = unwrap(await fx.service.createDraft({ method: 'files', watch: false }));
    const { sessionId } = unwrap(await fx.service.start(draftId));
    await terminal(fx.service, sessionId);
    expect(fx.service.session({ sessionId })?.session.status).toBe('partial');
    await fx.service.close();
    const restored = fx.create();
    unwrap(await restored.retryFailed(sessionId));
    await terminal(restored, sessionId);
    expect(seen).toEqual([['one', 'two'], ['two']]);
    expect(restored.session({ sessionId })?.session.progress.archivedItems).toBe(2);
    await restored.close();
  });
  it('quiesces reads on shutdown and offers an interrupted session without auto restart', async () => {
    const run = vi.fn(async (ctx: ImportRunContext) => {
      ctx.report(archived('one'));
      await new Promise<void>((resolve) => {
        ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        if (ctx.signal.aborted) resolve();
      });
      return ok(undefined);
    });
    const fx = setup(run);
    const { draftId } = unwrap(await fx.service.createDraft({ method: 'files', watch: false }));
    const { sessionId } = unwrap(await fx.service.start(draftId));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await fx.service.close();
    const restored = fx.create();
    expect(restored.session({ sessionId })?.session.status).toBe('interrupted');
    expect(run).toHaveBeenCalledTimes(1);
    expect(restored.session({ sessionId })?.items[0]?.state).toBe('archived');
    await restored.close();
  });
});

it('keeps native locators and source metadata private across reload', async () => {
  let recorded: unknown;
  const fx = setup(async (ctx) => {
    recorded = ctx.privateData;
    for (const entry of ctx.items) ctx.report(archived(entry.item.id));
    return ok(undefined);
  });
  const { draftId } = unwrap(await fx.service.createDraft({ method: 'files', watch: false }));
  await fx.service.close();
  const restored = fx.create();
  expect(JSON.stringify(restored.draft(draftId))).not.toContain('/private/');
  const { sessionId } = unwrap(await restored.start(draftId));
  await terminal(restored, sessionId);
  expect(recorded).toEqual({ volumeId: 'stable' });
  await restored.close();
});

it('uses the same folder scope for review, start and unfinished receipts', async () => {
  const db = openTestDb();
  const run = vi.fn(async (ctx: ImportRunContext) => {
    for (const entry of ctx.items) ctx.report(archived(entry.item.id));
    return ok(undefined);
  });
  const service = createImportSessionService({
    db,
    adapters: {
      folder: {
        capabilities,
        includes: (draft, entry) => draft.recursive || entry.item.id !== 'nested',
        prepare: async () =>
          ok({
            sourceLabel: 'Folder',
            destinationLabel: 'Originals',
            items: [item('root'), item('nested')],
            selectAll: true,
          }),
        run,
      },
    },
  });
  const { draftId } = unwrap(await service.createDraft({ method: 'folder', watch: false }));
  unwrap(await service.updateDraft({ draftId, recursive: false }));
  expect(unwrap(await service.preflight(draftId)).selectedItems).toBe(1);
  const { sessionId } = unwrap(await service.start(draftId));
  await terminal(service, sessionId);
  expect(service.session({ sessionId })?.items.map((outcome) => outcome.itemId)).toEqual(['root']);
  expect(service.session({ sessionId })?.session.status).toBe('completed');
  await service.close();
});

it('allows an empty watched folder to save its source without a synthetic item', async () => {
  const db = openTestDb();
  const run = vi.fn(async () => ok(undefined));
  const service = createImportSessionService({
    db,
    adapters: {
      folder: {
        capabilities,
        prepare: async () =>
          ok({ sourceLabel: 'Empty folder', destinationLabel: 'In place', items: [], selectAll: true }),
        preflight: async () => ok({ canStart: true }),
        run,
      },
    },
  });
  const { draftId } = unwrap(await service.createDraft({ method: 'folder', watch: true }));
  const { sessionId } = unwrap(await service.start(draftId));
  await terminal(service, sessionId);
  expect(run).toHaveBeenCalledTimes(1);
  expect(service.session({ sessionId })?.items).toEqual([]);
  await service.close();
});
