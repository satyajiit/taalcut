// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A device service that is closed (the lan process got SIGTERM) leaves its run file as it last saved it: the
 * progress save still due is dropped, a save in flight lands before `close` resolves, and nothing is written
 * after, not even when the import it was waiting on comes back. So the next lan process, which main starts only
 * once this one has exited, is the run file's only writer.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceRun, ImportSink } from '@taalcut/core';
import type { TransferMedia } from '../../src/deps';
import { TRANSFER_LIMITS } from '../../src/limits';
import type { DeviceService } from '../../src/usb/bridge';
import { createFakePhone, type FakePhone } from './fake-phone';
import {
  connectPhone,
  createCopySink,
  createHarness,
  createManualSchedule,
  importFolders,
  jpegs,
} from './import-harness';
import { renameGate, type FsPromises } from './rename-gate';
import { cleanScratch } from './scratch';

vi.mock('node:fs/promises', async (importOriginal) => {
  const { gated } = await import('./rename-gate');
  return gated(await importOriginal<FsPromises>());
});

const selection = { filter: { onlyNew: true, timeZone: 'UTC' }, include: [], exclude: [] };
const media: TransferMedia = {
  async probe() {
    return { ok: false as const };
  },
};
const SAVE_DUE = TRANSFER_LIMITS.usbRunSaveIntervalMs;

afterEach(async () => {
  renameGate.disarm();
  await cleanScratch();
});

interface Hung {
  readonly service: DeviceService;
  readonly phone: FakePhone;
  readonly timers: ReturnType<typeof createManualSchedule>;
  readonly runId: DeviceRun['id'];
  readonly key: string;
  readonly runFile: string;
  readonly runs: string;
  /** Lets the third import, which hangs, return. Resolves once it has. */
  release(): Promise<void>;
}

/** A run of 4 whose third import hangs, with its progress save due on a timer only the test fires. */
async function hungRun(signal: AbortSignal): Promise<Hung> {
  const { staging, originals, state } = await importFolders();
  const copy = createCopySink(staging, originals, new Set());
  let hang = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    hang = resolve;
  });
  let hung = false;
  let returned: Promise<unknown> = Promise.resolve();
  let calls = 0;
  const sink: ImportSink = {
    ...copy.sink,
    importStaged(file, options) {
      calls += 1;
      if (calls !== 3) return copy.sink.importStaged(file, options);
      hung = true;
      const result = held.then(() => copy.sink.importStaged(file, options));
      returned = result;
      return result;
    },
  };
  const phone = createFakePhone(jpegs(4));
  const timers = createManualSchedule();
  const service = createHarness(state, sink, media, phone, { schedule: timers.schedule });
  const key = await connectPhone(service, phone, signal);
  expect((await service.openDevice(key, signal)).ok).toBe(true);
  const started = await service.importFromDevice({ deviceKey: key, selection }, signal);
  if (!started.ok) throw new Error(started.error.code);
  while (!hung) await new Promise<void>((resolve) => setTimeout(resolve, 5));
  const runs = join(state, 'usb', 'runs');
  return {
    service,
    phone,
    timers,
    runId: started.value.runId,
    key,
    runFile: join(runs, `${started.value.runId}.json`),
    runs,
    async release() {
      hang();
      await returned;
      // The pump's next turns, where it would have saved and pulled item 4.
      for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

describe('closing a device service', () => {
  it('drops the progress save still due and writes nothing after, even when the hung import returns', async () => {
    const life = new AbortController();
    try {
      const run = await hungRun(life.signal);
      const before = await readFile(run.runFile, 'utf8');
      await run.service.close();
      expect(run.timers.fire(SAVE_DUE)).toBe(0);

      await run.release();
      // Carry on and a new run wait for the next process (core.process_restarted is retryable).
      const resumed = await run.service.resumeDeviceImport(run.runId);
      expect(resumed.ok ? 'resumed' : resumed.error.code).toBe('core.process_restarted');
      const again = await run.service.importFromDevice({ deviceKey: run.key, selection }, life.signal);
      expect(again.ok ? 'started' : again.error.code).toBe('core.process_restarted');
      expect(await readFile(run.runFile, 'utf8')).toBe(before);
      expect(await readdir(run.runs)).toEqual([`${run.runId}.json`]);
      expect(run.phone.pulls()).toHaveLength(3);
    } finally {
      life.abort();
    }
  });

  it('resolves only once the save in flight has landed', async () => {
    const life = new AbortController();
    try {
      const run = await hungRun(life.signal);
      // The due progress save starts now and is held at its rename.
      const held = renameGate.arm(run.runFile, Number.POSITIVE_INFINITY);
      expect(run.timers.fire(SAVE_DUE)).toBe(1);
      await held;

      let closed = false;
      const closing = run.service.close().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(closed).toBe(false);

      renameGate.disarm();
      await closing;
      const landed = await readFile(run.runFile, 'utf8');
      const saved = JSON.parse(landed) as { state: string; items: { state: string }[] };
      expect(saved.state).toBe('running');
      expect(saved.items.map((item) => item.state)).toEqual(['imported', 'imported', 'importing', 'queued']);

      await run.release();
      expect(await readFile(run.runFile, 'utf8')).toBe(landed);
      expect(await readdir(run.runs)).toEqual([`${run.runId}.json`]);
    } finally {
      life.abort();
    }
  });
});
