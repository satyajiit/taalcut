// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { DERIVED_KEY_PATTERN, ok, RationalTime, TimeRange, type AssetId } from '@taalcut/core';
import {
  createSubjectTrackStore,
  subjectTrackKey,
  type DerivedJsonFiles,
} from '../../src/reframe/subject-store';
import { RATE_30, sampleAt, trackOf } from './support';

function memoryFiles(): DerivedJsonFiles & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (key) => Promise.resolve(files.get(key) ?? null),
    write: (key, body) => {
      files.set(key, body);
      return Promise.resolve(ok(undefined));
    },
  };
}

const HASH = 'a'.repeat(64);

describe('subject track store', () => {
  const track = trackOf([sampleAt(0, { face: { x: 0.4, y: 0.2, width: 0.1, height: 0.1 } })], 5);
  const hashes = (assetId: AssetId) => () => Promise.resolve(ok(assetId === track.assetId ? HASH : null));

  it('keys tracks by content hash, range and recipe, matching the derived key pattern', () => {
    const key = subjectTrackKey(HASH, track.range);
    expect(key).toMatch(DERIVED_KEY_PATTERN);
    expect(key.startsWith(`subjects/aa/${HASH}.r`)).toBe(true);
    const other = TimeRange.of(RationalTime.of(30, RATE_30), track.range.duration);
    expect(subjectTrackKey(HASH, other)).not.toBe(key);
  });

  it('round-trips a track', async () => {
    const files = memoryFiles();
    const store = createSubjectTrackStore({ files, contentHashOf: hashes(track.assetId) });
    const ref = await store.put(track);
    expect(ref.ok && ref.value).toMatchObject({
      kind: 'subjectTrack',
      mimeType: 'application/json',
      recipe: 1,
    });
    const read = await store.get(track.assetId, track.range);
    expect(read.ok && read.value).toEqual(track);
  });

  it('treats a missing, corrupted or mismatched file as a miss', async () => {
    const files = memoryFiles();
    const store = createSubjectTrackStore({ files, contentHashOf: hashes(track.assetId) });
    expect(await store.get(track.assetId, track.range)).toEqual(ok(null));
    files.files.set(subjectTrackKey(HASH, track.range), '{not json');
    expect(await store.get(track.assetId, track.range)).toEqual(ok(null));
    files.files.set(
      subjectTrackKey(HASH, track.range),
      JSON.stringify({ ...track, contentHash: 'c'.repeat(64) }),
    );
    expect(await store.get(track.assetId, track.range)).toEqual(ok(null));
  });

  it('answers null for an asset without a content hash', async () => {
    const store = createSubjectTrackStore({
      files: memoryFiles(),
      contentHashOf: () => Promise.resolve(ok(null)),
    });
    expect(await store.get(track.assetId, track.range)).toEqual(ok(null));
  });
});
