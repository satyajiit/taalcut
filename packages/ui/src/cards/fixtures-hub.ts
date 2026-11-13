// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model, hub and provider text: data, never translated */

/**
 * P3-B12, P3-V8: the hub results card in each state. The rows are the renderer fake's hub entries (its
 * phase3/hub seed: same ids, versions and sha256), so on /dev/kit Fork really forks and "Removed from the hub"
 * comes from the live hubItem read (Viral dance trend's file is hidden).
 */
import type { CardOf, Id } from '@taalcut/core';
import { at, RUN, T0 } from './fixtures-phase3-ids';

type Item = CardOf<'hubResults'>['items'][number];

const DAY = 86_400_000;
/** The index's age is read against the clock: the fixtures keep theirs (fresh, or three hours old) on any day. */
const FETCHED = Date.now() - 4 * 60_000;
const OLD_INDEX = Date.now() - 3 * 3_600_000;

const MORNING_CAFE: Item = {
  id: '01K7C5M6Q8H000000000000001' as Id<'HubTemplate'>,
  version: 2,
  name: 'Morning café',
  handle: 'mira.cuts',
  language: 'en',
  formatId: 'vlog',
  trendFreshness: '2026-10-01',
  duration: at(294),
  slotCount: 8,
  bpm: 104,
  slotStrip: [35, 34, 35, 52, 34, 35, 35, 34],
  sha256: '6545c0e35dfe7b3b081422e270c2de70b150f8743be7c7ca6c4aa800829fdb84',
  updatedAt: T0 - 2 * DAY,
  rating: { count: 38, mean: 4.6 },
  forkedAs: null,
};

const PUPPY: Item = {
  id: '01K7C5M6Q8H00000000000000M' as Id<'HubTemplate'>,
  version: 3,
  name: 'Puppy first day',
  handle: 'paws.patrol',
  language: 'en',
  formatId: 'highlightReel',
  trendFreshness: '2026-10-14',
  duration: at(257),
  slotCount: 8,
  bpm: 112,
  slotStrip: [32, 32, 16, 16, 33, 32, 32, 64],
  sha256: '58c65395952c89f39e956f936bf57024090530b3d5566419a3022a19711b8b76',
  updatedAt: T0 - DAY,
  rating: { count: 97, mean: 4.8 },
  forkedAs: null,
};

const MONSOON: Item = {
  id: '01K7C5M6Q8H000000000000009' as Id<'HubTemplate'>,
  version: 1,
  name: 'Monsoon diaries',
  handle: 'chai.and.rain',
  language: 'hi',
  formatId: 'vlog',
  trendFreshness: '2026-09-25',
  duration: at(429),
  slotCount: 6,
  bpm: 84,
  slotStrip: [86, 85, 43, 43, 86, 86],
  sha256: '1b06f0aac699c5c8d4c0611dea8fa4061f84c5c2cec1ab541106d6cd208462ff',
  updatedAt: T0 - 3 * DAY,
  rating: { count: 2, mean: 4.5 },
  forkedAs: null,
};

/** Hidden by a maintainer since the search: the fake's file answers hub.hidden. */
const VIRAL: Item = {
  id: '01K7C5M6Q8H000000000000017' as Id<'HubTemplate'>,
  version: 1,
  name: 'Viral dance trend',
  handle: 'trend.tracker',
  language: 'en',
  formatId: 'highlightReel',
  trendFreshness: '2026-10-14',
  duration: at(169),
  slotCount: 10,
  bpm: 128,
  slotStrip: [14, 14, 14, 14, 14, 14, 14, 15, 28, 28],
  sha256: 'b982b7e03f6a6e3a4ca7c622498ad38de6040caf413314bff4047e96947aaa40',
  updatedAt: T0,
  rating: null,
  forkedAs: null,
};

const base = { type: 'hubResults', version: 1, runId: RUN, sort: 'topRated' } as const;

export const HUB_RESULTS_FIXTURES: Readonly<Record<string, CardOf<'hubResults'>>> = {
  results: {
    ...base,
    id: 'hub',
    query: 'café vlog',
    items: [PUPPY, MORNING_CAFE, MONSOON],
    indexFetchedAt: FETCHED,
  },
  stale: { ...base, id: 'hub-stale', query: 'vlog', items: [MORNING_CAFE], indexFetchedAt: OLD_INDEX },
  removed: { ...base, id: 'hub-removed', query: 'dance', items: [VIRAL], indexFetchedAt: FETCHED },
  empty: { ...base, id: 'hub-empty', query: 'underwater wedding', items: [], indexFetchedAt: FETCHED },
  error: {
    ...base,
    id: 'hub-error',
    query: 'street food',
    items: [],
    indexFetchedAt: FETCHED,
    error: { code: 'hub.offline', messageKey: 'errors.hub.offline', retryable: true },
  },
};
