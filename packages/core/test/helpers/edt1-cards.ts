// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-CTX's card fixture: a changes card with one row of each kind. */
import { agentTurnGroup, newId, type CardOf } from '@taalcut/core';
import { runId } from './card-fixtures';

const timelineId = newId<'Timeline'>();
const item = (itemKind: 'clip' | 'text' | 'graphic' | 'audio' | 'transition') =>
  ({ kind: 'item', timelineId, itemId: newId<'TimelineItem'>(), itemKind }) as const;

export const EDIT_CHANGES_CARD: CardOf<'editChanges'> = {
  type: 'editChanges',
  version: 1,
  id: 'edit-changes:1',
  runId,
  projectId: newId<'Project'>(),
  timelineId,
  group: agentTurnGroup(runId),
  revisionBefore: 4,
  revisionAfter: 7,
  changes: [
    { target: item('clip'), number: 3, at: 3, change: { kind: 'length', before: 2.4, after: 1.8 } },
    {
      target: item('text'),
      number: 1,
      role: 'title',
      at: 0,
      change: { kind: 'words', before: 'Old words', after: 'New words' },
    },
    { target: item('graphic'), number: 1, at: 2, change: { kind: 'place', before: 'bottom', after: 'top' } },
    { target: item('clip'), number: 4, at: 5, change: { kind: 'speed', before: 1, after: 0.5 } },
    { target: item('transition'), number: 1, at: 5, change: { kind: 'added' } },
    { target: item('audio'), number: 1, at: 0, change: { kind: 'volume', before: 0, after: null } },
    {
      target: { kind: 'timeline', timelineId },
      number: null,
      at: null,
      change: { kind: 'setting', what: 'music' },
    },
  ],
  more: 0,
};

const thumbAssetId = newId<'Asset'>();

export const PUBLISH_PACK_CARD: CardOf<'publishPack'> = {
  type: 'publishPack',
  version: 1,
  id: 'publish-pack:1',
  runId,
  projectId: newId<'Project'>(),
  timelineId,
  channel: {
    name: 'Aarav Field Notes',
    handle: '@aaravfieldnotes',
    showOnThumbnail: true,
  },
  thumbnails: [
    {
      aspect: '16:9',
      platform: 'youtube',
      archetype: 'editorial-specimen',
      theme: 'golden-hour',
      hookText: '48 HOURS IN JAIPUR',
      kickerText: 'OLD CITY · DAWN',
      statBadge: '14 SHOTS',
      durationBadge: '0:42',
      textAlign: 'bottom-left',
      takes: [
        {
          assetId: thumbAssetId,
          provider: 'google',
          model: 'imagen-3',
          thumbnailArtifactId: 'thumb:jaipur-16x9',
        },
      ],
      selectedAssetId: thumbAssetId,
      hallmark: {
        philosophy: 5,
        hierarchy: 5,
        execution: 5,
        specificity: 5,
        restraint: 5,
        variety: 5,
        passed: true,
      },
    },
  ],
  social: {
    researchSummary: ['14 quick-cut shots on 124 BPM beat grid, Jaipur pink sandstone dawn light'],
    youtube: {
      title: '48 Hours in Jaipur: Walking the Pink City Before Sunrise',
      titleAlternates: ['Jaipur at Dawn: 14 Shots Through Hawa Mahal & Amer Fort'],
      description:
        'Walking through Jaipur before sunrise.\n\n00:00 Hawa Mahal at dawn\n00:18 Amer Fort steps',
      tags: ['jaipur', 'rajasthan travel', 'pink city', 'travel filmmaking', 'hawa mahal'],
      chapters: [
        { timecode: '00:00', label: 'Hawa Mahal at dawn' },
        { timecode: '00:18', label: 'Amer Fort steps' },
      ],
    },
    instagram: {
      hookLine: 'Jaipur hits different at 5:40 AM before the traffic wakes up.',
      caption: 'Jaipur hits different at 5:40 AM before the traffic wakes up. Shot across two mornings.',
      hashtags: ['jaipur', 'rajasthantourism', 'travelreels', 'cinematography'],
    },
    tiktok: {
      caption: '5:40 AM in Jaipur before the crowds arrive — 14 shots from the Pink City.',
      seoKeywords: ['jaipur travel guide', 'hawa mahal sunrise', 'india travel aesthetic'],
      hashtags: ['jaipur', 'indiantiktok', 'traveltok', 'filmmaking'],
    },
  },
  spent: { currency: 'USD', micros: 40_000 },
};
