// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L10 filters: applied in SQL after fusion, with the library's visibility defaults. */
import { RationalTime, unwrap, type LibraryFilters, type SearchHit, type ShotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../fixtures/library-themes';
import { searchFixture } from './search-helpers';

const seconds = (n: number) => ({ value: n, rate: { num: 1, den: 1 } });
const length = (hit: SearchHit) => RationalTime.toSeconds(hit.shot.range.duration);

async function hits(s: ReturnType<typeof searchFixture>, query: string, filters?: LibraryFilters) {
  return unwrap(await s.search.search(query, filters, 30)).hits;
}

describe('search filters', () => {
  it('narrow by kind, orientation, duration, quality, date, source, language and speech', async () => {
    const s = searchFixture();
    const [from, to] = [Date.UTC(2025, 9, 20), Date.UTC(2026, 0, 31)];
    const cases: [string, LibraryFilters, (hit: SearchHit) => boolean][] = [
      ['diwali fireworks', { kinds: ['image'] }, (h) => h.asset.kind === 'image'],
      [
        'sunset shots on the beach',
        { orientations: ['portrait'] },
        (h) => h.asset.orientation === 'portrait',
      ],
      ['sunset shots on the beach', { minDuration: seconds(5) }, (h) => length(h) >= 5],
      ['sunset shots on the beach', { maxDuration: seconds(3) }, (h) => length(h) <= 3],
      ['sunset shots on the beach', { minQuality: 0.8 }, (h) => (h.shot.quality ?? 0) >= 0.8],
      [
        'dog running in the park',
        { capturedFrom: from, capturedTo: to },
        (h) => h.asset.capturedAt! >= from && h.asset.capturedAt! <= to,
      ],
      [
        'vegetable market',
        { sourceIds: [s.fixture.sources[1]!] },
        (h) => h.asset.sourceIds.includes(s.fixture.sources[1]!),
      ],
      ['people dancing at a wedding', { languages: ['es'] }, (h) => h.asset.language === 'es'],
      ['diwali fireworks', { hasSpeech: false }, (h) => h.asset.kind === 'image'],
      ['diwali fireworks', { hasSpeech: true }, (h) => h.asset.kind === 'video'],
      ['sunset shots on the beach', { indexStates: ['done'] }, (h) => h.asset.index.state === 'done'],
    ];
    for (const [query, filters, holds] of cases) {
      const found = await hits(s, query, filters);
      expect(found.length, JSON.stringify(filters)).toBeGreaterThan(0);
      expect(found.every(holds), JSON.stringify(filters)).toBe(true);
    }
  });

  it('hide trashed, detached, missing and Live Photo movie halves unless asked', async () => {
    const s = searchFixture();
    const query = 'sunset shots on the beach';
    const top = (await hits(s, query))[0]!;
    unwrap(s.repos.assets.trash([top.asset.id]));
    expect((await hits(s, query)).some((h) => h.asset.id === top.asset.id)).toBe(false);
    expect((await hits(s, query, { includeTrashed: true })).some((h) => h.asset.id === top.asset.id)).toBe(
      true,
    );
    unwrap(s.repos.assets.restore([top.asset.id]));

    const next = (await hits(s, query))[0]!;
    const [location] = s.repos.assetLocations.listByAsset(next.asset.id);
    unwrap(s.repos.assetLocations.setState(location!.id, 'missing'));
    expect((await hits(s, query)).some((h) => h.asset.id === next.asset.id)).toBe(false);
    const missing = await hits(s, query, { availability: ['missing'] });
    expect(missing.map((h) => h.asset.id)).toContain(next.asset.id);
    expect(missing.every((h) => h.asset.availability === 'missing')).toBe(true);

    const movie = (await hits(s, query))[0]!;
    s.db.driver.prepare('UPDATE assets SET companion_of = ? WHERE id = ?').run(next.asset.id, movie.asset.id);
    expect(
      (await hits(s, query, { availability: ['online', 'offline', 'missing'] })).some(
        (h) => h.asset.id === movie.asset.id,
      ),
    ).toBe(false);

    // Removing a source detaches its assets: they leave search with it.
    const source = s.fixture.sources[0]!;
    unwrap(s.repos.sources.remove(source));
    const after = await hits(s, query, { includeTrashed: true });
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((h) => !h.asset.sourceIds.includes(source))).toBe(true);
  });

  it('keep one shot per near-duplicate group unless asked for every take', async () => {
    const s = searchFixture();
    const pairs = s.db.driver
      .prepare('SELECT id, duplicate_group AS leader, best_take FROM shots WHERE duplicate_group IS NOT NULL')
      .all() as { id: ShotId; leader: ShotId; best_take: number }[];
    const other = pairs.find((p) => p.best_take === 0)!;
    const query = THEMES.find((t) => t.key === s.themeOfShot(other.id))!.queries.en;
    const all = async (filters?: LibraryFilters) =>
      unwrap(await s.search.search(query, { ...filters }, 100)).hits.map((h) => h.shot.id);
    expect(await all()).not.toContain(other.id);
    expect(await all({ bestTakesOnly: false })).toContain(other.id);
    expect((await all()).every((id) => !pairs.some((p) => p.id === id && p.best_take === 0))).toBe(true);
  });
});
