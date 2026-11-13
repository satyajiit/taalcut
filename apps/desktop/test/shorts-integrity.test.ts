// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CAPTION_PRESETS,
  newId,
  RationalTime,
  unwrap,
  type Clip,
  type ShortEditPlan,
  type Timeline,
} from '@taalcut/core';
import { assembleShort } from '@taalcut/timeline';
import { describe, expect, it } from 'vitest';
import { shortSourceSignature } from '../src/utility/roots/shorts-integrity';

const t = (value: number) => RationalTime.of(value, { num: 30, den: 1 });
function fixture(): Timeline {
  const assetId = newId<'Asset'>();
  const span = (start: number, source: number) => ({
    start: t(start),
    duration: t(90),
    source: { assetId, range: { start: t(source), duration: t(90) } },
  });
  const plan: ShortEditPlan = {
    candidateId: newId<'ShortCandidate'>(),
    title: 'Source lesson',
    hook: 'A resolved lesson',
    speech: [span(0, 150), span(90, 0)],
    visuals: [span(0, 300), span(90, 30)],
    duration: t(180),
    endingDuration: t(60),
  };
  return unwrap(
    assembleShort(
      {
        projectId: newId<'Project'>(),
        timelineId: newId<'Timeline'>(),
        name: plan.title,
        rate: { num: 30, den: 1 },
        plan,
        assets: new Map([[assetId, { available: { start: t(0), duration: t(900) } }]]),
        styleId: null,
        now: 1,
      },
      { item: () => newId<'TimelineItem'>() },
    ),
  );
}

function editClip(timeline: Timeline, track: number, update: (clip: Clip) => Clip): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((item, index) =>
      index !== track || (item.kind !== 'video' && item.kind !== 'audio')
        ? item
        : {
            ...item,
            items: item.items.map((clip, ordinal) =>
              clip.type === 'clip' && ordinal === 0 ? update(clip) : clip,
            ),
          },
    ),
  };
}

describe('verified short source integrity', () => {
  it.each([
    [
      'source replacement',
      (timeline: Timeline) =>
        editClip(timeline, 0, (clip) => ({ ...clip, media: { ...clip.media, assetId: newId<'Asset'>() } })),
    ],
    [
      'speech trim',
      (timeline: Timeline) => editClip(timeline, 1, (clip) => ({ ...clip, sourceStart: t(153) })),
    ],
    [
      'speech mute',
      (timeline: Timeline) =>
        editClip(timeline, 1, (clip) => ({ ...clip, audio: { ...clip.audio, muted: true } })),
    ],
    [
      'speech reorder',
      (timeline: Timeline) => ({
        ...timeline,
        tracks: timeline.tracks.map((track) =>
          track.kind === 'audio' && track.id === timeline.speechTrackId
            ? { ...track, items: [...track.items].reverse() }
            : track,
        ),
      }),
    ],
    [
      'speech disabled',
      (timeline: Timeline) => ({
        ...timeline,
        tracks: timeline.tracks.map((track) =>
          track.id === timeline.speechTrackId ? { ...track, enabled: false } : track,
        ),
      }),
    ],
    [
      'frozen source picture',
      (timeline: Timeline) => editClip(timeline, 0, (clip) => ({ ...clip, holdFrame: clip.sourceStart })),
    ],
  ])('detects %s before a resumed export', (_name, change) => {
    const timeline = fixture();
    expect(shortSourceSignature(change(timeline))).not.toBe(shortSourceSignature(timeline));
  });

  it('permits caption, brand and picture styling changes without changing the source map', () => {
    const timeline = fixture();
    const styled = editClip(
      {
        ...timeline,
        revision: 9,
        name: 'A better title',
        styleId: newId<'Style'>(),
        captions: {
          enabled: true,
          language: 'en',
          style: CAPTION_PRESETS.bold,
          styleSource: 'user',
          cues: [],
        },
      },
      0,
      (clip) => ({ ...clip, fit: 'cover' }),
    );
    expect(shortSourceSignature(styled)).toBe(shortSourceSignature(timeline));
  });
});
