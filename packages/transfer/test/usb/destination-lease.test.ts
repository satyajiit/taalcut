// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, expect, it } from 'vitest';
import { ok, unwrap, type ImportSink } from '@taalcut/core';
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

afterEach(cleanScratch);
it('holds one destination lease across native pulling, verification and the sink commit', async () => {
  const dirs = await importFolders();
  let retained = 0;
  const copy = createCopySink(dirs.staging, dirs.originals, new Set());
  const sink: ImportSink = {
    ...copy.sink,
    retainDestination: async () => {
      retained++;
      return ok(() => {
        retained--;
      });
    },
    importStaged: async (file, options) => {
      expect(retained).toBe(1);
      return copy.sink.importStaged(file, options);
    },
  };
  const phone = createFakePhone(jpegs(1), {
    onPull: async () => {
      expect(retained).toBe(1);
      return 'ok';
    },
  });
  const service = createHarness(
    dirs.state,
    sink,
    {
      probe: async () => {
        expect(retained).toBe(1);
        return { ok: false };
      },
    },
    phone,
  );
  const life = new AbortController();
  try {
    const deviceKey = await connectPhone(service, phone, life.signal);
    unwrap(await service.openDevice(deviceKey, life.signal));
    const { runId } = unwrap(
      await service.importFromDevice(
        { deviceKey, selection: { filter: { onlyNew: false, timeZone: 'UTC' }, include: [], exclude: [] } },
        life.signal,
      ),
    );
    expect((await untilTerminal(service, runId, life.signal)).state).toBe('succeeded');
    expect(retained).toBe(0);
  } finally {
    life.abort();
    await service.close();
  }
});
