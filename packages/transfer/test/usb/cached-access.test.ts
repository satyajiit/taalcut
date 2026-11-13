// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceAccess, DeviceService } from '../../src/usb/bridge';
import { createFakePhone } from './fake-phone';
import {
  connectPhone,
  createCopySink,
  createHarness,
  importFolders,
  jpegs,
  untilTerminal,
} from './import-harness';
import { cleanScratch } from './scratch';

const active: { service: DeviceService; stop: AbortController }[] = [];
afterEach(async () => {
  for (const { service, stop } of active.splice(0)) {
    stop.abort();
    await service.close();
  }
  await cleanScratch();
});

async function cachedPhone() {
  const dirs = await importFolders();
  const copy = createCopySink(dirs.staging, dirs.originals, new Set());
  const phone = createFakePhone(jpegs(1));
  let access: DeviceAccess = { state: 'ready' };
  let listings = 0;
  const listeners = new Set<(next: DeviceAccess) => void>();
  const bridge: typeof phone.bridge = {
    ...phone.bridge,
    async open(ref, signal) {
      const opened = await phone.bridge.open(ref, signal);
      if (!opened.ok) return opened;
      const session = opened.value;
      return ok({
        ...session,
        access: () => access,
        onAccessChange(listener: (next: DeviceAccess) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async *list(signal: AbortSignal) {
          listings++;
          yield* session.list(signal);
        },
      });
    },
  };
  const service = createHarness(
    dirs.state,
    copy.sink,
    { probe: async () => ({ ok: false }) },
    {
      ...phone,
      bridge,
    },
  );
  const stop = new AbortController();
  active.push({ service, stop });
  const key = await connectPhone(service, phone, stop.signal);
  expect((await service.openDevice(key, stop.signal)).ok).toBe(true);
  return {
    service,
    phone,
    key,
    signal: stop.signal,
    listings: () => listings,
    setAccess(next: DeviceAccess) {
      access = next;
      for (const listener of listeners) listener(next);
    },
  };
}

describe('cached phone access', () => {
  it.each([
    [{ state: 'locked' }, 'transfer.device_locked'],
    [{ state: 'busy', holder: 'camera-agent' }, 'transfer.device_busy'],
  ] as const)(
    'refuses cached reads and imports while access is %j, then imports after unlock',
    async (access, code) => {
      const rig = await cachedPhone();
      const filter = { onlyNew: false, timeZone: 'UTC' };
      const query = { deviceKey: rig.key, filter, limit: 50 };
      const selection = { filter, include: [], exclude: [] };
      const listings = rig.listings();
      rig.setAccess(access);

      expect(await rig.service.deviceItems(query, rig.signal)).toMatchObject({ ok: false, error: { code } });
      expect(await rig.service.importFromDevice({ deviceKey: rig.key, selection }, rig.signal)).toMatchObject(
        {
          ok: false,
          error: { code },
        },
      );
      expect(rig.phone.pulls()).toEqual([]);

      rig.setAccess({ state: 'ready' });
      expect((await rig.service.deviceItems(query, rig.signal)).ok).toBe(true);
      expect(rig.listings()).toBe(listings);
      const started = await rig.service.importFromDevice({ deviceKey: rig.key, selection }, rig.signal);
      expect(started.ok).toBe(true);
      if (!started.ok) throw new Error('the unlocked phone should import');
      const done = await untilTerminal(rig.service, started.value.runId, rig.signal);
      expect(done.state).toBe('succeeded');
      expect(done.totals.imported).toBe(1);
    },
  );
});
