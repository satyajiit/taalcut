// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  clipVisualLayoutSchema,
  creatorProfileSchema,
  FrameRates,
  musicChoiceSchema,
  newId,
  RationalTime,
  shortsRequestSchema,
  timelineSchema,
} from '@taalcut/core';
import { ntscTimeline } from './helpers/documents';

const at = (seconds: number) => RationalTime.fromSeconds(seconds, FrameRates.fps30);
const box = { x: 0, y: 0, width: 1, height: 1 };
const region = { id: 'subject', viewport: box, fit: 'contain', keyframes: [{ at: at(0), crop: box }] };

describe('shorts contracts', () => {
  it('validates the selected total runtime and original source identity', () => {
    const request = {
      projectId: newId<'Project'>(),
      assetId: newId<'Asset'>(),
      duration: at(60),
      platforms: ['reels'],
    };
    expect(shortsRequestSchema.safeParse(request).success).toBe(true);
    expect(shortsRequestSchema.safeParse({ ...request, duration: at(180) }).success).toBe(false);
    expect(shortsRequestSchema.safeParse({ ...request, sourceUrl: 'file:///private/video' }).success).toBe(
      false,
    );
  });

  it('rejects invalid crop geometry, duplicate regions and reversed source keys', () => {
    expect(clipVisualLayoutSchema.safeParse({ regions: [region] }).success).toBe(true);
    expect(clipVisualLayoutSchema.safeParse({ regions: [region, region] }).success).toBe(false);
    expect(clipVisualLayoutSchema.safeParse({ regions: [region, { ...region, id: 'other' }] }).success).toBe(
      false,
    );
    expect(
      clipVisualLayoutSchema.safeParse({
        regions: [
          { ...region, viewport: { ...box, height: 0.5 } },
          { ...region, id: 'other', viewport: { ...box, y: 0.5, height: 0.5 } },
        ],
      }).success,
    ).toBe(true);
    expect(
      clipVisualLayoutSchema.safeParse({ regions: [{ ...region, viewport: { ...box, x: 0.5 } }] }).success,
    ).toBe(false);
    expect(
      clipVisualLayoutSchema.safeParse({
        regions: [
          {
            ...region,
            keyframes: [
              { at: at(1), crop: box },
              { at: at(0), crop: box },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('preserves old timelines and refuses a missing or disabled speech track', () => {
    const timeline = ntscTimeline();
    expect(timelineSchema.safeParse(timeline).success).toBe(true);
    expect(timelineSchema.safeParse({ ...timeline, speechTrackId: 'A9' }).success).toBe(false);
    const track = { kind: 'audio', id: 'A9', name: 'Speech', enabled: true, role: 'clip', items: [] };
    expect(
      timelineSchema.safeParse({ ...timeline, speechTrackId: 'A9', tracks: [...timeline.tracks, track] })
        .success,
    ).toBe(true);
    expect(
      timelineSchema.safeParse({
        ...timeline,
        speechTrackId: 'A9',
        tracks: [...timeline.tracks, { ...track, enabled: false }],
      }).success,
    ).toBe(false);
  });

  it('does not infer external link availability from a creator handle', () => {
    expect(creatorProfileSchema.parse({ youtubeHandle: '@creator' }).profileLinkConfirmed).toBe(false);
    expect(musicChoiceSchema.parse({ path: 'none' })).toEqual({ path: 'none' });
  });
});
