// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M1 and P3-V5: exported OTIO validates against the v0.18.1 subset, with gaps, transitions (as markers in v1,
 * Transition.1 when configured), NTSC and 25 fps media, exact rate doubles.
 */
import {
  FrameRates,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type FrameRate,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { MARKER_LABELS, marker } from '../../src/model/markers';
import { otioRate, serializeOtio, toOtio, type ResolveMedia } from '../../src/interchange/otio/otio-writer';
import { otioMetadataSchema, otioTimelineSchema } from '../../src/interchange/otio/schema';
import { buildTimeline } from '../fixtures/timeline';

const online: ResolveMedia = (assetId) => ({
  url: `file:///Volumes/Media/${assetId}.mov`,
  name: `${assetId}.mov`,
});
const withTransitions = { transitions: 'transition' } as const;

function fixture(): Timeline {
  return timelineSchema.parse(draft());
}

/** Six V1 items (25 fps media, a gap, a ramp, a still, two transitions) and two text items at 29.97. */
function draftTimeline(): Timeline {
  const { timeline } = buildTimeline({
    rate: FrameRates.fps29_97,
    beatEvery: 15,
    clips: [
      { frames: 30, mediaRate: FrameRates.fps25, sourceStart: 50, media: 400 },
      {
        frames: 30,
        mediaRate: FrameRates.fps25,
        sourceStart: 60,
        media: 400,
        transition: ['dissolve', 5, 5],
      },
      { frames: 15, gap: true },
      {
        frames: 45,
        ramp: [
          [0, 1],
          [30, 2],
        ],
      },
      { frames: 30, image: true },
      { frames: 30, transition: ['whip', 3, 3] },
    ],
    texts: [
      { start: 0, frames: 20 },
      { start: 30, frames: 30, slot: 1 },
    ],
  });
  return timeline;
}

const CAPTION_STYLE = {
  version: 1,
  font: 'notoSans',
  weight: 700,
  sizePx: 64,
  textColor: '#ffffff',
  highlightColor: '#ffcc00',
  stroke: null,
  background: null,
  highlight: 'color',
  letterCase: 'asIs',
  anchorY: 0.7,
  maxLines: 2,
  maxWords: 4,
} as const;

/** One cue of one word, at frames 10–30. */
function draftCaptions(rate: FrameRate): NonNullable<Timeline['captions']> {
  return {
    enabled: true,
    language: 'en',
    style: CAPTION_STYLE,
    styleSource: 'preset',
    cues: [
      {
        id: newId<'CaptionCue'>(),
        range: { start: RationalTime.of(10, rate), duration: RationalTime.of(20, rate) },
        words: [
          {
            text: 'hello',
            range: { start: RationalTime.of(10, rate), duration: RationalTime.of(10, rate) },
            confidence: 1,
          },
        ],
        edited: false,
      },
    ],
  };
}

function draft(): Timeline {
  const timeline = draftTimeline();
  const rate = timeline.canvas.rate;
  return {
    ...timeline,
    markers: [
      marker(newId<'TimelineItem'>(), 'qa', MARKER_LABELS.offBeat, 60, 1, rate),
      marker(newId<'TimelineItem'>(), 'hook', MARKER_LABELS.hook, 0, 30, rate),
    ],
    captions: draftCaptions(rate),
  };
}

describe('OpenTimelineIO export', () => {
  it('writes only v0.18.1 schemas and validates; transitions stay cuts plus markers by default', () => {
    const exported = toOtio(fixture(), online);
    if (!exported.ok) throw new Error(exported.error.detail);
    const otio = exported.value;
    expect(otioTimelineSchema.safeParse(otio).success).toBe(true);
    const text = serializeOtio(otio);
    const schemas = new Set([...text.matchAll(/"OTIO_SCHEMA": "([^"]+)"/g)].map((match) => match[1]));
    expect([...schemas].sort()).toEqual(
      [
        'Clip.2',
        'ExternalReference.1',
        'Gap.1',
        'Marker.2',
        'RationalTime.1',
        'Stack.1',
        'TimeRange.1',
        'Timeline.1',
        'Track.1',
      ].sort(),
    );
    const purple = otio.tracks.markers.filter((item) => item.color === 'PURPLE');
    expect(purple.map((item) => [item.comment, item.marked_range.start_time.value])).toEqual([
      ['dissolve', 30],
      ['whip', 150],
    ]);
    expect(text).not.toMatch(/Marker\.3|Clip\.1|Filler|"media_reference"/);
    expect(otio.global_start_time).toEqual({ OTIO_SCHEMA: 'RationalTime.1', rate: 30000 / 1001, value: 0 });
  });

  it('maps items: clip ranges at the media rate, gaps from zero, dissolves when configured, Video tracks', () => {
    const exported = toOtio(fixture(), online, withTransitions);
    if (!exported.ok) throw new Error(exported.error.detail);
    const [track] = exported.value.tracks.children;
    expect(track?.kind).toBe('Video');
    const kinds = track!.children.map((child) => child.OTIO_SCHEMA);
    expect(kinds).toEqual([
      'Clip.2',
      'Transition.1',
      'Clip.2',
      'Gap.1',
      'Clip.2',
      'Clip.2',
      'Transition.1',
      'Clip.2',
    ]);
    const first = track!.children[0]!;
    if (first.OTIO_SCHEMA !== 'Clip.2') throw new Error('not a clip');
    expect(first.source_range?.start_time).toEqual({ OTIO_SCHEMA: 'RationalTime.1', rate: 25, value: 50 });
    // 30 frames at 29.97 fps in 25 fps media time, exactly.
    expect(first.source_range?.duration.value).toBeCloseTo((30 * 1001 * 25) / 30000, 12);
    expect(first.active_media_reference_key).toBe('DEFAULT_MEDIA');
    const gap = track!.children[3]!;
    expect(gap.OTIO_SCHEMA === 'Gap.1' && gap.source_range).toMatchObject({
      start_time: { value: 0 },
      duration: { value: 15 },
    });
    const dissolve = track!.children[1]!;
    expect(dissolve.OTIO_SCHEMA === 'Transition.1' && dissolve.transition_type).toBe('SMPTE_Dissolve');
    const whip = track!.children[6]!;
    expect(whip.OTIO_SCHEMA === 'Transition.1' && whip.transition_type).toBe('Custom_Transition');
    // Every cut lands where it is in Taalcut: the clips and gaps add up to the timeline's length.
    const seconds = track!.children.reduce(
      (sum, child) =>
        child.OTIO_SCHEMA === 'Transition.1'
          ? sum
          : sum + child.source_range!.duration.value / child.source_range!.duration.rate,
      0,
    );
    expect(seconds).toBeCloseTo((180 * 1001) / 30000, 9);
  });

  it('puts text, captions and markers on the stack with their colours', () => {
    const exported = toOtio(fixture(), online, withTransitions);
    if (!exported.ok) throw new Error(exported.error.detail);
    const markers = exported.value.tracks.markers;
    expect(markers.map((item) => item.color).sort()).toEqual(['CYAN', 'ORANGE', 'RED', 'YELLOW', 'YELLOW']);
    expect(markers.find((item) => item.color === 'RED')?.comment).toBe('Off the beat');
    expect(markers.find((item) => item.color === 'CYAN')?.comment).toBe('hello');
  });

  it('writes a MissingReference.1 for an offline original and keeps private data under metadata.Taalcut', () => {
    const exported = toOtio(fixture(), () => ({ url: null, name: null, lastKnown: '/Volumes/Gone/a.mov' }));
    if (!exported.ok) throw new Error(exported.error.detail);
    const clip = exported.value.tracks.children[0]!.children[0]!;
    expect(clip.OTIO_SCHEMA === 'Clip.2' && clip.media_references.DEFAULT_MEDIA?.OTIO_SCHEMA).toBe(
      'MissingReference.1',
    );
    expect(clip.OTIO_SCHEMA === 'Clip.2' && clip.media_references.DEFAULT_MEDIA?.metadata).toEqual({
      Taalcut: { lastKnownPath: '/Volumes/Gone/a.mov' },
    });
    expect(exported.value.metadata.Taalcut).toMatchObject({
      schemaVersion: TIMELINE_SCHEMA_VERSION,
      canvas: { rate: { num: 30000, den: 1001 } },
    });
    expect(otioMetadataSchema.safeParse({ Taalcut: { OTIO_SCHEMA: 'Clip.2' } }).success).toBe(false);
    expect(otioMetadataSchema.safeParse({ Resolve_OTIO: {} }).success).toBe(false);
  });

  it('writes every rate as the exact double of num / den, the same double everywhere at that rate', () => {
    const exported = toOtio(fixture(), online);
    if (!exported.ok) throw new Error(exported.error.detail);
    const text = serializeOtio(exported.value);
    const rates = new Set([...text.matchAll(/"rate": ([0-9.e+-]+)/g)].map((match) => Number(match[1])));
    expect([...rates].sort()).toEqual([25, otioRate(FrameRates.fps29_97)].sort());
    expect(text).toContain('"rate": 29.97002997002997');
    expect(text).not.toMatch(/"rate": 29\.97,|"rate": 29\.97002997,/);
  });
});
