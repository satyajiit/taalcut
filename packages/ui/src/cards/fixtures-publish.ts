// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model, channel and social copy: data, never translated */

import type { CardOf, Id } from '@taalcut/core';
import { RUN, usd } from './fixtures-phase3-ids';

const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA' as Id<'Project'>;
const TIMELINE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZB' as Id<'Timeline'>;
const TAKE_A = '01K7C5M6Q8100000000000000J' as Id<'Asset'>;
const TAKE_B = '01K7C5M6Q8100000000000001Z' as Id<'Asset'>;
const TAKE_C = '01K7C5M6Q81000000000000003' as Id<'Asset'>;

const hallmarkOk = {
  philosophy: 5,
  hierarchy: 5,
  execution: 4,
  specificity: 5,
  restraint: 5,
  variety: 4,
  passed: true,
} as const;

export const PUBLISH_PACK_FIXTURES: Readonly<Record<string, CardOf<'publishPack'>>> = {
  complete: {
    type: 'publishPack',
    id: 'publish-pack-complete',
    version: 1,
    runId: RUN,
    projectId: PROJECT,
    timelineId: TIMELINE,
    channel: { name: 'Mira Shah', handle: '@mirashah', showOnThumbnail: true },
    thumbnails: [
      {
        aspect: '16:9',
        platform: 'youtube',
        archetype: 'editorial-specimen',
        theme: 'golden-hour',
        hookText: '5 AM AT THE FLOWER MARKET',
        kickerText: 'OLD DELHI · 12 STALLS',
        statBadge: '48S CUT',
        durationBadge: '0:48',
        textAlign: 'left',
        takes: [
          { assetId: TAKE_A, provider: 'google', model: 'imagen-4', thumbnailArtifactId: 'artifact-7' },
          { assetId: TAKE_B, provider: 'openrouter', model: 'flux-2-pro', thumbnailArtifactId: 'artifact-8' },
        ],
        selectedAssetId: TAKE_A,
        hallmark: hallmarkOk,
      },
      {
        aspect: '9:16',
        platform: 'reels',
        archetype: 'atmospheric-cinema',
        theme: 'midnight',
        hookText: 'BEFORE THE CITY WAKES UP',
        kickerText: 'GOLDEN HOUR',
        statBadge: '12 SHOTS',
        durationBadge: '0:48',
        textAlign: 'bottom-left',
        takes: [
          { assetId: TAKE_C, provider: 'google', model: 'imagen-4', thumbnailArtifactId: 'artifact-9' },
        ],
        selectedAssetId: TAKE_C,
        hallmark: hallmarkOk,
      },
    ],
    social: {
      researchSummary: [
        'Opening with the marigold sacks at 00:00 anchors the sensory hook within 1.8 seconds.',
        'Search demand spikes for early-morning market walks and street photography pacing.',
      ],
      youtube: {
        title: '5 AM at the Old Delhi Flower Market — Before the City Wakes Up',
        titleAlternates: [
          'Inside the 5 AM Marigold Market (48 Seconds in Old Delhi)',
          'How Street Vendors Move 4 Tons of Flowers Before Sunrise',
        ],
        description:
          'A 48-second walk through the spice and flower stalls as first light hits the courtyard.',
        tags: ['old delhi', 'flower market', 'morning routine', 'short film', 'street documentary'],
        chapters: [
          { timecode: '00:00', label: 'First chai at the gate' },
          { timecode: '00:14', label: 'Marigold sacks arrive' },
          { timecode: '00:32', label: 'Golden hour over the courtyard' },
        ],
      },
      instagram: {
        hookLine: '5 AM before the market wakes up.',
        caption: 'Twelve stalls, three cups of chai, and crates of fresh marigolds before sunrise.',
        hashtags: ['#olddelhi', '#flowermarket', '#goldenhour', '#streetstories'],
      },
      tiktok: {
        caption: 'What 5 AM looks like inside the flower market before sunrise.',
        seoKeywords: ['delhi flower market', '5am morning walk', 'cinematic reel'],
        hashtags: ['#flowermarket', '#morningwalk', '#cinematicvideo'],
      },
    },
    spent: usd(120_000),
  },
};
