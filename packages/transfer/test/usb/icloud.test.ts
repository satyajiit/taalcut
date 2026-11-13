// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Placeholder rules, and a run of three cloud-only items that is not an error. */
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssetId } from '@taalcut/core';
import type { DeviceItem } from '../../src/usb/bridge';
import { classifyIcloud, type IcloudFacts } from '../../src/usb/icloud';
import { createFakePhone } from './fake-phone';
import { connectPhone, createCopySink, createHarness, untilTerminal } from './import-harness';

const dirs: string[] = [];
const selection = { filter: { onlyNew: true, timeZone: 'UTC' }, include: [], exclude: [] };

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('iCloud placeholder rules', () => {
  const local: IcloudFacts = {
    iCloudPhotos: true,
    availability: 'local',
    detail: null,
    shortOriginal: false,
    downloadFailedCount: 0,
  };

  it('treats each placeholder signal as an explanation', () => {
    expect(classifyIcloud({ ...local, iCloudPhotos: false, availability: 'cloud-only' })).toBe('in-icloud');
    expect(classifyIcloud({ ...local, detail: 'devices.item_empty' })).toBe('in-icloud');
    expect(classifyIcloud({ ...local, detail: 'devices.download_failed', downloadFailedCount: 1 })).toBe(
      'no',
    );
    expect(classifyIcloud({ ...local, detail: 'devices.download_failed', downloadFailedCount: 2 })).toBe(
      'in-icloud',
    );
    expect(classifyIcloud({ ...local, shortOriginal: true })).toBe('in-icloud');
    expect(classifyIcloud({ ...local, iCloudPhotos: false, detail: 'devices.item_empty' })).toBe('no');
    expect(classifyIcloud({ ...local, iCloudPhotos: false, shortOriginal: true })).toBe('no');
    expect(
      classifyIcloud({
        ...local,
        iCloudPhotos: false,
        detail: 'devices.download_failed',
        downloadFailedCount: 2,
      }),
    ).toBe('no');
    expect(classifyIcloud(local)).toBe('no');
    expect(
      classifyIcloud({
        ...local,
        availability: 'cloud-only',
        detail: 'devices.item_empty',
        shortOriginal: true,
        downloadFailedCount: 2,
      }),
    ).toBe('in-icloud');
  });

  it('finishes three placeholder items without staging them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloud-run-'));
    dirs.push(root);
    const staging = join(root, 'staging');
    const originals = join(root, 'originals');
    await mkdir(staging);
    await mkdir(originals);
    const known = new Set<AssetId>();
    const copy = createCopySink(staging, originals, known);
    const phone = createFakePhone(placeholders(), { iCloudPhotos: true });
    const service = createHarness(
      join(root, 'state'),
      copy.sink,
      {
        async probe() {
          throw new Error('a placeholder was read');
        },
      },
      phone,
    );
    const life = new AbortController();
    try {
      const key = await connectPhone(service, phone, life.signal);
      const opened = await service.openDevice(key, life.signal);
      expect(opened.ok).toBe(true);
      const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const done = await untilTerminal(service, started.value.runId, life.signal);
      expect(done.state).toBe('succeeded');
      expect(done.totals.inICloud).toBe(3);
      expect(done.totals.failed).toBe(0);
      expect(done.totals.imported).toBe(0);
      expect(copy.imports()).toBe(0);
      expect(phone.pulls()).toEqual([]);
    } finally {
      life.abort();
    }
  });
});

describe('iCloud placeholders the mac helper reports', () => {
  it('ends each real signal in-icloud, imports the rest, and leaves nothing of them staged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloud-signals-'));
    dirs.push(root);
    const staging = join(root, 'staging');
    const originals = join(root, 'originals');
    await mkdir(staging);
    await mkdir(originals);
    const copy = createCopySink(staging, originals, new Set<AssetId>());
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9]);
    const files = [
      // ICC -21447 "The object data is empty".
      listed('empty', 'IMG_0001.HEIC', jpeg, { sizeBytes: 2_000_000 }),
      // ICC -9934 twice.
      listed('failing', 'IMG_0002.HEIC', jpeg, { sizeBytes: 2_000_000 }),
      // Fewer bytes than the listing.
      listed('short', 'IMG_0003.JPG', jpeg, { sizeBytes: 900_000 }),
      // The listing says HEIC, the body is a JPEG preview of the right length.
      listed('preview', 'IMG_0004.HEIC', jpeg, {}),
      listed('local', 'IMG_0005.JPG', jpeg, {}),
    ];
    const phone = createFakePhone(files, {
      iCloudPhotos: true,
      helperFailure: (itemId) => {
        if (itemId === 'empty') return 'devices.item_empty';
        if (itemId === 'failing') return 'devices.download_failed';
        return null;
      },
    });
    const service = createHarness(
      join(root, 'state'),
      copy.sink,
      {
        async probe() {
          return { ok: false as const };
        },
      },
      phone,
    );
    const life = new AbortController();
    try {
      const key = await connectPhone(service, phone, life.signal);
      expect((await service.openDevice(key, life.signal)).ok).toBe(true);
      const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const done = await untilTerminal(service, started.value.runId, life.signal);
      expect(done.state).toBe('succeeded');
      expect(done.error).toBeUndefined();
      expect(done.totals.inICloud).toBe(4);
      expect(done.totals.failed).toBe(0);
      expect(done.totals.rejected).toBe(0);
      expect(done.totals.imported).toBe(1);
      expect(copy.imports()).toBe(1);
      // download_failed is retried once before it counts; every other signal is believed at once.
      expect(phone.pulls().filter((id) => id === 'failing')).toHaveLength(2);
      expect(phone.pulls().filter((id) => id === 'empty')).toHaveLength(1);
      expect(phone.pulls().filter((id) => id === 'short')).toHaveLength(1);
      // Only the imported item's original and journal are in staging: no part, no copy of a placeholder.
      const left = await readdir(staging);
      expect(left.filter((name) => name.endsWith('.part'))).toEqual([]);
      expect(left.filter((name) => name.endsWith('.import.json'))).toHaveLength(1);
      expect(left).toHaveLength(2);
    } finally {
      life.abort();
    }
  });
});

function listed(
  id: string,
  name: string,
  bytes: Buffer,
  overrides: Partial<DeviceItem>,
): { item: DeviceItem; bytes: Buffer } {
  return {
    bytes,
    item: {
      id,
      name,
      kind: 'image',
      sizeBytes: bytes.length,
      createdAt: 1_700_000_000_000 + name.length,
      modifiedAt: null,
      width: null,
      height: null,
      durationMs: null,
      type: null,
      folder: 'DCIM/100APPLE',
      album: null,
      flags: {},
      sidecars: [],
      availability: 'unknown',
      ...overrides,
    },
  };
}

function placeholders(): { item: DeviceItem; bytes: Buffer }[] {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  return [0, 1, 2].map((index) => ({
    bytes,
    item: {
      id: `cloud-${index}`,
      name: `cloud-${index}.jpg`,
      kind: 'image',
      sizeBytes: bytes.length,
      createdAt: 1_700_000_000_000 + index,
      modifiedAt: null,
      width: null,
      height: null,
      durationMs: null,
      type: 'image/jpeg',
      folder: null,
      album: null,
      flags: {},
      sidecars: [],
      availability: 'cloud-only',
    },
  }));
}
