// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2: what the clip page plays (the proxy), scrubs over (the filmstrip), hears (the waveform, the beats) and says
 * about the file (its size).
 */
import { assetDetailSchema, err, ok, unwrap, type DerivedFileRef, type SearchResult } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetDetail,
  assetIndexStages,
  createLibraryService,
  playableOriginal,
  StockUnavailable,
  withWaveform,
  type WaveformReader,
} from '../../src/index';
import { tempDir } from '../helpers';
import { factsFor, profileSetup } from '../repositories/profile-helpers';

const HASH = 'cd'.repeat(32);
const NO_HITS: SearchResult = { hits: [], tookMs: 0 };
const RATE = { num: 30, den: 1 };
const proxy: DerivedFileRef = {
  kind: 'proxy',
  key: `proxies/cd/${HASH}.v1.mp4`,
  bytes: 812_000,
  mimeType: 'video/mp4',
  width: 720,
  height: 1280,
  duration: { value: 183, rate: RATE },
  frameRate: RATE,
  recipe: 1,
};
const sprite: DerivedFileRef = {
  kind: 'filmstrip',
  key: `filmstrips/cd/${HASH}.v2.jpg`,
  bytes: 96_000,
  mimeType: 'image/jpeg',
  width: 864,
  height: 1536,
  recipe: 2,
};
const filmstrip = {
  file: sprite,
  columns: 8,
  rows: 8,
  tileWidth: 108,
  tileHeight: 192,
  times: [0, 91, 182].map((value) => ({ value, rate: RATE })),
};
const waveform: DerivedFileRef = {
  kind: 'waveform',
  key: `waveforms/cd/${HASH}.v1.bin`,
  bytes: 2_452,
  mimeType: 'application/octet-stream',
  recipe: 1,
};

function service(db: ReturnType<typeof profileSetup>['db'], read: WaveformReader) {
  return createLibraryService({
    db,
    originalsRoot: () => ({ path: tempDir() }),
    search: { search: async () => ok(NO_HITS), findSimilar: async () => ok(NO_HITS) },
    http: {
      get: async () => err(StockUnavailable({ provider: 'pexels' })),
      stream: async () => err(StockUnavailable({ provider: 'pexels' })),
    },
    credentials: { get: async () => ok(null) },
    localOnly: () => false,
    waveform: read,
  });
}

describe('the clip page’s parts of the asset detail', () => {
  it('has no proxy, filmstrip, beats or waveform before media made them, and the original’s size', () => {
    const { db, asset } = profileSetup();
    const id = asset();
    const detail = unwrap(assetDetail(db, id));
    expect(assetDetailSchema.safeParse({ ...detail, waveform: null }).success).toBe(true);
    expect(detail.playback).toBeNull();
    expect(detail.filmstrip).toBeNull();
    expect(detail.beats).toBeNull();
    expect(detail.sizeBytes).toBe(1000);
  });

  it('plays media.proxy’s copy and marks the beats audio.beats found', () => {
    const { db, repos, asset } = profileSetup();
    const id = asset();
    unwrap(repos.derivedFiles.put(id, [proxy, waveform]));
    const beats = {
      rate: { num: 1000, den: 1 },
      beats: [0, 500, 1000].map((value) => ({ value, rate: { num: 1000, den: 1 } })),
      downbeats: [0],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.9,
      source: 'tracker' as const,
    };
    unwrap(repos.assets.setBeatMap(id, beats));
    const detail = unwrap(assetDetail(db, id));
    expect(assetDetailSchema.safeParse({ ...detail, waveform: null }).success).toBe(true);
    expect(detail.playback).toMatchObject({ source: 'proxy', file: { key: proxy.key, width: 720, height: 1280 } });
    expect(detail.beats?.beats).toHaveLength(3);
  });

  it('plays the original when media.proxy kept it as its own proxy, and only then serves its file', () => {
    const { db, repos, asset } = profileSetup();
    const id = asset({ name: 'small.mp4' });
    unwrap(repos.assets.setFacts(id, factsFor({ width: 720, height: 1280, orientation: 'portrait' })));
    const proxyStage = (output: unknown, state: 'done' | 'running' = 'done') =>
      db.orm
        .insert(assetIndexStages)
        .values({ assetId: id, stage: 'media.proxy', state, output, updatedAt: 1 })
        .onConflictDoUpdate({
          target: [assetIndexStages.assetId, assetIndexStages.stage],
          set: { state, output },
        })
        .run();

    proxyStage(null, 'running');
    expect(unwrap(assetDetail(db, id)).playback).toBeNull();
    expect(playableOriginal(db, id)).toBeUndefined();

    proxyStage({ reusedOriginal: false, ratio: 0.1, overBudget: false, warnings: [] });
    expect(playableOriginal(db, id)).toBeUndefined();

    proxyStage({ reusedOriginal: true, ratio: 1, overBudget: false, warnings: [] });
    const detail = unwrap(assetDetail(db, id));
    expect(assetDetailSchema.safeParse({ ...detail, waveform: null }).success).toBe(true);
    expect(detail.playback).toMatchObject({ source: 'original', width: 720, height: 1280 });
    expect(playableOriginal(db, id)).toBe('/Users/me/Goa/small.mp4');

    // A copy made later wins: the viewer plays the proxy file.
    unwrap(repos.derivedFiles.put(id, [proxy]));
    expect(unwrap(assetDetail(db, id)).playback).toMatchObject({ source: 'proxy' });
  });

  it('scrubs over the sprite media.filmstrip made, while the media cache still has it', () => {
    const { db, repos, asset } = profileSetup();
    const id = asset();
    const filmstripStage = (state: 'done' | 'running', output: unknown) =>
      db.orm
        .insert(assetIndexStages)
        .values({ assetId: id, stage: 'media.filmstrip', state, output, updatedAt: 1 })
        .onConflictDoUpdate({
          target: [assetIndexStages.assetId, assetIndexStages.stage],
          set: { state, output },
        })
        .run();

    filmstripStage('running', null);
    expect(unwrap(assetDetail(db, id)).filmstrip).toBeNull();
    // Done, but its sprite has no row: the cache let it go, so the detail names no missing file.
    filmstripStage('done', { filmstrip, source: 'keyframes' });
    expect(unwrap(assetDetail(db, id)).filmstrip).toBeNull();
    unwrap(repos.derivedFiles.put(id, [sprite]));
    const detail = unwrap(assetDetail(db, id));
    expect(assetDetailSchema.safeParse({ ...detail, waveform: null }).success).toBe(true);
    expect(detail.filmstrip).toEqual(filmstrip);
    // An output that isn't a filmstrip reads as none.
    filmstripStage('done', { filmstrip: { ...filmstrip, times: [] }, source: 'keyframes' });
    expect(unwrap(assetDetail(db, id)).filmstrip).toBeNull();
  });

  it('never serves an original that isn’t on this Mac', () => {
    const { db, asset } = profileSetup();
    const id = asset({ state: 'missing' });
    db.orm
      .insert(assetIndexStages)
      .values({ assetId: id, stage: 'media.proxy', state: 'done', output: { reusedOriginal: true }, updatedAt: 1 })
      .run();
    expect(playableOriginal(db, id)).toBeUndefined();
  });

  it('reads the waveform’s peaks through the service’s reader, null when there is no file or no answer', async () => {
    const { db, repos, asset } = profileSetup();
    const id = asset();
    const asked: string[] = [];
    const read = async (ref: DerivedFileRef) => (
      asked.push(ref.key),
      { bucketsPerSecond: 50, peaks: [0.2, 0.9] }
    );
    expect(unwrap(await service(db, read).asset(id)).waveform).toBeNull();
    unwrap(repos.derivedFiles.put(id, [waveform]));
    expect(unwrap(await service(db, read).asset(id)).waveform).toEqual({
      bucketsPerSecond: 50,
      peaks: [0.2, 0.9],
    });
    expect(asked).toEqual([waveform.key]);
    expect(unwrap(await service(db, async () => null).asset(id)).waveform).toBeNull();
  });

  it('passes a failed read through untouched', async () => {
    const { db } = profileSetup();
    const missing = err({ code: 'core.not_found', messageKey: 'errors.core.not_found', retryable: false });
    expect(await withWaveform(db, missing, async () => null)).toBe(missing);
  });
});
