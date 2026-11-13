// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-OEM: the zone a clip was shot in. Two clips came in from one phone (synthetic values): 20260314_113000.mp4
 * (Samsung, utc_offset +0200) and VID_0001.mp4 (a camera app, a UTC time only) 2 h 15 min earlier.
 */
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { assetSummaries } from '../../src/profile/summaries';
import { captureOffsetsOf } from '../../src/repositories/capture-offsets';
import { factsFor, profileSetup, type ProfileSetup } from './profile-helpers';

const SAMSUNG = factsFor({ captureTime: '2026-03-14T11:30:00+02:00', captureOffsetMin: 120 });
const META_AI = factsFor({
  captureTime: '2026-03-14T07:15:00Z',
  device: { app: 'Sample Cam', appDevice: 'XC01' },
});

/** A clip in a second source (the Mac's own folder), not the phone's. */
function elsewhere({ repos }: ProfileSetup, name: string): AssetId {
  const source = unwrap(
    repos.sources.add({ kind: 'watched_folder', displayName: 'Mac', rootPath: '/Users/me/Mac' }),
  );
  const asset = unwrap(
    repos.assets.create({
      kind: 'video',
      sizeBytes: 1,
      originalFilename: name,
      contentHash: 'ab'.repeat(32),
    }),
  );
  unwrap(
    repos.assetLocations.add({
      assetId: asset.id,
      sourceId: source.id,
      storage: 'referenced',
      relativePath: name,
      sizeBytes: 1,
      state: 'present',
    }),
  );
  return asset.id;
}

/** The zone the summary would show. */
function zone({ db, repos }: ProfileSetup, id: AssetId) {
  return captureOffsetsOf(db, [unwrap(repos.assets.get(id))]).get(id);
}

describe('capture offsets', () => {
  it("stores the file's own offset and the instant", () => {
    const setup = profileSetup();
    const id = setup.asset();
    const row = unwrap(setup.repos.assets.setFacts(id, SAMSUNG));
    expect(row).toMatchObject({ captureTime: Date.UTC(2026, 2, 14, 9, 30, 0), captureOffsetMin: 120 });
    expect(zone(setup, id)).toEqual({ minutes: 120, from: 'file' });
  });

  it('keeps a UTC-only time without a zone when nothing nearby has one', () => {
    const setup = profileSetup();
    const id = setup.asset();
    expect(unwrap(setup.repos.assets.setFacts(id, META_AI)).captureOffsetMin).toBeNull();
    expect(zone(setup, id)).toBeNull();
  });

  it('borrows the zone of a clip from the same source shot hours away, in either order', () => {
    for (const order of [
      ['samsung', 'meta'],
      ['meta', 'samsung'],
    ] as const) {
      const setup = profileSetup();
      const ids = {
        samsung: setup.asset({ name: '20260314_113000.mp4' }),
        meta: setup.asset({ name: 'VID_0001.mp4' }),
      };
      for (const which of order)
        unwrap(setup.repos.assets.setFacts(ids[which], which === 'samsung' ? SAMSUNG : META_AI));
      expect(zone(setup, ids.meta)).toEqual({ minutes: 120, from: 'nearby' });
      expect(zone(setup, ids.samsung)).toEqual({ minutes: 120, from: 'file' });
    }
  });

  it('takes the nearest lender in time', () => {
    const setup = profileSetup();
    const { repos, asset } = setup;
    const lone = asset();
    unwrap(repos.assets.setFacts(asset(), factsFor({ captureTime: '2026-03-14T05:00:00+05:30' })));
    unwrap(
      repos.assets.setFacts(
        asset(),
        factsFor({ captureTime: '2026-03-14T10:00:00Z', captureOffsetMin: 120 }),
      ),
    );
    unwrap(repos.assets.setFacts(lone, factsFor({ captureTime: '2026-03-14T09:00:00Z' })));
    expect(zone(setup, lone)).toEqual({ minutes: 120, from: 'nearby' });
  });

  it('borrows nothing from more than 12 hours away, or from another source', () => {
    const setup = profileSetup();
    const { repos, asset } = setup;
    const far = asset();
    unwrap(repos.assets.setFacts(asset(), SAMSUNG));
    unwrap(repos.assets.setFacts(far, factsFor({ captureTime: '2026-03-15T00:00:00Z' })));
    expect(zone(setup, far)).toBeNull();
    const mac = elsewhere(setup, 'from-the-mac.mp4');
    unwrap(repos.assets.setFacts(mac, META_AI));
    expect(zone(setup, mac)).toBeNull();
  });

  it('lets a borrowed zone go when the lender no longer names one, or moves away in time', () => {
    const setup = profileSetup();
    const { repos, asset } = setup;
    const lender = asset();
    const borrower = asset();
    unwrap(repos.assets.setFacts(lender, SAMSUNG));
    unwrap(repos.assets.setFacts(borrower, META_AI));
    unwrap(repos.assets.setFacts(lender, factsFor({ captureTime: '2026-03-14T09:30:00Z' })));
    expect(zone(setup, borrower)).toBeNull();
    unwrap(repos.assets.setFacts(lender, SAMSUNG));
    expect(zone(setup, borrower)).toEqual({ minutes: 120, from: 'nearby' });
    unwrap(repos.assets.setFacts(lender, factsFor({ captureTime: '2026-11-21T10:00:00+02:00' })));
    expect(zone(setup, borrower)).toBeNull();
  });

  it('puts the offset and where it came from on the summary', () => {
    const setup = profileSetup();
    const { db, repos, asset } = setup;
    const ids: AssetId[] = [asset(), asset(), elsewhere(setup, 'from-the-mac.mp4')];
    unwrap(repos.assets.setFacts(ids[0]!, SAMSUNG));
    unwrap(repos.assets.setFacts(ids[1]!, META_AI));
    unwrap(repos.assets.setFacts(ids[2]!, META_AI));
    const rows = ids.map((id) => unwrap(repos.assets.get(id)));
    const summaries = new Map(assetSummaries(db, rows).map((summary) => [summary.id, summary]));
    expect(summaries.get(ids[0]!)?.captureOffset).toEqual({ minutes: 120, from: 'file' });
    expect(summaries.get(ids[1]!)?.captureOffset).toEqual({ minutes: 120, from: 'nearby' });
    expect(summaries.get(ids[2]!)?.captureOffset).toBeNull();
  });
});
