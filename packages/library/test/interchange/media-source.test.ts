// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pro export's media (P3-V5): an original's path only when a location is present on an online source (the
 * managed copy first), the last path it was seen at otherwise, never a derived file; the grid, the duration in
 * its frames, the size and sound from the library's columns; unknown assets left out.
 */
import { FrameRate, newId, unwrap, type AssetId, type SourceId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createAssetLocationRepository,
  createInterchangeMediaSource,
  createSourceRepository,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb } from '../helpers';

function asset(db: LibraryDatabase, columns: Record<string, string | number | null>): AssetId {
  const id = newId<'Asset'>();
  const all = {
    kind: 'video',
    size_bytes: 10,
    original_filename: 'clip.mov',
    availability: 'online',
    ...columns,
  };
  const names = Object.keys(all);
  db.driver
    .prepare(
      `INSERT INTO assets (id, created_at, updated_at, ${names.join(', ')})
       VALUES (?, 1, 1, ${names.map(() => '?').join(', ')})`,
    )
    .run(id, ...Object.values(all));
  return id;
}

function place(
  db: LibraryDatabase,
  assetId: AssetId,
  sourceId: SourceId,
  path: string,
  options: { storage?: 'managed' | 'referenced'; state?: 'present' | 'offline'; seen?: number } = {},
) {
  const location = unwrap(
    createAssetLocationRepository(db).add({
      assetId,
      sourceId,
      storage: options.storage ?? 'referenced',
      relativePath: path.slice(1),
      absolutePathCached: path,
      sizeBytes: 10,
      state: options.state ?? 'present',
    }),
  );
  db.driver
    .prepare('UPDATE asset_locations SET last_seen_at = ? WHERE id = ?')
    .run(options.seen ?? 1, location.id);
}

function library() {
  const db = openTestDb({ file: false });
  const sources = createSourceRepository(db);
  const add = (rootPath: string, status: 'online' | 'offline' = 'online') =>
    unwrap(sources.add({ kind: 'watched_folder', displayName: rootPath, rootPath, status })).id;
  return { db, online: add('/Users/me/Trip'), offline: add('/Volumes/Card', 'offline') };
}

describe('InterchangeMediaSource', () => {
  it('names the managed copy of an online original, with its grid, frames, size and sound', async () => {
    const { db, online } = library();
    const id = asset(db, {
      width: 1080,
      height: 1920,
      has_audio: 1,
      frame_rate_num: 30000,
      frame_rate_den: 1001,
      duration_value: 10_010,
      duration_rate_num: 1000,
      duration_rate_den: 1,
    });
    place(db, id, online, '/Users/me/Trip/a.mov', { seen: 5 });
    place(db, id, online, '/Users/me/Originals/a.mov', { storage: 'managed', seen: 2 });
    const media = unwrap(await createInterchangeMediaSource(db).resolve([id]));
    expect(media.get(id)).toEqual({
      path: '/Users/me/Originals/a.mov',
      lastKnownPath: '/Users/me/Trip/a.mov',
      name: 'clip.mov',
      rate: FrameRate.of(30000, 1001),
      durationFrames: 300,
      width: 1080,
      height: 1920,
      hasAudio: true,
      audioChannels: null,
      audioRate: null,
    });
  });

  it('gives an offline original no path but its last known one', async () => {
    const { db, online, offline } = library();
    const onCard = asset(db, {});
    place(db, onCard, offline, '/Volumes/Card/b.mov', { seen: 9 });
    const missing = asset(db, {});
    place(db, missing, online, '/Users/me/Trip/gone.mov', { state: 'offline', seen: 3 });
    const media = unwrap(await createInterchangeMediaSource(db).resolve([onCard, missing]));
    expect(media.get(onCard)).toMatchObject({ path: null, lastKnownPath: '/Volumes/Card/b.mov' });
    expect(media.get(missing)).toMatchObject({ path: null, lastKnownPath: '/Users/me/Trip/gone.mov' });
  });

  it('has no grid or frames for a still, sound for an audio file, and leaves unknown assets out', async () => {
    const { db, online } = library();
    const still = asset(db, { kind: 'image', width: 4032, height: 3024 });
    const song = asset(db, {
      kind: 'audio',
      duration_value: 48_000,
      duration_rate_num: 48_000,
      duration_rate_den: 1,
    });
    place(db, still, online, '/Users/me/Trip/c.heic');
    const unknown = newId<'Asset'>();
    const media = unwrap(await createInterchangeMediaSource(db).resolve([still, song, unknown, still]));
    expect([...media.keys()].sort()).toEqual([still, song].sort());
    expect(media.get(still)).toMatchObject({
      rate: null,
      durationFrames: null,
      hasAudio: false,
      width: 4032,
    });
    expect(media.get(song)).toMatchObject({ path: null, lastKnownPath: null, hasAudio: true, width: null });
  });
});
