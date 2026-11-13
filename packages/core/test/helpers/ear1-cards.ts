// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-K2's card fixture: a soundResults card with a sound from each source (cards.test.ts and its contract test). */
import { newId, type CardOf } from '@taalcut/core';
import { runId } from './card-fixtures';

export const SOUND_RESULTS_CARD: CardOf<'soundResults'> = {
  type: 'soundResults',
  version: 1,
  id: 'sound-results:1',
  runId,
  query: 'a deep cinematic boom',
  sounds: [
    {
      source: 'bank',
      soundId: 'cut_hit/sub',
      title: 'Cut hit, sub',
      family: 'hit',
      verdict: 'strong',
      z: 3.4,
      licence: 'MIT',
    },
    {
      source: 'bank',
      soundId: 'fit/land_book',
      title: 'Book landing',
      family: 'impact',
      verdict: 'plausible',
      borderline: true,
      z: 2.58,
      licence: 'CC0-1.0',
      credit: '“Book drop” by a recordist on Freesound (CC0 1.0)',
    },
    {
      source: 'pack',
      packItemId: 'impact-soft',
      title: 'Soft impact',
      family: 'impact',
      verdict: 'weak',
      z: 2.1,
      licence: 'CC0-1.0',
    },
    {
      source: 'library',
      assetId: newId<'Asset'>(),
      title: 'my-boom.wav',
      family: null,
      verdict: 'no_match',
      z: 1.2,
    },
  ],
};
