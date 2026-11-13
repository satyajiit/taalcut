// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { newId, unwrap, type DeviceRun, type ImportItemOutcome, type ImportDraft } from '@taalcut/core';
import type { ImportRunContext } from '@taalcut/library';
import {
  createPhoneImportAdapter,
  phoneImportSources,
  type PhoneTransfer,
} from '../src/main/imports/phone-adapter';

function fixture() {
  const device = {
    key: 'AAAAAAAAAAAAAAAA',
    label: 'Test phone',
    connected: true,
    access: 'ready',
    platform: 'ios',
    bridge: 'image-capture',
  };
  const item = {
    key: 'BBBBBBBBBBBBBBBB',
    name: 'original.mov',
    kind: 'video',
    sizeBytes: 40,
    createdAt: 100,
    durationMs: 20,
    width: 200,
    height: 100,
    album: null,
    flags: [],
    imported: 'no',
    thumb: true,
  };
  const runId = newId<'DeviceImportRun'>();
  const assetId = newId<'Asset'>();
  const sourceId = newId<'Source'>();
  const run: DeviceRun = {
    id: runId,
    deviceKey: device.key,
    deviceLabel: device.label,
    sourceId,
    state: 'succeeded',
    totals: {
      items: 1,
      bytes: 40,
      done: 1,
      bytesDone: 40,
      imported: 1,
      duplicates: 0,
      inICloud: 0,
      rejected: 0,
      failed: 0,
      converted: 0,
    },
    startedAt: 100,
    updatedAt: 200,
  };
  const opened = vi.fn(async () => device);
  const started = vi.fn(async () => ({ runId }));
  const transfer = {
    devices: async () =>
      (async function* () {
        yield { devices: [device], runs: [] };
      })(),
    openDevice: opened,
    deviceItems: async () => ({ items: [item], total: 1 }),
    importFromDevice: started,
    deviceRun: async () =>
      (async function* () {
        yield run;
      })(),
    deviceRunItems: async () => ({
      items: [
        { key: item.key, name: item.name, sizeBytes: 40, state: 'imported', assetId, sourceId, error: null },
      ],
    }),
    pauseDeviceImport: async () => run,
    cancelDeviceImport: async () => run,
    resumeDeviceImport: async () => run,
  } as unknown as PhoneTransfer;
  return { transfer, device, item, opened, started, runId, run, assetId, sourceId };
}
describe('LIB2 phone adapter', () => {
  it('discovers devices without prompting, then requests access only on Connect', async () => {
    const fx = fixture();
    expect(await phoneImportSources(fx.transfer)).toMatchObject([
      { id: fx.device.key, method: 'phone-cable', available: true },
    ]);
    expect(fx.opened).not.toHaveBeenCalled();
    const adapter = createPhoneImportAdapter({ transfer: () => fx.transfer, destinationLabel: 'Originals' });
    const draft = unwrap(
      await adapter.prepare({ method: 'phone-cable', watch: false, deviceId: fx.device.key }),
    );
    expect(draft.items[0]?.item.id).toBe(fx.item.key);
    expect(draft.items[0]?.item.thumbnailUrl).toContain(fx.item.key);
    expect(fx.opened).toHaveBeenCalledTimes(1);
    expect(fx.started).not.toHaveBeenCalled();
  });
  it('uses real persisted item receipts and checkpoints the native run before following', async () => {
    const fx = fixture();
    const adapter = createPhoneImportAdapter({ transfer: () => fx.transfer, destinationLabel: 'Originals' });
    const prepared = unwrap(
      await adapter.prepare({ method: 'phone-cable', watch: false, deviceId: fx.device.key }),
    );
    const receipts: ImportItemOutcome[] = [];
    const checkpoint = vi.fn();
    const context = {
      items: prepared.items,
      privateData: prepared.privateData,
      signal: new AbortController().signal,
      report: (value: ImportItemOutcome) => receipts.push(value),
      checkpoint,
      progress: vi.fn(),
    } as unknown as ImportRunContext;
    unwrap(await adapter.run(context));
    expect(checkpoint).toHaveBeenCalledWith({ deviceKey: fx.device.key, runId: fx.runId });
    expect(receipts).toMatchObject([
      { itemId: fx.item.key, state: 'imported', receivedBytes: 40, result: { kind: 'asset' } },
    ]);
    expect(fx.started).toHaveBeenCalledWith(
      expect.objectContaining({ selection: expect.objectContaining({ include: [fx.item.key] }) }),
    );
  });
  it('preserves device album directory in item names and preflight validation', async () => {
    const fx = fixture();
    const albumItem = { ...fx.item, album: 'Camera' };
    const transfer = {
      ...fx.transfer,
      deviceItems: async () => ({ items: [albumItem], total: 1 }),
    } as unknown as PhoneTransfer;
    const adapter = createPhoneImportAdapter({ transfer: () => transfer, destinationLabel: 'Originals' });
    const prepared = unwrap(
      await adapter.prepare({ method: 'phone-cable', watch: false, deviceId: fx.device.key }),
    );
    expect(prepared.items[0]?.item.name).toBe('Camera/original.mov');
    expect(
      unwrap(await adapter.preflight!({} as ImportDraft, prepared.items, prepared.privateData, { starting: true }))
        .canStart,
    ).toBe(true);
  });
});

it('waits past the initial empty discovery snapshot without opening a device', async () => {
  const fx = fixture();
  const transfer = {
    ...fx.transfer,
    devices: async () =>
      (async function* () {
        yield { devices: [], runs: [] };
        await Promise.resolve();
        yield { devices: [fx.device], runs: [] };
      })(),
  } as unknown as PhoneTransfer;
  expect(await phoneImportSources(transfer)).toHaveLength(1);
  expect(fx.opened).not.toHaveBeenCalled();
  const adapter = createPhoneImportAdapter({ transfer: () => transfer, destinationLabel: 'Originals' });
  expect(unwrap(await adapter.prepare({ method: 'phone-cable', watch: false })).items).toHaveLength(1);
});
it('reconnects a restored catalog only for explicit start, then revalidates the selection', async () => {
  const fx = fixture();
  let catalogReady = false;
  const transfer = {
    ...fx.transfer,
    openDevice: vi.fn(async () => {
      catalogReady = true;
      return fx.device;
    }),
    deviceItems: async () => {
      if (!catalogReady) throw new Error('catalog lost on relaunch');
      return { items: [fx.item], total: 1 };
    },
  } as unknown as PhoneTransfer;
  const adapter = createPhoneImportAdapter({ transfer: () => transfer, destinationLabel: 'Originals' });
  const prepared = unwrap(await adapter.prepare({ method: 'phone-cable', watch: false }));
  catalogReady = false;
  const input = [{} as ImportDraft, prepared.items, prepared.privateData] as const;
  expect(unwrap(await adapter.preflight!(...input, { starting: false })).warnings).toContain(
    'source-reconnect-required',
  );
  expect(transfer.openDevice).toHaveBeenCalledTimes(1);
  expect(unwrap(await adapter.preflight!(...input, { starting: true })).canStart).toBe(true);
  expect(transfer.openDevice).toHaveBeenCalledTimes(2);
});
it('continues later selection batches after resuming a paused first batch', async () => {
  const fx = fixture();
  let resumed = false;
  const nextRunId = newId<'DeviceImportRun'>();
  const keys = Array.from({ length: 10001 }, (_, index) => `ITEM${String(index).padStart(12, '0')}`);
  const started = vi.fn(async () => ({ runId: nextRunId }));
  const transfer = {
    ...fx.transfer,
    importFromDevice: started,
    resumeDeviceImport: async () => {
      resumed = true;
      return fx.run;
    },
    deviceRun: async ({ runId }: { runId: string }) =>
      (async function* () {
        yield {
          ...fx.run,
          id: runId,
          state: runId === fx.runId && !resumed ? 'paused' : 'succeeded',
          totals: {
            ...fx.run.totals,
            items: runId === fx.runId ? 10000 : 1,
            bytesDone: runId === fx.runId ? (resumed ? 400000 : 0) : 40,
          },
        };
      })(),
    deviceRunItems: async ({
      runId,
      cursor = '0',
      limit,
    }: {
      runId: string;
      cursor?: string;
      limit: number;
    }) => {
      const selected = runId === fx.runId ? keys.slice(0, 10000) : keys.slice(10000);
      const at = Number(cursor);
      return {
        items: selected.slice(at, at + limit).map((key) => ({
          key,
          name: `${key}.mov`,
          sizeBytes: 40,
          state: 'imported',
          assetId: fx.assetId,
          sourceId: fx.sourceId,
          error: null,
        })),
        ...(at + limit < selected.length ? { nextCursor: String(at + limit) } : {}),
      };
    },
  } as unknown as PhoneTransfer;
  const adapter = createPhoneImportAdapter({ transfer: () => transfer, destinationLabel: 'Originals' });
  const prepared = unwrap(await adapter.prepare({ method: 'phone-cable', watch: false }));
  const item = prepared.items[0]!;
  const progress = vi.fn();
  const context = {
    items: keys.map((key) => ({ ...item, item: { ...item.item, id: key } })),
    privateData: { deviceKey: fx.device.key, runId: fx.runId },
    session: { progress: { receivedBytes: 0 } },
    signal: new AbortController().signal,
    report: vi.fn(),
    checkpoint: vi.fn(),
    progress,
  } as unknown as ImportRunContext;
  unwrap(await adapter.run(context));
  expect(started).toHaveBeenCalledTimes(1);
  expect(started).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: expect.objectContaining({ include: [keys[10000]] }),
    }),
  );
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ receivedBytes: 400040 }));
});

it('keeps the connected draft observer alive for thumbnails until adapter shutdown', async () => {
  const fx = fixture();
  const signals: AbortSignal[] = [];
  const transfer = {
    ...fx.transfer,
    devices: async (_input: unknown, options: { signal: AbortSignal }) =>
      (async function* () {
        signals.push(options.signal);
        yield { devices: [fx.device], runs: [] };
        if (!options.signal.aborted)
          await new Promise<void>((resolve) =>
            options.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
      })(),
  } as unknown as PhoneTransfer;
  const adapter = createPhoneImportAdapter({ transfer: () => transfer, destinationLabel: 'Originals' });
  unwrap(await adapter.prepare({ method: 'phone-cable', watch: false }));
  expect(signals.length).toBeGreaterThan(0);
  expect(signals.every((signal) => !signal.aborted)).toBe(true);
  await adapter.close?.();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

it('waits past opening snapshots and surfaces transfer.device_locked when the phone is locked', async () => {
  const fx = fixture();
  const lockedDevice = { ...fx.device, access: 'locked' as const };
  const transfer = {
    ...fx.transfer,
    devices: async () =>
      (async function* () {
        yield { devices: [{ ...fx.device, access: 'opening' as const }], runs: [] };
        await Promise.resolve();
        yield { devices: [lockedDevice], runs: [] };
      })(),
    openDevice: vi.fn(async () => lockedDevice),
  } as unknown as PhoneTransfer;
  const adapter = createPhoneImportAdapter({ transfer: () => transfer, destinationLabel: 'Originals' });
  const prepared = await adapter.prepare({ method: 'phone-cable', watch: false, deviceId: fx.device.key });
  expect(prepared.ok).toBe(false);
  if (!prepared.ok) expect(prepared.error.code).toBe('transfer.device_locked');
});

it('reuses one devices stream on prepare and never drops active observers to zero during preflight handoff', async () => {
  const fx = fixture();
  let openStreams = 0;
  let totalOpened = 0;
  let droppedToZeroAfterPrepare = false;
  let preparedDone = false;
  const transfer = {
    ...fx.transfer,
    devices: async (_input: unknown, options: { signal: AbortSignal }) => {
      totalOpened += 1;
      openStreams += 1;
      let closed = false;
      const closeStream = () => {
        if (closed) return;
        closed = true;
        openStreams -= 1;
        if (preparedDone && openStreams === 0) droppedToZeroAfterPrepare = true;
      };
      return {
        [Symbol.asyncIterator]() {
          let first = true;
          return {
            async next() {
              if (first) {
                first = false;
                return { value: { devices: [fx.device], runs: [] }, done: false };
              }
              await new Promise<void>((resolve) =>
                options.signal.addEventListener('abort', () => resolve(), { once: true }),
              );
              closeStream();
              return { value: undefined, done: true };
            },
            async return() {
              closeStream();
              return { value: undefined, done: true };
            },
          };
        },
      };
    },
  } as unknown as PhoneTransfer;

  await phoneImportSources(transfer);
  expect(openStreams).toBe(0);
  expect(totalOpened).toBe(1);

  const adapter = createPhoneImportAdapter({ transfer: () => transfer, destinationLabel: 'Originals' });
  const prepared = unwrap(
    await adapter.prepare({ method: 'phone-cable', watch: false, deviceId: fx.device.key }),
  );
  preparedDone = true;
  expect(totalOpened).toBe(2);
  expect(openStreams).toBe(1);

  expect(
    unwrap(await adapter.preflight!({} as ImportDraft, prepared.items, prepared.privateData, { starting: true }))
      .canStart,
  ).toBe(true);
  expect(droppedToZeroAfterPrepare).toBe(false);
  expect(openStreams).toBe(1);

  preparedDone = false;
  await adapter.close?.();
  expect(openStreams).toBe(0);
});
