// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { pairLivePhotos, type LivePhotoCandidate } from '../../src/normalise/live-photo';

const still = (over: Partial<LivePhotoCandidate>): LivePhotoCandidate => ({
  id: 'still',
  kind: 'still',
  baseName: 'IMG_0420',
  session: 'import-1',
  captureTimeMs: 1_000,
  ...over,
});
const movie = (over: Partial<LivePhotoCandidate>): LivePhotoCandidate => ({
  id: 'movie',
  kind: 'movie',
  baseName: 'IMG_0420',
  session: 'import-1',
  captureTimeMs: 1_200,
  durationSec: 3,
  ...over,
});

describe('pairLivePhotos', () => {
  it('pairs on a shared content id', () => {
    const pairs = pairLivePhotos([
      still({ contentId: 'abc' }),
      movie({ contentId: 'abc', baseName: 'other', captureTimeMs: 90_000 }),
    ]);
    expect(pairs).toEqual([{ stillId: 'still', movieId: 'movie', contentId: 'abc', pairedBy: 'content-id' }]);
  });

  it('pairs the same name and session within 2 seconds', () => {
    const pairs = pairLivePhotos([still({}), movie({})]);
    expect(pairs).toEqual([
      { stillId: 'still', movieId: 'movie', contentId: 'IMG_0420', pairedBy: 'name-and-time' },
    ]);
  });

  it('leaves ambiguous, long and distant movies unpaired', () => {
    expect(pairLivePhotos([still({}), movie({ id: 'a' }), movie({ id: 'b' })])).toEqual([]);
    expect(pairLivePhotos([still({}), movie({ durationSec: 4 })])).toEqual([]);
    expect(pairLivePhotos([still({}), movie({ captureTimeMs: 5_000 })])).toEqual([]);
    expect(pairLivePhotos([still({ session: 'a' }), movie({ session: 'b' })])).toEqual([]);
  });
});
