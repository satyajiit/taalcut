// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Two writers of one run file. The app no longer makes them (main starts a lan process only after the last one
 * has exited, and a closed device service saves nothing: service-close.test.ts), but the writes stay safe if two
 * ever met: a late save from another service lands whole and neither save fails. With one shared `<file>.tmp`
 * the late save's rename took the other's half-written temp, the other's rename failed with ENOENT, and a
 * carried-on run ended `failed` on a busy Mac (2026-10-27). The rename gate makes that interleaving happen every
 * time instead of by chance.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetId } from '@taalcut/core';
import type { TransferMedia } from '../../src/deps';
import { TRANSFER_LIMITS } from '../../src/limits';
import { writeAtomic } from '../../src/usb/fs-atomic';
import { createFakePhone } from './fake-phone';
import {
  connectPhone,
  createCopySink,
  createHarness,
  createManualSchedule,
  firstView,
  importFolders,
  jpegs,
  untilTerminal,
} from './import-harness';
import { cleanScratch } from './scratch';
import { renameGate, type FsPromises } from './rename-gate';

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

afterEach(async () => {
  renameGate.disarm();
  await cleanScratch();
});

describe('writeAtomic with two writers of one file', () => {
  it('lands both whole, the later rename last, and leaves no temp file', async () => {
    const dir = join((await importFolders()).root, 'files');
    await mkdir(dir);
    const target = join(dir, 'run.json');
    const held = renameGate.arm(target, 1);
    const first = writeAtomic(target, 'first');
    await held;
    // Its open lets the first rename land; its own rename comes after.
    await writeAtomic(target, 'second');
    await first;
    expect(renameGate.landed()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('second');
    expect(await readdir(dir)).toEqual(['run.json']);
  });

  it('takes its temp file with it when the rename fails', async () => {
    const dir = join((await importFolders()).root, 'files');
    await mkdir(dir);
    // A folder with a file in it can't be replaced by a file.
    const target = join(dir, 'run.json');
    await mkdir(target);
    await writeFile(join(target, 'keep'), 'x');
    await expect(writeAtomic(target, 'body')).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['run.json']);
  });
});

describe('temps a dead writer left', () => {
  it('are removed when runs load; a live writer’s stay, and the run still loads', async () => {
    const { staging, originals, state } = await importFolders();
    const phone = createFakePhone(jpegs(1));
    const runs = join(state, 'usb', 'runs');
    const service = createHarness(state, createCopySink(staging, originals, new Set()).sink, media, phone);
    const life = new AbortController();
    try {
      const key = await connectPhone(service, phone, life.signal);
      expect((await service.openDevice(key, life.signal)).ok).toBe(true);
      const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
      if (!started.ok) throw new Error(started.error.code);
      const runId = started.value.runId;
      expect((await untilTerminal(service, runId, life.signal)).state).toBe('succeeded');
      // Above every OS's pid ceiling (macOS 99,998; Linux 4,194,304), so no process has it.
      const dead = `${runId}.json.4194305.0123456789ab.tmp`;
      const live = `${runId}.json.${process.pid}.ba9876543210.tmp`;
      await writeFile(join(runs, dead), '{"half');
      await writeFile(join(runs, live), '{"half');

      const later = createHarness(state, createCopySink(staging, originals, new Set()).sink, media, phone);
      expect((await firstView(later, runId, life.signal)).state).toBe('succeeded');
      expect((await readdir(runs)).sort()).toEqual([`${runId}.json`, live].sort());
    } finally {
      life.abort();
    }
  });
});

describe('a run carried on while the stopped service still saves it', () => {
  // The second service's saves: 1 the load's (paused), 2 Carry on's, 3 the pump's first, 4 the finish.
  it.each([
    ['Carry on', 2],
    ['the first save of the carried-on run', 3],
  ])('finishes when the late save lands during %s', async (_when, nth) => {
    const { staging, originals, state } = await importFolders();
    const files = jpegs(4);
    const known = new Set<AssetId>();
    let hung = false;
    const first = createCopySink(staging, originals, known, {
      hangAt: 3,
      onHang: () => {
        hung = true;
      },
    });
    const phone = createFakePhone(files);
    const timers = createManualSchedule();
    const service = createHarness(state, first.sink, media, phone, { schedule: timers.schedule });
    const life = new AbortController();
    try {
      const key = await connectPhone(service, phone, life.signal);
      expect((await service.openDevice(key, life.signal)).ok).toBe(true);
      const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
      if (!started.ok) throw new Error(started.error.code);
      const runId = started.value.runId;
      while (!hung) await new Promise<void>((resolve) => setTimeout(resolve, 5));

      // The stopped service's progress save comes due now and is held at its rename.
      const runFile = join(state, 'usb', 'runs', `${runId}.json`);
      const held = renameGate.arm(runFile, nth);
      expect(timers.fire(TRANSFER_LIMITS.usbRunSaveIntervalMs)).toBe(1);
      await held;

      const phone2 = createFakePhone(files);
      const second = createCopySink(staging, originals, known);
      const service2 = createHarness(state, second.sink, media, phone2, {
        schedule: createManualSchedule().schedule,
      });
      await connectPhone(service2, phone2, life.signal);
      expect((await firstView(service2, runId, life.signal)).pauseReason).toBe('person');
      const resumed = await service2.resumeDeviceImport(runId);
      expect(resumed.ok ? 'resumed' : resumed.error.code).toBe('resumed');
      const done = await untilTerminal(service2, runId, life.signal);
      expect(done.error?.code ?? done.state).toBe('succeeded');
      expect(done.totals.imported).toBe(4);
      expect(renameGate.landed()).toBe(true);
      // The carried-on run's last save is the file's last word, and no temp file is left beside it.
      const saved = JSON.parse(await readFile(runFile, 'utf8')) as { state: string };
      expect(saved.state).toBe('succeeded');
      expect(await readdir(join(state, 'usb', 'runs'))).toEqual([`${runId}.json`]);
    } finally {
      life.abort();
    }
  });
});
