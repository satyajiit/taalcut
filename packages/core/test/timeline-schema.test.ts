// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Timeline v1 (P2-M1): fixtures round-trip, and every invariant fails with its path. */
import { describe, expect, it } from 'vitest';
import { castStateSchema, FrameRates, newId, timelineSchema, type Timeline } from '@taalcut/core';
import { at, captionTrack, issuePaths, json, ntscTimeline, span } from './helpers/documents';

const ntsc = FrameRates.fps29_97;
const paths = (timeline: Timeline) => issuePaths(timelineSchema, json(timeline));

function edit(change: (timeline: Timeline) => void): Timeline {
  const timeline = structuredClone(ntscTimeline());
  change(timeline);
  return timeline;
}

/** The V1 items, typed loosely so a test can break them. */
const track = (timeline: Timeline, index: number) =>
  timeline.tracks[index]!.items as Record<string, unknown>[];
const v1 = (timeline: Timeline) => track(timeline, 0);

describe('Timeline v1', () => {
  it('an NTSC timeline over 25 fps media parses and serialises unchanged', () => {
    const timeline = ntscTimeline();
    const parsed = timelineSchema.parse(json(timeline));
    expect(parsed).toEqual(timeline);
    expect(json(parsed)).toEqual(json(timeline));
  });

  it('accepts a timeline with no cast, captions or text, and other music', () => {
    const plain = edit((t) => {
      t.tracks = [t.tracks[0]!];
      t.cast = null;
      t.captions = null;
      t.markers = [];
      t.music = { path: 'ownTrack', assetId: newId<'Asset'>(), offset: at(0, ntsc), gainDb: -6 };
    });
    expect(paths(plain)).toEqual([]);
  });

  it.each<[string, (timeline: Timeline) => void, string]>([
    ['two video tracks', (t) => void t.tracks.push({ ...t.tracks[0]!, id: 'V2' } as never), 'tracks.3'],
    ['a first track that is not V1', (t) => void t.tracks.reverse(), 'tracks.0'],
    ['a track id that disagrees with its kind', (t) => void (t.tracks[1]!.id = 'T2'), 'tracks.1.id'],
    ['duplicate track ids', (t) => void t.tracks.push({ ...t.tracks[2]!, items: [] }), 'tracks.3.id'],
    ['duplicate item ids', (t) => void (v1(t)[2]!.id = v1(t)[0]!.id), 'tracks.0.items.2.id'],
    ['a transition first', (t) => void v1(t).unshift(v1(t).splice(1, 1)[0]!), 'tracks.0.items.0'],
    ['a transition beside a gap', (t) => void v1(t).splice(2, 1), 'tracks.0.items.1'],
    [
      'offsets past a handle',
      (t) => void (v1(t)[2]!.sourceStart = at(0, FrameRates.fps25)),
      'tracks.0.items.1.inOffset',
    ],
    [
      'an outgoing handle past the media',
      (t) => void (v1(t)[0]!.sourceStart = at(197, FrameRates.fps25)),
      'tracks.0.items.1.outOffset',
    ],
    [
      'an offset longer than the clip',
      (t) => void (v1(t)[1]!.inOffset = at(61, ntsc)),
      'tracks.0.items.1.inOffset',
    ],
    [
      'a clip past its media',
      (t) => void (v1(t)[0]!.sourceStart = at(240, FrameRates.fps25)),
      'tracks.0.items.0.sourceStart',
    ],
    ['a zero-length gap', (t) => void (v1(t)[3]!.duration = at(0, ntsc)), 'tracks.0.items.3.duration'],
    [
      'a duration at another rate',
      (t) => void (v1(t)[3]!.duration = at(30, FrameRates.fps30)),
      'tracks.0.items.3.duration',
    ],
    ['overlapping text in one track', (t) => void (track(t, 2)[1]!.start = at(20, ntsc)), 'tracks.2.items.1'],
    ['text past the video', (t) => void (track(t, 2)[1]!.start = at(140, ntsc)), 'tracks.2.items.1'],
    [
      'a cast slot naming a missing clip',
      (t) => void (t.cast!.slots[0]!.clipId = newId<'TimelineItem'>()),
      'cast.slots.0.clipId',
    ],
    [
      'a clip filling two slots',
      (t) => void (t.cast!.slots[1]!.clipId = t.cast!.slots[0]!.clipId),
      'cast.slots.1.clipId',
    ],
    [
      'a caption past the video',
      (t) => void (t.captions = captionTrack([[150, 30]])),
      'captions.cues.0.range',
    ],
    [
      'overlapping captions',
      (t) =>
        void (t.captions = captionTrack([
          [0, 30],
          [20, 30],
        ])),
      'captions.cues.1.range',
    ],
    [
      'a caption word outside its cue',
      (t) => void (t.captions!.cues[0]!.words[0]!.range = span(40, 5, ntsc)),
      'captions.cues.0.words.0.range',
    ],
    [
      'a duplicate caption cue',
      (t) => void (t.captions!.cues[1]!.id = t.captions!.cues[0]!.id),
      'captions.cues.1.id',
    ],
    [
      'a marker at another rate',
      (t) => void (t.markers[0]!.range = span(0, 30, FrameRates.fps30)),
      'markers.0.range.start',
    ],
    [
      'a ramp past its clip',
      (t) =>
        void (v1(t)[0]!.speed = {
          points: [
            { at: at(0, ntsc), speed: 1 },
            { at: at(61, ntsc), speed: 2 },
          ],
          curve: 'linear',
        }),
      'tracks.0.items.0.speed.points.1.at',
    ],
    [
      'an anchor on no beat',
      (t) => void (v1(t)[0]!.beatAnchor = { beatIndex: 0, offset: at(0, ntsc) }),
      'tracks.0.items.0.beatAnchor.beatIndex',
    ],
  ])('rejects %s', (_name, change, path) => {
    expect(paths(edit(change))).toContain(path);
  });

  it('casts at most ten variants and keeps three alternates', () => {
    const cast = ntscTimeline().cast!;
    expect(castStateSchema.safeParse({ ...cast, variantCount: 11 }).success).toBe(false);
    expect(castStateSchema.parse(json(cast))).toEqual(cast);
  });
});
