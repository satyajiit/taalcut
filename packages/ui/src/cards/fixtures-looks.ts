// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf, Id, StyleSummary } from '@taalcut/core';
import { PROJECT, RUN, T0, TIMELINE } from './fixtures-phase3-ids';

/**
 * The renderer fake's Make ids (apps/renderer src/backend/fake/make/ids.ts), so a card in /dev/kit shows the live
 * names: Golden hour market's three videos, Trip to Goa reel and Monsoon in 60 seconds.
 */
const GOLDEN_2 = '01K7C5M6Q8N000000000000002' as Id<'Timeline'>;
const GOLDEN_3 = '01K7C5M6Q8N000000000000003' as Id<'Timeline'>;
const TRIP_PROJECT = '01K7C5M6Q8R9S0T1V2W3X4P001' as Id<'Project'>;
const TRIP = '01K7C5M6Q8N00000000000000A' as Id<'Timeline'>;
const LONG_PROJECT = '01K7C5M6Q8M000000000000003' as Id<'Project'>;
const LONG = '01K7C5M6Q8N00000000000000M' as Id<'Timeline'>;

const golden = [TIMELINE, GOLDEN_2, GOLDEN_3].map((timelineId) => ({ projectId: PROJECT, timelineId }));
const trip = { projectId: TRIP_PROJECT, timelineId: TRIP };
const long = { projectId: LONG_PROJECT, timelineId: LONG };
const base = { type: 'styleBatch', version: 1, runId: RUN } as const;

/** The fake's seeded looks (apps/renderer phase3/styles/style-seed.ts), for pickers and chips. */
export const WARM_FILM = '01K7C5M6Q8R9S0T1V2W3X4Y5ZR' as Id<'Style'>;
export const LOOK_FIXTURES: readonly StyleSummary[] = [
  {
    id: '01K7C5M6Q8Z000000000000001' as Id<'Style'>,
    name: 'Chai & Co.',
    kind: 'brandKit',
    revision: 3,
    colours: {
      primary: '#c2410c',
      secondary: '#fde68a',
      accent: '#0f766e',
      text: '#1c1917',
      background: '#fff7ed',
    },
    logo: null,
    isDefault: true,
    updatedAt: T0,
  },
  {
    id: '01K7C5M6Q8Z000000000000002' as Id<'Style'>,
    name: 'Monsoon Travels',
    kind: 'brandKit',
    revision: 1,
    colours: {
      primary: '#1d4ed8',
      secondary: '#bfdbfe',
      accent: '#f59e0b',
      text: '#f8fafc',
      background: '#0f172a',
    },
    logo: null,
    isDefault: false,
    updatedAt: T0,
  },
  {
    id: WARM_FILM,
    name: 'Warm film',
    kind: 'look',
    revision: 1,
    colours: {
      primary: '#b45309',
      secondary: '#fcd34d',
      accent: '#9f1239',
      text: '#fffbeb',
      background: '#292524',
    },
    logo: null,
    isDefault: false,
    updatedAt: T0,
  },
];

/** P3-V10, P3-V16: the style batch card. */
export const STYLE_BATCH_FIXTURES: Readonly<Record<string, CardOf<'styleBatch'>>> = {
  /** A look on four videos: a Style never skips. */
  look: {
    ...base,
    id: 'style-batch',
    apply: { kind: 'style', styleId: WARM_FILM, name: 'Warm film', styleKind: 'look' },
    applied: [...golden, trip],
    skipped: [],
    commandId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZS' as Id<'Command'>,
  },
  /** A caption preset: the two videos without captions are skipped. */
  preset: {
    ...base,
    id: 'style-batch-preset',
    apply: { kind: 'captionPreset', presetId: 'bold' },
    applied: [golden[0]!, trip, long],
    skipped: golden.slice(1).map((item) => ({ ...item, reason: 'noCaptions' as const })),
    commandId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZT' as Id<'Command'>,
  },
  /** A brand kit, one video changed since the agent read it: the list folds after four. */
  kit: {
    ...base,
    id: 'style-batch-kit',
    apply: { kind: 'style', styleId: LOOK_FIXTURES[0]!.id, name: 'Chai & Co.', styleKind: 'brandKit' },
    applied: [...golden, long],
    skipped: [{ ...trip, reason: 'changedSince' }],
    commandId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZV' as Id<'Command'>,
  },
  /** Nothing fits: a preset on two videos without captions. */
  none: {
    ...base,
    id: 'style-batch-none',
    apply: { kind: 'captionPreset', presetId: 'karaoke' },
    applied: [],
    skipped: golden.slice(1).map((item) => ({ ...item, reason: 'noCaptions' as const })),
    commandId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZW' as Id<'Command'>,
  },
};
