// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap, ValidationError, type BeatMap, type MediaFacts } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { assetDuration, markDetached, parseCaptureTime } from '../../src/index';
import { applyStageResult } from '../../src/indexing/apply-result';
import { fakeClock, openTestDb } from '../helpers';
import { at24, factsFor, profileSetup } from './profile-helpers';

describe('asset facts (P2-L1)', () => {
  it('reads capture times with and without an offset', () => {
    expect(parseCaptureTime('2025-10-20T19:30:00+05:30')).toEqual({
      at: Date.UTC(2025, 9, 20, 14, 0),
      offsetMin: 330,
    });
    expect(parseCaptureTime('2025-10-20 08:00:00.250-0300')).toEqual({
      at: Date.UTC(2025, 9, 20, 11, 0, 0, 250),
      offsetMin: -180,
    });
    // An MP4's creation_time is a UTC instant: it names no zone (LIB1-OEM).
    expect(parseCaptureTime('2025-10-20T08:00:00Z')).toEqual({ at: Date.UTC(2025, 9, 20, 8), offsetMin: null });
    expect(parseCaptureTime('2025-10-20T08:00:00+00:00')).toEqual({ at: Date.UTC(2025, 9, 20, 8), offsetMin: 0 });
    expect(parseCaptureTime('2025-10-20T08:00')).toEqual({ at: Date.UTC(2025, 9, 20, 8), offsetMin: null });
    expect(parseCaptureTime('yesterday')).toBeNull();
  });

  it('stores facts with the columns filters and sorting read', () => {
    const { repos, asset } = profileSetup();
    const id = asset();
    const facts = factsFor({
      orientation: 'portrait',
      hdr: 'hlg',
      speed: 'slow-motion',
      speedFactor: 4,
      captureRate: { num: 120, den: 1 },
      location: { latitude: 15.5, longitude: 73.8 },
      device: { make: 'Apple', model: 'iPhone 17 Pro' },
    });
    const row = unwrap(repos.assets.setFacts(id, facts));
    expect(row).toMatchObject({
      width: 1080,
      height: 1920,
      orientation: 'portrait',
      hdr: 'hlg',
      speed: 'slow-motion',
      frameRateNum: 24,
      frameRateDen: 1,
      hasAudio: true,
      captureTime: Date.UTC(2025, 9, 20, 14, 0),
      captureOffsetMin: 330,
      latitude: 15.5,
      longitude: 73.8,
      deviceMake: 'Apple',
      deviceModel: 'iPhone 17 Pro',
    });
    expect(assetDuration(row)).toEqual(at24(240));
    expect(repos.assets.facts(row)).toEqual(facts);
    const bad = repos.assets.setFacts(id, { ...facts, width: -1 } as MediaFacts);
    expect(!bad.ok && ValidationError.is(bad.error)).toBe(true);
    expect(unwrap(repos.assets.setLanguage(id, 'pt-BR')).language).toBe('pt-BR');
    expect(repos.assets.setLanguage(id, 'not a tag!').ok).toBe(false);
  });

  it('stores a music file’s beat map from its index stage, with the stage done', () => {
    const { db, repos, asset } = profileSetup();
    const id = asset();
    const ms = (value: number) => ({ value, rate: { num: 1000, den: 1 } });
    const beats: BeatMap = {
      rate: { num: 1000, den: 1 },
      beats: [0, 500, 1000, 1500].map(ms),
      downbeats: [0],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.9,
      source: 'tracker',
    };
    const row = () => unwrap(repos.assets.get(id));
    expect(repos.assets.beatMap(row())).toBeNull();
    unwrap(applyStageResult(db, id, 'audio.beats', 0, { beats }, { beatMap: beats }));
    expect(repos.assets.beatMap(row())).toEqual(beats);
    const bad = repos.assets.setBeatMap(id, { ...beats, bpm: -1 });
    expect(!bad.ok && ValidationError.is(bad.error)).toBe(true);
    expect(repos.assets.beatMap(row())).toEqual(beats);
  });

  it("pairs a Live Photo's halves, whichever comes first", () => {
    const { repos, asset } = profileSetup();
    const movie = asset({ name: 'IMG_1.MOV' });
    const still = asset({ kind: 'image', name: 'IMG_1.HEIC' });
    const live = (role: 'still' | 'movie') => ({
      contentId: 'ABC-123',
      role,
      pairedBy: 'content-id' as const,
    });
    unwrap(repos.assets.setFacts(movie, factsFor({ livePhoto: live('movie') })));
    expect(unwrap(repos.assets.get(movie)).companionOf).toBeNull();
    unwrap(repos.assets.setFacts(still, factsFor({ livePhoto: live('still') })));
    expect(unwrap(repos.assets.get(movie)).companionOf).toBe(still);
    expect(unwrap(repos.assets.get(still)).kind).toBe('live_photo');
    unwrap(repos.assets.remove(still));
    expect(unwrap(repos.assets.get(movie)).companionOf).toBeNull();
  });

  it('bumps generations, trashes, restores and marks detached assets', () => {
    const clock = fakeClock();
    const { repos, asset, db, sourceId } = profileSetup(openTestDb({ clock: clock.now }));
    const [a, b] = [asset(), asset()];
    expect(unwrap(repos.assets.reindex([a, b]))).toEqual(
      new Map([
        [a, 1],
        [b, 1],
      ]),
    );
    expect(unwrap(repos.assets.trash([a]))).toBe(1);
    expect(unwrap(repos.assets.trash([a]))).toBe(0);
    expect(unwrap(repos.assets.get(a)).trashedAt).not.toBeNull();
    expect(unwrap(repos.assets.restore([a, b]))).toBe(1);
    expect(unwrap(repos.assets.get(a)).trashedAt).toBeNull();

    // Removing the source detaches its assets (kept, hidden); a location found again attaches them.
    clock.advance(1000);
    unwrap(repos.sources.remove(sourceId));
    expect(unwrap(repos.assets.get(a)).detachedAt).toBe(clock.now());
    expect(markDetached(db)).toBe(0);
    const again = unwrap(
      repos.sources.add({ kind: 'watched_folder', displayName: 'Goa', rootPath: '/Users/me/Goa' }),
    );
    unwrap(
      repos.assetLocations.add({
        assetId: a,
        sourceId: again.id,
        storage: 'referenced',
        relativePath: 'a.mov',
        sizeBytes: 1000,
        state: 'present',
      }),
    );
    expect(unwrap(repos.assets.get(a)).detachedAt).toBeNull();
    expect(unwrap(repos.assets.get(b)).detachedAt).not.toBeNull();
  });
});
