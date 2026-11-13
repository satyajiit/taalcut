// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L1 "Done when": a generated fixture library of 200 assets (facts, shots
 * with analyses, transcripts, vectors) opens and serves `browse` (all 200)
 * plus `asset()` for each in under 1 s.
 */
import { join } from 'node:path';
import { assetDetailSchema, assetSummarySchema, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { assetDetail, browseAssets, openDatabase, openVectorIndex, sqliteVecPath } from '../src/index';
import { FAKE_DIMENSIONS, FAKE_SPACE } from './fixtures/fake-embedder';
import { buildFixtureLibrary, FIXTURE_ASSETS } from './fixtures/library-200';
import { tempDir } from './helpers';

const extensions = [sqliteVecPath()];

describe('the 200-asset fixture library (P2-L1)', () => {
  it('opens and serves browse plus every asset in under 1 s', () => {
    const path = join(tempDir(), 'library.db');
    const built = unwrap(openDatabase({ path, extensions }));
    const vectors = unwrap(
      openVectorIndex(built, { name: FAKE_SPACE.indexName, dimensions: FAKE_DIMENSIONS }),
    );
    const fixture = buildFixtureLibrary(built, { vectors });
    expect(vectors.count()).toBeGreaterThan(FIXTURE_ASSETS * 2);
    built.close();

    const started = performance.now();
    const db = unwrap(openDatabase({ path, extensions }));
    const page = unwrap(browseAssets(db, { limit: 200 }));
    const details = page.items.map((item) => unwrap(assetDetail(db, item.id)));
    const elapsed = performance.now() - started;
    process.stdout.write(`[fixture library] open + browse 200 + 200 × asset(): ${elapsed.toFixed(0)} ms\n`);

    try {
      expect(elapsed).toBeLessThan(1000);
      expect(page.total).toBe(FIXTURE_ASSETS);
      expect(page.items).toHaveLength(FIXTURE_ASSETS);
      expect(new Set(page.items.map((i) => i.id))).toEqual(new Set(fixture.assets));
      // What crosses IPC parses with core's schemas.
      for (const item of page.items) expect(assetSummarySchema.safeParse(item).success).toBe(true);
      // The service adds the sound from the media cache (withWaveform); the database read has everything else.
      for (const detail of details)
        expect(assetDetailSchema.safeParse({ ...detail, waveform: null }).success).toBe(true);
      const video = details.find((d) => d.asset.kind === 'video' && d.shots.length > 1)!;
      expect(video.facts?.orientation).toBe(video.asset.orientation);
      expect(video.shots.every((s) => s.analysis !== null && s.description !== null)).toBe(true);
      expect(video.transcript?.lines.length).toBeGreaterThan(0);
      expect(video.asset.thumbnail?.mimeType).toBe('image/jpeg');
      expect(video.locations[0]?.sourceName).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
