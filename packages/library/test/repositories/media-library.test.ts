// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Provisional Source / Asset / AssetLocation / Shot repositories, per ADR 0001 "Phase 1 schema stubs". */
import {
  FrameRates,
  RationalTime,
  unwrap,
  ValidationError,
  type AssetId,
  type SourceId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetDuration,
  Conflict,
  ConstraintViolation,
  createRepositories,
  shotTimes,
  type AssetLocationAdd,
  type LocationState,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const PARTIAL = '0123456789abcdef0123456789abcdef';
const VOLUME = '6F1C2B3A-0000-4000-8000-000000000001';

function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const repos = createRepositories(db);
  const folder = unwrap(
    repos.sources.add({
      kind: 'watched_folder',
      displayName: 'Trip',
      rootPath: '/Volumes/T7/Trip',
      volumeUuid: VOLUME,
    }),
  );
  const phone = unwrap(
    repos.sources.add({
      kind: 'wifi_import',
      displayName: 'iPhone, 12 Oct',
      rootPath: '/Users/me/Movies/Taalcut/Originals',
    }),
  );
  const asset = unwrap(
    repos.assets.create({ kind: 'video', sizeBytes: 1000, originalFilename: 'IMG_0001.MOV' }),
  );
  const location = (state: LocationState, extra: Partial<AssetLocationAdd> = {}): AssetLocationAdd => ({
    assetId: asset.id,
    sourceId: folder.id,
    storage: 'referenced',
    relativePath: `clip-${state}.mov`,
    volumeUuid: VOLUME,
    sizeBytes: 1000,
    state,
    ...extra,
  });
  const availability = (id: AssetId = asset.id) => unwrap(repos.assets.get(id)).availability;
  return { db, clock, repos, folder, phone, asset, location, availability };
}

describe('SourceRepository (ADR 0001)', () => {
  it('stores watched folders and import sessions with their volume', () => {
    const { repos, folder, phone } = setup();
    expect(folder).toMatchObject({
      kind: 'watched_folder',
      status: 'online',
      volumeUuid: VOLUME,
      volumeName: null,
    });
    // Import sessions share the managed originals root.
    const second = unwrap(
      repos.sources.add({
        kind: 'usb_import',
        displayName: 'USB',
        rootPath: '/Users/me/Movies/Taalcut/Originals',
      }),
    );
    expect(second.rootPath).toBe(phone.rootPath);
    expect(repos.sources.list({ kinds: ['wifi_import', 'usb_import'] })).toHaveLength(2);
    const updated = unwrap(repos.sources.update(folder.id, { status: 'offline', volumeName: 'T7' }));
    expect(updated).toMatchObject({ status: 'offline', volumeName: 'T7' });
  });

  it('watches a root once per volume, and validates paths', () => {
    const { repos } = setup();
    const dup = repos.sources.add({
      kind: 'watched_folder',
      displayName: 'Again',
      rootPath: '/Volumes/T7/Trip',
      volumeUuid: VOLUME,
    });
    expect(!dup.ok && Conflict.is(dup.error)).toBe(true);
    const otherDisk = repos.sources.add({
      kind: 'watched_folder',
      displayName: 'Other disk, same mount path',
      rootPath: '/Volumes/T7/Trip',
      volumeUuid: 'OTHER',
    });
    expect(otherDisk.ok).toBe(true);
    expect(repos.sources.add({ kind: 'watched_folder', displayName: 'x', rootPath: 'Trip' }).ok).toBe(false);
    expect(repos.sources.add({ kind: 'watched_folder', displayName: ' ', rootPath: '/x' }).ok).toBe(false);
  });
});

describe('AssetRepository (ADR 0001)', () => {
  it('keys assets by BLAKE3 and finds candidates by partial hash', () => {
    const { repos, asset } = setup();
    expect(asset).toMatchObject({ availability: 'missing', contentHashAlg: null, durationValue: null });
    const hashed = unwrap(
      repos.assets.create({
        kind: 'video',
        sizeBytes: 5,
        originalFilename: 'b.mov',
        contentHash: HASH_A,
        partialHash: PARTIAL,
        duration: { value: 1, rate: FrameRates.fps29_97 },
        rotationDegrees: 90,
      }),
    );
    expect(hashed).toMatchObject({
      contentHashAlg: 'blake3',
      durationValue: 1,
      durationRateNum: 30000,
      durationRateDen: 1001,
    });
    expect(repos.assets.findByContentHash(HASH_A)?.id).toBe(hashed.id);
    expect(repos.assets.findByPartialHash(PARTIAL).map((a) => a.id)).toEqual([hashed.id]);
    const dup = repos.assets.create({
      kind: 'video',
      sizeBytes: 5,
      originalFilename: 'copy.mov',
      contentHash: HASH_A,
    });
    expect(!dup.ok && Conflict.is(dup.error)).toBe(true);
    // Hashing later fills the key, and finds duplicates.
    expect(unwrap(repos.assets.setContentHash(asset.id, HASH_B)).contentHash).toBe(HASH_B);
    const clash = repos.assets.setContentHash(asset.id, HASH_A);
    expect(!clash.ok && Conflict.is(clash.error)).toBe(true);
  });

  it('fills probe columns and rejects float or half-set RationalTime', () => {
    const { db, repos, asset } = setup();
    const probed = unwrap(repos.assets.updateProbe(asset.id, { width: 1080, height: 1920, captureTime: 5 }));
    expect(probed).toMatchObject({ width: 1080, height: 1920, captureTime: 5, durationValue: null });
    expect(unwrap(repos.assets.updateProbe(asset.id, {}))).toEqual(probed);
    const float = repos.assets.updateProbe(asset.id, { duration: { value: 2.5, rate: FrameRates.fps24 } });
    expect(!float.ok && ValidationError.is(float.error)).toBe(true);
    const zeroDen = repos.assets.updateProbe(asset.id, { duration: { value: 2, rate: { num: 24, den: 0 } } });
    expect(!zeroDen.ok && ValidationError.is(zeroDen.error)).toBe(true);
    // Value, numerator and denominator are all set or all null, enforced by the table too.
    expect(() =>
      db.driver.prepare('UPDATE assets SET duration_value = 5 WHERE id = ?').run(asset.id),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      db.driver
        .prepare('UPDATE assets SET duration_value = 5, duration_rate_num = 24 WHERE id = ?')
        .run(asset.id),
    ).toThrow(/CHECK constraint/);
    const badHash = repos.assets.create({
      kind: 'image',
      sizeBytes: 1,
      originalFilename: 'a',
      contentHash: 'XYZ',
    });
    expect(badHash.ok).toBe(false);
    const rotation = repos.assets.create({
      kind: 'image',
      sizeBytes: 1,
      originalFilename: 'a',
      rotationDegrees: 45 as 90,
    });
    expect(!rotation.ok && ConstraintViolation.is(rotation.error)).toBe(true);
  });
});

describe('AssetLocation and availability (ADR 0001)', () => {
  it('derives availability: present > icloud_placeholder > offline > missing', () => {
    const { repos, location, availability } = setup();
    const offline = unwrap(repos.assetLocations.add(location('offline')));
    expect(availability()).toBe('offline');
    const placeholder = unwrap(repos.assetLocations.add(location('icloud_placeholder')));
    expect(availability()).toBe('icloud_placeholder');
    const present = unwrap(repos.assetLocations.add(location('present')));
    expect(availability()).toBe('online');
    unwrap(repos.assetLocations.setState(present.id, 'missing'));
    expect(availability()).toBe('icloud_placeholder');
    unwrap(repos.assetLocations.remove(placeholder.id));
    expect(availability()).toBe('offline');
    unwrap(repos.assetLocations.relink(offline.id, { relativePath: 'moved/clip.mov' }));
    expect(availability()).toBe('online');
    expect(unwrap(repos.assetLocations.get(offline.id))).toMatchObject({
      relativePath: 'moved/clip.mov',
      state: 'present',
    });
  });

  it('re-derives in the same transaction, and rolls back with it', () => {
    const { db, repos, location, availability } = setup();
    const loc = unwrap(repos.assetLocations.add(location('present')));
    expect(() =>
      db.transaction(() => {
        unwrap(repos.assetLocations.setState(loc.id, 'offline'));
        expect(availability()).toBe('offline'); // visible inside the transaction
        throw new Error('scan aborted');
      }),
    ).toThrow('scan aborted');
    expect(availability()).toBe('online');
  });

  it('takes a whole volume offline, and re-derives when a source is removed', () => {
    const { repos, folder, phone, asset, location, availability } = setup();
    unwrap(repos.assetLocations.add(location('present')));
    unwrap(
      repos.assetLocations.add(
        location('present', {
          sourceId: phone.id,
          storage: 'managed',
          relativePath: 'a.mov',
          volumeUuid: 'INTERNAL',
        }),
      ),
    );
    expect(unwrap(repos.assetLocations.setStateOnVolume(VOLUME, 'offline'))).toBe(1);
    expect(availability()).toBe('online'); // the managed copy on the internal disk is still there
    unwrap(repos.sources.remove(phone.id));
    expect(availability()).toBe('offline');
    unwrap(repos.sources.remove(folder.id));
    expect(availability()).toBe('missing');
    expect(repos.assetLocations.listByAsset(asset.id)).toEqual([]);
  });

  it('allows one managed copy per asset and one row per (asset, source, path)', () => {
    const { repos, phone, location, asset, folder } = setup();
    unwrap(repos.assetLocations.add(location('present', { sourceId: phone.id, storage: 'managed' })));
    const second = repos.assetLocations.add(
      location('present', { sourceId: phone.id, storage: 'managed', relativePath: 'b.mov' }),
    );
    expect(!second.ok && Conflict.is(second.error)).toBe(true);
    unwrap(repos.assetLocations.add(location('present')));
    const same = repos.assetLocations.add(location('present'));
    expect(!same.ok && Conflict.is(same.error)).toBe(true);
    // New bytes at the same path are a different asset, so a second row is allowed.
    const other = unwrap(
      repos.assets.create({ kind: 'video', sizeBytes: 2, originalFilename: 'IMG_0001.MOV' }),
    );
    expect(repos.assetLocations.add(location('present', { assetId: other.id })).ok).toBe(true);
    expect(repos.assetLocations.listBySource(folder.id)).toHaveLength(2);
    expect(repos.assetLocations.listByAsset(asset.id)).toHaveLength(2);
    expect(repos.assetLocations.add(location('present', { relativePath: '/abs.mov' })).ok).toBe(false);
  });

  it('keeps every location inside its source root (review 2)', () => {
    const { repos, location } = setup();
    for (const relativePath of [
      '',
      '.',
      '../escape.mov',
      'foo/../../outside.mov',
      'a/..',
      '..\\up.mov',
      'C:clip.mov',
      '\\\\server/x.mov',
    ]) {
      const added = repos.assetLocations.add(location('present', { relativePath }));
      expect(!added.ok && ValidationError.is(added.error), relativePath).toBe(true);
    }
    const loc = unwrap(repos.assetLocations.add(location('present', { relativePath: './day 1//clip.mov' })));
    expect(loc.relativePath).toBe('day 1/clip.mov');
    expect(repos.assetLocations.relink(loc.id, { relativePath: 'x/../../y.mov' }).ok).toBe(false);
    expect(
      unwrap(repos.assetLocations.relink(loc.id, { relativePath: 'moved/./clip.mov' })).relativePath,
    ).toBe('moved/clip.mov');
  });

  it('records rescans and finds relink candidates', () => {
    const { repos, location } = setup();
    const loc = unwrap(repos.assetLocations.add(location('present')));
    const scanned = unwrap(
      repos.assetLocations.recordScan(loc.id, { mtimeMs: 77, partialHash: PARTIAL, sizeBytes: 999 }),
    );
    expect(scanned).toMatchObject({ mtimeMs: 77, partialHash: PARTIAL, sizeBytes: 999, state: 'present' });
    expect(unwrap(repos.assetLocations.recordScan(loc.id, {}))).toEqual(scanned);
    expect(repos.assetLocations.findByPartialHash(PARTIAL).map((l) => l.id)).toEqual([loc.id]);
    expect(repos.assetLocations.setState('nope' as never, 'present').ok).toBe(false);
  });
});

describe('stored media time (review 2: one integer rate lost NTSC)', () => {
  it('keeps an NTSC duration exact on assets and shots', () => {
    const { repos, asset } = setup();
    const ntsc = RationalTime.of(24000, FrameRates.fps23_976); // exactly 1001 s
    const probed = unwrap(repos.assets.updateProbe(asset.id, { duration: ntsc }));
    expect(assetDuration(probed)).toEqual(ntsc);
    expect(RationalTime.toSeconds(assetDuration(unwrap(repos.assets.get(asset.id)))!)).toBe(1001);
    const start = RationalTime.of(30000, FrameRates.fps29_97); // also 1001 s
    unwrap(repos.shots.replaceForAsset(asset.id, 0, [{ start, duration: ntsc }]));
    const [shot] = repos.shots.listByAsset(asset.id);
    // A TimeRange shares one rate between start and duration: both are exact at the common rate.
    expect(RationalTime.equals(shotTimes(shot!).start, start)).toBe(true);
    expect(RationalTime.equals(shotTimes(shot!).duration, ntsc)).toBe(true);
    expect(RationalTime.toSeconds(shotTimes(shot!).start)).toBe(1001);
  });

  it('stores rates reduced, so equal rates have equal columns', () => {
    const { repos, asset } = setup();
    const probed = unwrap(
      repos.assets.updateProbe(asset.id, { duration: { value: 2, rate: { num: 48, den: 2 } } }),
    );
    expect(probed).toMatchObject({ durationValue: 2, durationRateNum: 24, durationRateDen: 1 });
    expect(unwrap(repos.assets.updateProbe(asset.id, { duration: null }))).toMatchObject({
      durationValue: null,
      durationRateNum: null,
      durationRateDen: null,
    });
  });
});

describe('ShotRepository (ADR 0001)', () => {
  it('replaces shots atomically with integer RationalTime', () => {
    const { repos, asset } = setup();
    const at24 = (value: number) => RationalTime.of(value, FrameRates.fps24);
    const second = at24(24);
    const [first] = unwrap(repos.shots.replaceForAsset(asset.id, 0, [{ start: at24(0), duration: second }]));
    const shots = unwrap(
      repos.shots.replaceForAsset(asset.id, 1, [
        { start: at24(0), duration: second },
        { start: at24(24), duration: at24(48) },
      ]),
    );
    expect(shots[0]).toBe(first); // same start: the ShotId is kept
    expect(repos.shots.listByAsset(asset.id).map((s) => [s.indexInAsset, s.startValue])).toEqual([
      [0, 0],
      [1, 24],
    ]);
    const float = repos.shots.replaceForAsset(asset.id, 2, [
      { start: { ...at24(0), value: 0.5 }, duration: second },
    ]);
    expect(!float.ok && ValidationError.is(float.error)).toBe(true);
    expect(repos.shots.listByAsset(asset.id)).toHaveLength(2);
    const missing = repos.shots.replaceForAsset('missing' as AssetId, 0, [
      { start: second, duration: second },
    ]);
    expect(!missing.ok && ConstraintViolation.is(missing.error)).toBe(true);
    unwrap(repos.assets.remove(asset.id));
    expect(repos.shots.listByAsset(asset.id)).toEqual([]);
    expect(repos.sources.get('none' as SourceId).ok).toBe(false);
  });
});
