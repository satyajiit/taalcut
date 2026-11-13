// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L10's vector lists: items become ranked shot lists with their similarity, each shot once at its best; a
 * transcript segment is credited to the shot holding its start, or (search-fusion-v2) to every shot it overlaps;
 * an item whose shot is gone takes no place (IX2-F3).
 */
import {
  newId,
  RationalTime,
  TimeRange,
  unwrap,
  type AssetId,
  type ShotId,
  type VectorMatch,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, similarityOf, vectorLists, type TranscriptCredit } from '../../src/index';
import { openTestDb } from '../helpers';

const at = (ms: number) => RationalTime.of(ms, { num: 1000, den: 1 });
const span = (from: number, to: number) => TimeRange.of(at(from), at(to - from));

/** One asset, shots at 0–2, 2–4 and 4–6 s; segments 0.5–3.5 s, an empty one at 4 s, and 7–8 s past the shots. */
function library() {
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const source = unwrap(repos.sources.add({ kind: 'watched_folder', displayName: 'S', rootPath: '/s' }));
  const asset = unwrap(repos.assets.create({ kind: 'video', sizeBytes: 10, originalFilename: 'a.mov' }));
  unwrap(
    repos.assetLocations.add({
      assetId: asset.id,
      sourceId: source.id,
      storage: 'referenced',
      relativePath: 'a.mov',
      sizeBytes: 10,
      state: 'present',
    }),
  );
  const shots = unwrap(
    repos.shots.replaceForAsset(asset.id, 0, [span(0, 2000), span(2000, 4000), span(4000, 6000)]),
  );
  const segment = (text: string, range: TimeRange) => ({ text, range, words: [], language: 'en' });
  unwrap(
    repos.transcripts.put(
      asset.id,
      {
        version: 1,
        language: 'en',
        segments: [
          segment('across two shots', span(500, 3500)),
          segment('empty', span(4000, 4000)),
          segment('after the shots', span(7000, 8000)),
        ],
        engine: 'whisper',
        model: 'm',
        local: true,
        wordTiming: 'native',
      },
      0,
    ),
  );
  return { db, asset: asset.id, shots };
}

const match = (id: string, distance: number): VectorMatch => ({
  id,
  distance,
  metadata: { assetId: null, sourceId: null, kind: null },
});

function transcriptShots(credit: TranscriptCredit, asset: AssetId, db: ReturnType<typeof library>['db']) {
  const segments = [0, 1, 2].map((n) =>
    vectorLists(db, [match(`transcript:${asset}:${n}`, 0.3)], { metric: 'cosine', transcriptCredit: credit }),
  );
  return segments.map((lists) => lists.transcript.map((m) => m.shotId));
}

describe('vector lists', () => {
  it('credit a transcript segment to the shot holding its start, or to every shot it overlaps', () => {
    const { db, asset, shots } = library();
    const [s0, s1, s2] = shots as [ShotId, ShotId, ShotId];
    expect(transcriptShots('start', asset, db)).toEqual([[s0], [s2], [s2]]);
    // An empty segment overlaps nothing and one past the shots overlaps nothing: both keep the start rule.
    expect(transcriptShots('overlap', asset, db)).toEqual([[s0, s1], [s2], [s2]]);
  });

  it('keep each shot once, at its best item, with the similarity the index’s metric implies', () => {
    const { db, shots } = library();
    const [s0, s1] = shots as [ShotId, ShotId];
    const lists = vectorLists(
      db,
      [
        match(`frame:${s1}:0`, 0.2),
        match(`frame:${s0}:1`, 0.25),
        match(`frame:${s1}:3`, 0.4),
        match(`ocr:${s0}:0`, 0.3),
        match('junk', 0),
      ],
      { metric: 'cosine', transcriptCredit: 'overlap' },
    );
    expect(lists.frame).toEqual([
      { shotId: s1, similarity: 0.8 },
      { shotId: s0, similarity: 0.75 },
    ]);
    expect(lists.ocr).toEqual([{ shotId: s0, similarity: 0.7 }]);
    expect(similarityOf(0.3, 'cosine')).toBeCloseTo(0.7);
    // Unit vectors at cosine c are √(2 − 2c) apart.
    expect(similarityOf(Math.sqrt(2 - 2 * 0.7), 'l2')).toBeCloseTo(0.7);
  });

  it('drop an item whose shot the library no longer has, so it takes no rank from a shot that is there', () => {
    const { db, asset, shots } = library();
    const [s0, s1] = shots as [ShotId, ShotId];
    // Left by an older shot list: an on-screen text vector of a shot a re-detection replaced.
    const gone = newId<'Shot'>() as ShotId;
    const lists = vectorLists(
      db,
      [
        match(`ocr:${gone}:0`, 0.1),
        match(`ocr:${s1}:0`, 0.2),
        match(`frame:${gone}:0`, 0.1),
        match(`frame:${s0}:0`, 0.3),
        match(`description:${gone}`, 0.1),
        match(`transcript:${asset}:0`, 0.3),
      ],
      { metric: 'cosine', transcriptCredit: 'start' },
    );
    expect(lists.ocr.map((m) => m.shotId)).toEqual([s1]);
    expect(lists.frame.map((m) => m.shotId)).toEqual([s0]);
    expect(lists.description).toEqual([]);
    expect(lists.transcript.map((m) => m.shotId)).toEqual([s0]);
  });
});
