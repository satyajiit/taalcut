// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Core's ShotProfileSource over the generated library (P2-M2): what casting reads about each shot. */
import { RationalTime, unwrap, type ShotProfile, type ShotProfileFilter } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createShotProfileSource, shotDescriptions } from '../../src/index';
import { searchFixture } from '../search/search-helpers';

function setup(withVectors = true) {
  const s = searchFixture();
  const source = createShotProfileSource({ db: s.db, ...(withVectors ? { vectors: () => s.vectors } : {}) });
  const kindOf = (assetId: string) =>
    String(s.db.driver.prepare('SELECT kind FROM assets WHERE id = ?').get(assetId)?.kind);
  return { ...s, source, kindOf };
}

const key = (p: ShotProfile) => p.shotId ?? `asset:${p.assetId}`;
const captured = (p: ShotProfile) => p.capturedAt ?? p.fileDate;
const norm = (v: Float32Array) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));

/** The filter's meaning, as casting's in-memory catalogue applies it. */
function passes(p: ShotProfile, f: ShotProfileFilter): boolean {
  if (f.exclude?.has(key(p))) return false;
  if (f.orientations && !f.orientations.includes(p.orientation)) return false;
  if (f.minQuality !== undefined && p.quality < f.minQuality) return false;
  if (f.minDuration && p.kind === 'video' && RationalTime.isBefore(p.range.duration, f.minDuration))
    return false;
  if (f.capturedFrom !== undefined && captured(p) < f.capturedFrom) return false;
  if (f.capturedTo !== undefined && captured(p) > f.capturedTo) return false;
  if (f.assetIds && !f.assetIds.includes(p.assetId)) return false;
  return !f.sourceIds || (p.sourceId !== null && f.sourceIds.includes(p.sourceId));
}

describe('createShotProfileSource', () => {
  it('maps what vision stored on a shot, with its direction in the embedding space', async () => {
    const s = setup();
    const shotId = s.fixture.shotsByTheme.get('beach-sunset')![0]!;
    const shot = unwrap(s.repos.shots.get(shotId));
    s.db.driver.prepare('UPDATE asset_locations SET mtime_ms = 1234 WHERE asset_id = ?').run(shot.assetId);
    const [profile] = unwrap(await s.source.profiles([{ assetId: '', shotId }]));
    expect(profile).toMatchObject({
      fileDate: 1234,
      shotId,
      assetId: shot.assetId,
      kind: 'video',
      quality: shot.quality,
      motionClass: shot.motion,
      energy: shot.energy,
      duplicateGroup: shot.duplicateGroup,
      bestTake: shot.bestTake,
      // No capture location in the fixture: the description's place, folded.
      placeClusterId: shot.place ? `place:${shot.place.toLowerCase()}` : null,
      motionCurve: null,
      motionPeakFrames: [],
    });
    expect(profile!.objectTags.length).toBeGreaterThan(0);
    expect(profile!.sourceId).not.toBeNull();
    expect(profile!.capturedAt).toBeGreaterThan(0);
    expect(profile!.available!.start.value).toBe(0);
    expect(RationalTime.toSeconds(profile!.available!.duration)).toBeGreaterThanOrEqual(
      RationalTime.toSeconds(profile!.range.duration),
    );
    expect(norm(profile!.embedding)).toBeCloseTo(1, 5);
  });

  it('profiles a photo by its asset, found by its asset or by its still’s shot', async () => {
    const s = setup();
    const still = [...s.fixture.shotsByTheme.values()]
      .flat()
      .find((shotId) => s.kindOf(unwrap(s.repos.shots.get(shotId)).assetId) === 'image')!;
    const assetId = unwrap(s.repos.shots.get(still)).assetId;
    const profiles = unwrap(
      await s.source.profiles([
        { assetId: '', shotId: still },
        { assetId, shotId: null },
      ]),
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ assetId, shotId: null, kind: 'image', available: null });
    expect(profiles[0]!.range.duration.value).toBe(0);
  });

  it('lists what passes each filter, oldest capture first, and leaves out trashed and audio assets', async () => {
    const s = setup();
    const all = unwrap(await s.source.list({}, 10_000));
    expect(all.every((p) => s.kindOf(p.assetId) !== 'audio')).toBe(true);
    expect(all.map(captured)).toEqual([...all.map(captured)].sort((a, b) => a - b));
    const from = Date.UTC(2025, 10, 1);
    const filters: ShotProfileFilter[] = [
      { orientations: ['portrait'] },
      { orientations: [] },
      { minQuality: 0.6 },
      { minDuration: RationalTime.of(5, { num: 1, den: 1 }) },
      { capturedFrom: from, capturedTo: from + 30 * 86_400_000 },
      { sourceIds: [s.fixture.sources[1]!] },
      { assetIds: [...new Set(all.slice(0, 12).map((p) => p.assetId))] },
      { assetIds: [] },
      { exclude: new Set(all.slice(0, 10).map(key)) },
    ];
    for (const filter of filters) {
      const listed = unwrap(await s.source.list(filter, 10_000));
      expect(listed.map(key)).toEqual(all.filter((p) => passes(p, filter)).map(key));
    }
    expect(unwrap(await s.source.list({}, 3))).toHaveLength(3);

    s.db.driver.prepare('UPDATE assets SET trashed_at = 1 WHERE id = ?').run(all[0]!.assetId);
    const after = unwrap(await s.source.list({}, 10_000));
    expect(after.some((p) => p.assetId === all[0]!.assetId)).toBe(false);
    expect(unwrap(await s.source.profiles([{ assetId: '', shotId: all[0]!.shotId ?? '' }]))).toEqual([]);
  });

  it('returns the newest shots’ directions, and nothing without a vector index', async () => {
    const s = setup();
    const recent = unwrap(await s.source.recent(5));
    expect(recent).toHaveLength(5);
    expect(recent.every((v) => Math.abs(norm(v) - 1) < 1e-5)).toBe(true);

    const bare = setup(false);
    expect(unwrap(await bare.source.recent(5))).toEqual([]);
    const [profile] = unwrap(await bare.source.list({}, 1));
    expect(profile!.embedding.length).toBe(0);
  });

  it('stops before reading when cancelled', async () => {
    const s = setup();
    const signal = AbortSignal.abort();
    for (const call of [
      s.source.profiles([], signal),
      s.source.list({}, 5, signal),
      s.source.recent(5, signal),
    ]) {
      const result = await call;
      expect(!result.ok && result.error.code).toBe('core.cancelled');
    }
  });

  it('reads what indexing said each shot shows, for the Librarian’s rerank (FIX-LIBRARIAN)', () => {
    const s = setup();
    const [described, blank] = s.fixture.shotsByTheme.get('beach-sunset')!;
    s.db.driver.prepare("UPDATE shots SET description = ' ' WHERE id = ?").run(blank!);
    const read = shotDescriptions(s.db, [described!, blank!, 'not-a-shot']);
    expect([...read.keys()]).toEqual([described]);
    expect(read.get(described!)).toBe(unwrap(s.repos.shots.get(described!)).description);
    expect(shotDescriptions(s.db, [])).toEqual(new Map());
  });
});
