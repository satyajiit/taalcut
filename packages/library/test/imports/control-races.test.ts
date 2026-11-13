// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it, vi } from 'vitest';
import { ok, unwrap } from '@taalcut/core';
import { createImportSessionService, type ImportAdapter, type ImportRunContext } from '../../src/index';
import { openTestDb } from '../helpers';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const stopping = gate();
  let blockStop = true;
  let check: ReturnType<typeof gate> | undefined;
  const run = vi.fn(async (ctx: ImportRunContext) => {
    await new Promise<void>((resolve) =>
      ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    if (blockStop) await stopping.promise;
    return ok(undefined);
  });
  const adapter: ImportAdapter = {
    capabilities: { pause: true, resume: true, cancel: true, retryFailed: true, byteResume: false },
    prepare: async () =>
      ok({
        sourceLabel: 'Folder',
        destinationLabel: 'Originals',
        selectAll: true,
        items: [
          {
            item: {
              id: 'one',
              name: 'one.mp4',
              sizeBytes: 1,
              capturedAt: null,
              thumbnailUrl: null,
              duplicate: false,
              captureId: null,
              required: true,
              supported: true,
              warning: null,
            },
            locator: {},
          },
        ],
      }),
    preflight: async () => {
      await check?.promise;
      return ok({ canStart: true });
    },
    run,
  };
  const service = createImportSessionService({ db: openTestDb(), adapters: { files: adapter } });
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  const { sessionId } = unwrap(await service.start(draftId));
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  return {
    service,
    sessionId,
    run,
    stopping,
    releaseStop: () => {
      blockStop = false;
      stopping.resolve();
    },
    delayCheck: () => {
      check = gate();
      return check;
    },
  };
}
it('serializes pause followed immediately by resume until the first reader settles', async () => {
  const f = await fixture();
  const paused = f.service.pause(f.sessionId);
  const resumed = f.service.resume(f.sessionId);
  await vi.waitFor(() =>
    expect(f.service.session({ sessionId: f.sessionId })?.session.status).toBe('paused'),
  );
  expect(f.run).toHaveBeenCalledTimes(1);
  f.releaseStop();
  unwrap(await paused);
  unwrap(await resumed);
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(2));
  expect(f.service.session({ sessionId: f.sessionId })?.session.status).toBe('running');
  await f.service.close();
});
it('keeps cancel after an asynchronous resume check terminal', async () => {
  const f = await fixture();
  f.releaseStop();
  unwrap(await f.service.pause(f.sessionId));
  const check = f.delayCheck();
  const resumed = f.service.resume(f.sessionId);
  const cancelled = f.service.cancel(f.sessionId);
  check.resolve();
  unwrap(await resumed);
  unwrap(await cancelled);
  expect(f.service.session({ sessionId: f.sessionId })?.session.status).toBe('cancelled');
  await f.service.close();
});
it('closes through a pending resume check without launching a late reader', async () => {
  const f = await fixture();
  f.releaseStop();
  unwrap(await f.service.pause(f.sessionId));
  const check = f.delayCheck();
  const resumed = f.service.resume(f.sessionId);
  await Promise.resolve();
  const closing = f.service.close();
  check.resolve();
  expect((await resumed).ok).toBe(false);
  await closing;
  expect(f.run).toHaveBeenCalledTimes(1);
});
