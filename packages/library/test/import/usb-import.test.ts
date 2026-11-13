// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The USB hand-off (P3-B4, P3-B5): a USB item lands in the run's `usb_import` source named after the device,
 * its location is found via `usb`, its import record keeps the run, bridge, device and item and the hashes; the
 * same item again points its record at the asset. `knownAssets` answers USB "Only new": what the library still
 * has, not what was trashed or lost every location.
 */
import { randomBytes } from 'node:crypto';
import { newId, unwrap, type AssetId, type StagedImport, type UsbImportFacts } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { importer } from './fixture';

function usbFacts(overrides: Partial<UsbImportFacts> = {}): UsbImportFacts {
  return {
    runId: newId<'DeviceImportRun'>(),
    bridge: 'image-capture',
    deviceKey: 'ABCDEFGHIJKLMNOP',
    itemKey: 'QRSTUVWXYZ234567',
    createdAt: Date.UTC(2026, 9, 1),
    album: 'Goa',
    sha256: 'a'.repeat(64),
    sourceSha256: null,
    ...overrides,
  };
}

const usb = (facts: UsbImportFacts, label = 'Asha’s iPhone'): Partial<StagedImport> => ({
  channel: 'usb',
  usb: facts,
  device: { id: newId<'TransferDevice'>(), label, platform: 'ios' },
});

describe('ImportSink for USB', () => {
  it('files a USB item under the run’s usb_import source, via usb, with its import record', async () => {
    const t = await importer();
    const facts = usbFacts();
    const { file } = t.stage('IMG_0001.HEIC', randomBytes(4000), usb(facts));
    const outcome = unwrap(await t.sink.importStaged(file));
    expect(outcome.duplicate).toBe('none');
    expect(unwrap(t.repos.sources.get(outcome.sourceId))).toMatchObject({
      kind: 'usb_import',
      displayName: 'Asha’s iPhone',
      deviceLabel: 'Asha’s iPhone',
    });
    expect(t.rows('SELECT via, storage FROM asset_locations')).toEqual([{ via: 'usb', storage: 'managed' }]);
    expect(t.rows('SELECT * FROM usb_imports')).toEqual([
      {
        device_key: facts.deviceKey,
        item_key: facts.itemKey,
        asset_id: outcome.assetId,
        run_id: facts.runId,
        bridge: 'image-capture',
        device_created_at: facts.createdAt,
        album: 'Goa',
        sha256: facts.sha256,
        source_sha256: null,
        imported_at: expect.any(Number),
      },
    ]);
  });

  it('keeps one record per device item, pointed at the asset its bytes are', async () => {
    const t = await importer();
    const bytes = randomBytes(4000);
    const first = t.stage('IMG_0002.MOV', bytes, usb(usbFacts({ bridge: 'mtp' })));
    const asset = unwrap(await t.sink.importStaged(first.file)).assetId;
    // A later run pulls the same item again: the library already has the bytes.
    const again = t.stage('IMG_0002.MOV', bytes, usb(usbFacts({ bridge: 'adb', album: null })));
    const outcome = unwrap(await t.sink.importStaged(again.file));
    expect(outcome).toMatchObject({ assetId: asset, duplicate: 'already-in-library' });
    expect(t.rows('SELECT asset_id, bridge, album FROM usb_imports')).toEqual([
      { asset_id: asset, bridge: 'adb', album: null },
    ]);
  });

  it('keeps Wi-Fi uploads as they were, with no USB record', async () => {
    const t = await importer();
    const { file } = t.stage('clip.mov');
    const outcome = unwrap(await t.sink.importStaged(file));
    expect(unwrap(t.repos.sources.get(outcome.sourceId)).kind).toBe('wifi_import');
    expect(t.rows('SELECT via FROM asset_locations')).toEqual([{ via: 'wifi' }]);
    expect(t.rows('SELECT * FROM usb_imports')).toEqual([]);
  });

  it('knows the assets the library still has, and none it trashed or lost', async () => {
    const t = await importer();
    const ids: AssetId[] = [];
    for (const name of ['a.mov', 'b.mov', 'c.mov']) {
      const { file } = t.stage(
        name,
        randomBytes(3000),
        usb(usbFacts({ itemKey: `ITEM${name[0]}`.padEnd(16, 'A').toUpperCase() })),
      );
      ids.push(unwrap(await t.sink.importStaged(file)).assetId);
    }
    const [kept, trashed, lost] = ids;
    t.db.driver.prepare('UPDATE assets SET trashed_at = 1 WHERE id = ?').run(trashed ?? '');
    t.db.driver.prepare('UPDATE assets SET detached_at = 1 WHERE id = ?').run(lost ?? '');
    const never = newId<'Asset'>();
    const known = unwrap(await t.sink.knownAssets([...ids, never, kept ?? never]));
    expect([...known]).toEqual([kept]);
    expect(unwrap(await t.sink.knownAssets([])).size).toBe(0);
  });
});
