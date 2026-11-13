// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The run engine's edges: an unknown run, the Carry on offer after a new
 * process, a cancel that lands while an import fails, and a device hash
 * that can't be computed.
 */
import { readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { err, newId, type AssetId, type DeviceRun, type ImportSink } from '@taalcut/core';
import type { TransferMedia } from '../../src/deps';
import { ImportFailed } from '../../src/errors';
import type { DeviceService } from '../../src/usb/bridge';
import { createFakePhone } from './fake-phone';
import {
  connectPhone,
  createCopySink,
  createHarness,
  firstView,
  importFolders as folders,
  jpegs,
  untilTerminal,
} from './import-harness';
import { cleanScratch } from './scratch';

const selection = { filter: { onlyNew: true, timeZone: 'UTC' }, include: [], exclude: [] };
const media: TransferMedia = {
  async probe() {
    return { ok: false as const };
  },
};

afterEach(cleanScratch);

describe('USB run engine', () => {
  it('answers an unknown run with core.not_found', async () => {
    const dir = await folders();
    const phone = createFakePhone([]);
    const service = createHarness(
      dir.state,
      createCopySink(dir.staging, dir.originals, new Set()).sink,
      media,
      phone,
    );
    const runId = newId<'DeviceImportRun'>();
    for (const result of [
      await service.pauseDeviceImport(runId),
      await service.resumeDeviceImport(runId),
      await service.cancelDeviceImport(runId),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('core.not_found');
    }
  });

  it('offers to carry on a run the last process left running, and finishes it when asked', async () => {
    const dir = await folders();
    const files = jpegs(4);
    const known = new Set<AssetId>();
    let hung = false;
    const first = createCopySink(dir.staging, dir.originals, known, {
      hangAt: 3,
      onHang: () => {
        hung = true;
      },
    });
    const phone = createFakePhone(files);
    const service = createHarness(dir.state, first.sink, media, phone);
    const life = new AbortController();
    try {
      const key = await connectPhone(service, phone, life.signal);
      expect((await service.openDevice(key, life.signal)).ok).toBe(true);
      const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
      if (!started.ok) throw new Error(started.error.code);
      const runId = started.value.runId;
      while (!hung) await new Promise<void>((resolve) => setTimeout(resolve, 5));

      // The "killed" process stays hung; a new one reads the same state folder.
      const phone2 = createFakePhone(files);
      const second = createCopySink(dir.staging, dir.originals, known);
      const service2 = createHarness(dir.state, second.sink, media, phone2);
      await connectPhone(service2, phone2, life.signal);
      const offered = await firstView(service2, runId, life.signal);
      expect(offered.state).toBe('paused');
      expect(offered.pauseReason).toBe('person');
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(phone2.pulls()).toEqual([]);

      const resumed = await service2.resumeDeviceImport(runId);
      expect(resumed.ok).toBe(true);
      const done = await untilTerminal(service2, runId, life.signal);
      expect(done.state).toBe('succeeded');
      expect(done.totals.imported).toBe(4);
      // item-0 and item-1 were in before the hang (restored from the ledger), item-2 is imported
      // from its journal, and only item-3 is pulled.
      expect(phone2.pulls()).toEqual(['item-3']);
      expect(second.imports()).toBe(2);
    } finally {
      life.abort();
    }
  });

  it('removes the file and its journal when a cancel lands while the import fails', async () => {
    const dir = await folders();
    const phone = createFakePhone(jpegs(2));
    let runId: DeviceRun['id'] | null = null;
    let service: DeviceService | null = null;
    let cancellation: Promise<unknown> | undefined;
    const sink: ImportSink = {
      ...createCopySink(dir.staging, dir.originals, new Set()).sink,
      async importStaged() {
        // Cancellation waits for this pipeline to settle; do not await it from inside the pipeline itself.
        if (service && runId) cancellation = service.cancelDeviceImport(runId);
        return err(ImportFailed());
      },
    };
    service = createHarness(dir.state, sink, media, phone);
    const life = new AbortController();
    try {
      const key = await connectPhone(service, phone, life.signal);
      expect((await service.openDevice(key, life.signal)).ok).toBe(true);
      const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
      if (!started.ok) throw new Error(started.error.code);
      runId = started.value.runId;
      const done = await untilTerminal(service, runId, life.signal);
      expect(done.state).toBe('cancelled');
      expect(done.totals.imported).toBe(0);
      await cancellation;
      expect(await readdir(dir.staging)).toEqual([]);
    } finally {
      life.abort();
    }
  });

  it('retries a device hash that failed once, then fails the item as a hash mismatch', async () => {
    const dir = await folders();
    const phone = createFakePhone(jpegs(2), { sourceHashFails: (itemId) => itemId === 'item-0' });
    const copy = createCopySink(dir.staging, dir.originals, new Set());
    const service = createHarness(dir.state, copy.sink, media, phone);
    const life = new AbortController();
    try {
      const key = await connectPhone(service, phone, life.signal);
      expect((await service.openDevice(key, life.signal)).ok).toBe(true);
      const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
      if (!started.ok) throw new Error(started.error.code);
      const done = await untilTerminal(service, started.value.runId, life.signal);
      expect(done.state).toBe('succeeded');
      expect(done.totals.failed).toBe(1);
      expect(done.totals.imported).toBe(1);
      expect(phone.pulls().filter((id) => id === 'item-0')).toHaveLength(2);
      expect((await readdir(dir.staging)).filter((name) => name.endsWith('.part'))).toEqual([]);
    } finally {
      life.abort();
    }
  });
});
