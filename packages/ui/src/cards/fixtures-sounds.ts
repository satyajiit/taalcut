// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample search, bank and file text: data, never translated */

/**
 * EAR1-K2: the soundResults card in each state: results from all three sources (a code-made bank sound, a fitted one
 * on a verdict's line with its credit, a pack sound, the user's own), a genre query's hints, and nothing found.
 */
import type { CardOf } from '@taalcut/core';
import { ASSET, RUN } from './fixtures-phase3-ids';

type Card = CardOf<'soundResults'>;

const base = { type: 'soundResults', version: 1, runId: RUN } as const;

export const SOUND_RESULTS_FIXTURES: Readonly<Record<string, Card>> = {
  results: {
    ...base,
    id: 'sound-results:results',
    query: 'a deep cinematic boom',
    sounds: [
      {
        source: 'bank',
        soundId: 'cut_hit/sub',
        title: 'Cut hit, sub',
        family: 'impact',
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
        // D22: a fitted bank sound is a code-made render (MIT) that credits the CC0 recording it was fitted to.
        licence: 'MIT',
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
      { source: 'library', assetId: ASSET, title: 'my-boom.wav', family: null, verdict: 'no_match', z: 1.2 },
    ],
  },
  hints: {
    ...base,
    id: 'sound-results:hints',
    query: 'calm lo-fi',
    sounds: [
      {
        source: 'bank',
        soundId: 'whoosh_soft/air',
        title: 'Soft air whoosh',
        family: 'whoosh',
        verdict: null,
        z: 1.9,
        licence: 'MIT',
      },
      {
        source: 'pack',
        packItemId: 'riser-warm',
        title: 'Warm riser',
        family: 'riser',
        verdict: null,
        z: 1.4,
        licence: 'CC0-1.0',
      },
    ],
  },
  empty: { ...base, id: 'sound-results:empty', query: 'a dog barking twice', sounds: [] },
};
