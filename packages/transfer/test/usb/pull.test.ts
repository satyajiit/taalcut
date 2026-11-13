// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A cut pull restarts, a ranged pull continues, short reads and hash mismatches retry. */
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type DeviceRun } from '@taalcut/core';
import type { BridgeSession } from '../../src/usb/bridge';
import { pullToPart } from '../../src/usb/pull';
import { createCopySink, createHarness, untilTerminal } from './import-harness';
import { createScriptPhone, importPhone, item, jpeg, media } from './script-phone';

const dirs: string[] = [];
const selection = { filter: { onlyNew: true, timeZone: 'UTC' }, include: [], exclude: [] };
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('USB pull', () => {
  it('restarts a non-ranged pull cut at 37% and continues a ranged one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pull-part-'));
    dirs.push(root);
    const seen: { offset: number; missing: boolean; sha: string }[] = [];
    const session = (ranged: boolean): BridgeSession => ({
      ref: { bridge: 'mtp', handle: 'h', identity: 'PIXEL', label: 'Pixel', platform: 'android' },
      rangedReads: ranged,
      access: () => ({ state: 'ready' }),
      onAccessChange: () => () => undefined,
      async *list() {
        yield [];
      },
      async thumbnail() {
        return ok(null);
      },
      async pull(_itemId, pull) {
        let missing = false;
        try {
          await stat(pull.dest);
        } catch {
          missing = true;
        }
        await writeFile(pull.dest, Buffer.from('rest'));
        seen.push({ offset: pull.offset, missing, sha: 'AB' });
        return ok({ bytes: 4, sha256: 'AB', ancillary: [] });
      },
      async close() {
        return undefined;
      },
    });
    const cut = join(root, 'cut.part');
    await writeFile(cut, Buffer.alloc(37));
    const restarted = await pullToPart({
      session: session(false),
      itemId: 'a',
      partPath: cut,
      signal: new AbortController().signal,
    });
    expect(restarted.ok).toBe(true);
    if (restarted.ok) expect(restarted.value.sha256).toBe('ab');
    expect(seen[0]).toEqual({ offset: 0, missing: true, sha: 'AB' });
    const ranged = join(root, 'ranged.part');
    await writeFile(ranged, Buffer.alloc(37));
    await pullToPart({
      session: session(true),
      itemId: 'a',
      partPath: ranged,
      signal: new AbortController().signal,
    });
    expect(seen[1]).toMatchObject({ offset: 37, missing: false });
    const stopped = new AbortController();
    stopped.abort();
    const gone = await pullToPart({
      session: session(true),
      itemId: 'a',
      partPath: ranged,
      signal: stopped.signal,
    });
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.error.code).toBe('transfer.device_gone');
  });

  it('retries a short read twice and a hash mismatch once', async () => {
    const shortRoot = await mkdtemp(join(tmpdir(), 'pull-short-'));
    dirs.push(shortRoot);
    const shortPhone = createScriptPhone({
      files: [{ item: item('short', 100, 1), bytes: Buffer.alloc(37) }],
    });
    const short = await importPhone(shortPhone, shortRoot);
    expect(short.state).toBe('succeeded');
    expect(short.totals.failed).toBe(1);
    expect(short.totals.imported).toBe(0);
    expect(shortPhone.notes).toHaveLength(3);

    const hashRoot = await mkdtemp(join(tmpdir(), 'pull-hash-'));
    dirs.push(hashRoot);
    const hashPhone = createScriptPhone({
      files: [{ item: item('hash', 64, 1), bytes: jpeg(64) }],
      wrongSource: true,
    });
    const mismatched = await importPhone(hashPhone, hashRoot);
    expect(mismatched.totals.failed).toBe(1);
    expect(mismatched.totals.imported).toBe(0);
    expect(hashPhone.notes).toHaveLength(2);
  });

  it('retries a pull the bridge itself reports short, twice', async () => {
    const twiceRoot = await mkdtemp(join(tmpdir(), 'pull-bridge-short-'));
    dirs.push(twiceRoot);
    const twice = createScriptPhone({
      files: [{ item: item('stall', 64, 1), bytes: jpeg(64) }],
      shortPulls: { id: 'stall', times: 2 },
    });
    const recovered = await importPhone(twice, twiceRoot);
    expect(recovered.totals.imported).toBe(1);
    expect(recovered.totals.failed).toBe(0);
    expect(twice.notes).toHaveLength(3);

    const thriceRoot = await mkdtemp(join(tmpdir(), 'pull-bridge-short-3-'));
    dirs.push(thriceRoot);
    const thrice = createScriptPhone({
      files: [{ item: item('stall', 64, 1), bytes: jpeg(64) }],
      shortPulls: { id: 'stall', times: 3 },
    });
    const failed = await importPhone(thrice, thriceRoot);
    expect(failed.totals.failed).toBe(1);
    expect(failed.totals.imported).toBe(0);
    expect(thrice.notes).toHaveLength(3);
    expect(await readdir(join(thriceRoot, 'staging'))).toEqual([]);
  });

  it('resumes the cut item and then the next one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pull-resume-'));
    dirs.push(root);
    const phone = createScriptPhone({
      files: [
        { item: item('a', 80, 1), bytes: jpeg(80) },
        { item: item('b', 100, 2), bytes: jpeg(100) },
        { item: item('c', 80, 3), bytes: jpeg(80) },
      ],
      cutId: 'b',
    });
    const staging = join(root, 'staging');
    const originals = join(root, 'originals');
    const state = join(root, 'state');
    await mkdir(staging);
    await mkdir(originals);
    await mkdir(state);
    const copy = createCopySink(staging, originals, new Set());
    const service = createHarness(state, copy.sink, media, phone);
    const stop = new AbortController();
    try {
      const iter = service.devices(stop.signal)[Symbol.asyncIterator]();
      await iter.next();
      phone.plug();
      let key = '';
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const step = await iter.next();
        if (step.done || !step.value) break;
        const found = step.value.devices.find((device) => device.connected);
        if (found) {
          key = found.key;
          break;
        }
      }
      if (key.length === 0) throw new Error('phone did not connect');
      const opened = await service.openDevice(key, stop.signal);
      if (!opened.ok) throw new Error(opened.error.code);
      const started = await service.importFromDevice({ deviceKey: key, selection }, stop.signal);
      if (!started.ok) throw new Error(started.error.code);
      const paused = await untilState(service, started.value.runId, stop.signal, 'paused');
      expect(paused.pauseReason).toBe('device-gone');
      phone.unplug();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const parts = (await readdir(staging)).filter((name) => name.endsWith('.part'));
      expect(parts).toHaveLength(1);
      const part = parts[0];
      if (!part) throw new Error('missing part');
      expect((await stat(join(staging, part))).size).toBe(37);
      phone.plug();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const again = await service.openDevice(key, stop.signal);
      if (!again.ok) throw new Error(again.error.code);
      const resumed = await service.resumeDeviceImport(started.value.runId);
      if (!resumed.ok) throw new Error(resumed.error.code);
      const done = await untilTerminal(service, started.value.runId, stop.signal);
      expect(done.state).toBe('succeeded');
      expect(done.totals.imported).toBe(3);
      expect(done.totals.failed).toBe(0);
      expect(phone.notes.filter((note) => note.itemId === 'a')).toHaveLength(1);
      const cut = phone.notes.filter((note) => note.itemId === 'b');
      expect(cut.map((note) => note.offset)).toEqual([0, 0]);
      expect(phone.notes.filter((note) => note.itemId === 'c')).toHaveLength(1);
    } finally {
      stop.abort();
    }
  }, 20_000);
});

async function untilState(
  service: ReturnType<typeof createHarness>,
  runId: DeviceRun['id'],
  signal: AbortSignal,
  state: DeviceRun['state'],
): Promise<DeviceRun> {
  for await (const view of service.deviceRun(runId, signal)) {
    if (view.state === state || view.state === 'failed' || view.state === 'cancelled') return view;
  }
  throw new Error('run ended');
}
