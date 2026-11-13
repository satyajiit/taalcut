// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What vision stores in the analysis reaches casting: 100 ms curves and
 * full-rate peaks from `ShotAnalysis.signals`, and place clusters from
 * capture locations (else the description's place).
 */
import { unwrap, type ShotId, type ShotSignals } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createShotProfileSource } from '../../src/index';
import { shotAnalysis, shotRange } from '../../src/repositories/shots';
import { clusterPlaces, namedPlace, PLACE_RADIUS_M } from '../../src/profile/profile-signals';
import { searchFixture } from '../search/search-helpers';

type Fixture = ReturnType<typeof searchFixture>;

/** Stores these signals in the shot's analysis, as vision.analyse's result does. */
function storeSignals(s: Fixture, shotId: ShotId, signals: ShotSignals | undefined) {
  const analysis = shotAnalysis(unwrap(s.repos.shots.get(shotId)));
  if (!analysis) throw new Error('the fixture shot has no analysis');
  const { signals: _old, ...rest } = analysis;
  unwrap(s.repos.shots.putAnalyses([{ shotId, analysis: signals ? { ...rest, signals } : rest }]));
}

function videoShots(s: Fixture) {
  const kindOf = (assetId: string) =>
    String(s.db.driver.prepare('SELECT kind FROM assets WHERE id = ?').get(assetId)?.kind);
  return [...s.fixture.shotsByTheme.values()]
    .flat()
    .map((shotId) => unwrap(s.repos.shots.get(shotId)))
    .filter((shot) => kindOf(shot.assetId) === 'video');
}

describe('shot profiles from vision’s stored signals', () => {
  it('maps the analysis’s curves and peaks onto each shot', async () => {
    const s = searchFixture();
    const source = createShotProfileSource({ db: s.db });
    const [shot, other] = videoShots(s);
    const signals: ShotSignals = {
      version: 2,
      motionCurve: [0.1, 0.7, 0.2],
      sharpnessCurve: [0.9, 0.8, 0.85],
      motionPeakFrames: [4],
    };
    storeSignals(s, shot!.id, signals);
    const [profile] = unwrap(await source.profiles([{ assetId: '', shotId: shot!.id }]));
    expect(profile).toMatchObject({
      motionCurve: signals.motionCurve,
      sharpnessCurve: signals.sharpnessCurve,
      motionPeakFrames: [4],
    });

    // An analysis stored before vision wrote signals, or a shot past an hour (empty curves): casting falls back.
    storeSignals(s, other!.id, undefined);
    const [older] = unwrap(await source.profiles([{ assetId: '', shotId: other!.id }]));
    expect(older).toMatchObject({ motionCurve: null, sharpnessCurve: null, motionPeakFrames: [] });
    storeSignals(s, other!.id, { ...signals, motionCurve: [], sharpnessCurve: [] });
    const [long] = unwrap(await source.profiles([{ assetId: '', shotId: other!.id }]));
    expect(long).toMatchObject({ motionCurve: null, sharpnessCurve: null, motionPeakFrames: [4] });

    // Out of range: the analysis is refused whole, so nothing half-valid is stored.
    const bad = s.repos.shots.putAnalyses([
      {
        shotId: other!.id,
        analysis: { ...shotAnalysis(unwrap(s.repos.shots.get(other!.id)))!, signals: { ...signals, motionCurve: [2] } },
      },
    ]);
    expect(bad.ok).toBe(false);
  });

  it('carries vision’s best frame inside the shot, and null without one (FIX-TRIM)', async () => {
    const s = searchFixture();
    const source = createShotProfileSource({ db: s.db });
    // A shot that starts inside its asset: vision stores the best frame from the shot's start (analyze-shots.ts
    // takes the shot's first frame off the sample's), and the profile serves it so, never from the asset's start.
    const shot = videoShots(s).find((row) => shotRange(row).start.value > 0);
    const analysis = shotAnalysis(unwrap(s.repos.shots.get(shot!.id)))!;
    const length = analysis.range.duration.value;
    const best = Math.min(7, length - 1);
    unwrap(s.repos.shots.putAnalyses([{ shotId: shot!.id, analysis: { ...analysis, bestFrame: best } }]));
    const read = async () => unwrap(await source.profiles([{ assetId: '', shotId: shot!.id }]))[0]!;
    const profile = await read();
    expect(profile.range.start.value).toBeGreaterThan(0);
    expect(profile.bestFrame).toBe(best);
    // A stored frame past the shot's end (an older analysis on a re-cut shot) is kept inside it.
    s.db.driver.prepare('UPDATE shots SET best_frame = ? WHERE id = ?').run(length + 50, shot!.id);
    expect((await read()).bestFrame).toBe(length - 1);
    // An unanalysed shot has none.
    s.db.driver.prepare('UPDATE shots SET best_frame = NULL, analysis = NULL WHERE id = ?').run(shot!.id);
    expect((await read()).bestFrame).toBeNull();
  });

  it('groups capture locations within 300 m, and falls back to the described place', async () => {
    const s = searchFixture();
    const source = createShotProfileSource({ db: s.db });
    const shots = videoShots(s);
    const assets = [...new Set(shots.map((shot) => shot.assetId))].slice(0, 4);
    const at = s.db.driver.prepare(
      'UPDATE assets SET latitude = ?, longitude = ?, updated_at = ? WHERE id = ?',
    );
    // Goa: three steps of ~200 m along the beach chain into one place; Mumbai is another.
    at.run(15.5, 73.75, 10, assets[0]!);
    at.run(15.5018, 73.75, 11, assets[1]!);
    at.run(15.5036, 73.75, 12, assets[2]!);
    at.run(19.07, 72.87, 13, assets[3]!);
    const shotOf = (assetId: string) => shots.find((shot) => shot.assetId === assetId)!.id;
    const profiles = unwrap(
      await source.profiles(assets.map((assetId) => ({ assetId: '', shotId: shotOf(assetId) }))),
    );
    const place = new Map(profiles.map((p) => [p.assetId, p.placeClusterId]));
    expect(place.get(assets[0]!)).toBe(place.get(assets[2]!));
    expect(place.get(assets[0]!)).toMatch(/^geo:/);
    expect(place.get(assets[3]!)).not.toBe(place.get(assets[0]!));
    // A shot with no location keeps the description's place.
    const plain = shots.find((shot) => !assets.includes(shot.assetId) && shot.place)!;
    const [described] = unwrap(await source.profiles([{ assetId: '', shotId: plain.id }]));
    expect(described!.placeClusterId).toBe(namedPlace(plain.place));
  });
});

describe('clusterPlaces and namedPlace', () => {
  it('links neighbours by single linkage and names a cluster by its smallest id', () => {
    const step = (PLACE_RADIUS_M * 0.9) / 111_195;
    const chain = Array.from({ length: 5 }, (_, i) => ({ id: `a${4 - i}`, lat: 10 + i * step, lon: 20 }));
    const far = { id: 'z', lat: 10 + 6 * step + 0.01, lon: 20 };
    const clusters = clusterPlaces([...chain, far]);
    expect(new Set(chain.map((p) => clusters.get(p.id)))).toEqual(new Set(['geo:a0']));
    expect(clusters.get('z')).toBe('geo:z');
  });

  it('folds case, accents and spacing in a described place', () => {
    expect(namedPlace('  São  Paulo ')).toBe('place:sao paulo');
    expect(namedPlace('Baga Beach!')).toBe(namedPlace('baga beach'));
    expect(namedPlace('')).toBeNull();
    expect(namedPlace(null)).toBeNull();
  });
});
