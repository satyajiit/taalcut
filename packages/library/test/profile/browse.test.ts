// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** library.browse: filters, sorts and keyset paging over the generated fixture library (P2-L1). */
import { RationalTime, unwrap, ValidationError, type AssetSummary, type LibraryFilters } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { browseAssets, createRepositories, type BrowseInput, type LibraryDatabase } from '../../src/index';
import { buildFixtureLibrary, FIXTURE_ASSETS, type FixtureLibrary } from '../fixtures/library-200';
import { openTestDb } from '../helpers';

function library(): { db: LibraryDatabase; fixture: FixtureLibrary } {
  const db = openTestDb({ file: false });
  return { db, fixture: buildFixtureLibrary(db) };
}

function all(db: LibraryDatabase, input: BrowseInput = {}): AssetSummary[] {
  const items: AssetSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = unwrap(browseAssets(db, { ...input, limit: 37, ...(cursor ? { cursor } : {}) }));
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const count = (db: LibraryDatabase, filters: LibraryFilters) =>
  unwrap(browseAssets(db, { filters, limit: 1 })).total;

describe('library.browse', () => {
  it('pages every asset once, in sort order, in either direction', () => {
    const { db, fixture } = library();
    for (const sort of ['captured', 'added', 'duration', 'quality'] as const) {
      for (const direction of ['desc', 'asc'] as const) {
        const items = all(db, { sort, direction });
        expect(items).toHaveLength(FIXTURE_ASSETS);
        expect(new Set(items.map((i) => i.id))).toEqual(new Set(fixture.assets));
        const key = (i: AssetSummary) =>
          sort === 'captured'
            ? (i.capturedAt ?? i.addedAt)
            : sort === 'added'
              ? i.addedAt
              : sort === 'duration'
                ? i.duration
                  ? RationalTime.toSeconds(i.duration)
                  : -1
                : (i.quality ?? -1);
        const keys = items.map(key);
        const sorted = [...keys].sort((a, b) => (direction === 'asc' ? a - b : b - a));
        expect(keys).toEqual(sorted);
      }
    }
    expect(browseAssets(db, { cursor: 'not-a-cursor' }).ok).toBe(false);
    const bad = browseAssets(db, { cursor: Buffer.from('{}').toString('base64url') });
    expect(!bad.ok && ValidationError.is(bad.error)).toBe(true);
  });

  it('filters by kind, orientation, duration, quality, date, source, language, speech and index state', () => {
    const { db, fixture } = library();
    const kinds = all(db, { filters: { kinds: ['image'] } });
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((i) => i.kind === 'image')).toBe(true);
    expect(all(db, { filters: { orientations: ['square'] } }).every((i) => i.orientation === 'square')).toBe(
      true,
    );
    const long = all(db, { filters: { minDuration: RationalTime.of(10, { num: 1, den: 1 }) } });
    expect(long.every((i) => i.duration && RationalTime.toSeconds(i.duration) >= 10)).toBe(true);
    const short = count(db, { maxDuration: RationalTime.of(9999, { num: 1000, den: 1 }) });
    expect(long.length + short).toBe(FIXTURE_ASSETS - kinds.length);
    expect(all(db, { filters: { minQuality: 0.85 } }).every((i) => (i.quality ?? 0) >= 0.85)).toBe(true);
    const from = Date.UTC(2025, 10, 1);
    const dated = all(db, { filters: { capturedFrom: from, capturedTo: from + 30 * 86_400_000 } });
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.every((i) => i.capturedAt! >= from)).toBe(true);
    expect(count(db, { sourceIds: [fixture.sources[0]!] })).toBe(Math.ceil(FIXTURE_ASSETS / 3));
    expect(all(db, { filters: { languages: ['hi'] } }).every((i) => i.language === 'hi')).toBe(true);
    expect(count(db, { hasSpeech: true }) + count(db, { hasSpeech: false })).toBe(FIXTURE_ASSETS);
    expect(count(db, { hasSpeech: false })).toBe(kinds.length);
    const failed = all(db, { filters: { indexStates: ['failed'] } });
    expect(failed.length).toBe(FIXTURE_ASSETS / 40);
    expect(failed.every((i) => i.index.state === 'failed')).toBe(true);
    expect(count(db, { indexStates: ['done', 'waiting', 'failed', 'indexing'] })).toBe(FIXTURE_ASSETS);
  });

  it('hides missing, trashed and detached assets unless asked', () => {
    const db = openTestDb({ file: false });
    const fixture = buildFixtureLibrary(db);
    const repos = createRepositories(db);
    const [first, second] = fixture.assets;
    unwrap(repos.assets.trash([first!]));
    for (const location of repos.assetLocations.listByAsset(second!))
      unwrap(repos.assetLocations.setState(location.id, 'missing'));
    expect(count(db, {})).toBe(FIXTURE_ASSETS - 2);
    expect(count(db, { includeTrashed: true })).toBe(FIXTURE_ASSETS - 1);
    expect(count(db, { availability: ['missing'] })).toBe(1);
    expect(all(db, { filters: { includeTrashed: true } }).find((i) => i.id === first)?.trashed).toBe(true);
    unwrap(repos.sources.remove(fixture.sources[0]!));
    expect(count(db, { includeTrashed: true, availability: ['online', 'offline', 'missing'] })).toBe(
      FIXTURE_ASSETS - Math.ceil(FIXTURE_ASSETS / 3),
    );
  });
});
