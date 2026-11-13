// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Timeline v2: graphics, still motion, reframe, voice and effects tracks, voiceover, mix (P3-V2, P3-V13, P3-B6, P3-V6). */
import { describe, expect, it } from 'vitest';
import {
  CAST_NOTES,
  DEFAULT_MIX,
  graphicItemSchema,
  newId,
  SFX_CATEGORIES,
  TIMELINE_SCHEMA_VERSION,
  timelineMixSchema,
  timelineSchema,
  voiceoverSchema,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { at, issuePaths, json, ntscTimeline } from './helpers/documents';
import { COMPOSITION } from './helpers/hfw1';

const timeline = ntscTimeline();
const rate = timeline.canvas.rate;
const [video, audio, text] = timeline.tracks as [
  Extract<Track, { kind: 'video' }>,
  Extract<Track, { kind: 'audio' }>,
  Extract<Track, { kind: 'text' }>,
];
const firstClip = video.items[0]!;
const bed = audio.items[0]!;

const graphic = (start: number, duration: number) => ({
  type: 'graphic',
  id: newId<'TimelineItem'>(),
  anchor: { kind: 'phrase', text: 'my name is Priya', occurrence: 1 },
  start: at(start, rate),
  duration: at(duration, rate),
  placement: 'bottom',
  styleKey: 'label',
  language: 'en',
  origin: 'agent',
  composition: { id: COMPOSITION.id, hash: COMPOSITION.hash, params: { message: 'Priya' } },
});

const withTracks = (tracks: unknown[], extra: Record<string, unknown> = {}) => ({
  ...timeline,
  tracks,
  ...extra,
});

describe('Timeline v2', () => {
  it('is schema version 2, with a look, a voiceover and a mix', () => {
    expect(TIMELINE_SCHEMA_VERSION).toBe(2);
    expect(timelineSchema.parse(json(timeline))).toMatchObject({
      styleId: null,
      voiceover: null,
      mix: DEFAULT_MIX,
    });
    expect(timelineSchema.safeParse({ ...timeline, schemaVersion: 1 }).success).toBe(false);
  });

  it('text tracks hold graphics beside text, without overlap', () => {
    const ok = withTracks([video, audio, { ...text, items: [...text.items, graphic(60, 30)] }]);
    expect(timelineSchema.safeParse(json(ok)).success).toBe(true);
    const overlapping = withTracks([video, audio, { ...text, items: [...text.items, graphic(20, 30)] }]);
    expect(timelineSchema.safeParse(json(overlapping)).success).toBe(false);
  });

  it('only stills move and only video clips are reframed', () => {
    const reframe = { mode: 'subject', nudge: { x: 0.1, y: -0.1 }, scale: 1.1 };
    const reframed = { ...firstClip, reframe };
    expect(
      timelineSchema.safeParse(
        json(withTracks([{ ...video, items: [reframed, ...video.items.slice(1)] }, audio, text])),
      ).success,
    ).toBe(true);
    const moving = { ...firstClip, stillMotion: 'pushIn' };
    expect(
      issuePaths(
        timelineSchema,
        withTracks([{ ...video, items: [moving, ...video.items.slice(1)] }, audio, text]),
      ),
    ).toEqual(['tracks.0.items.0.stillMotion']);
    const still = {
      ...firstClip,
      media: { kind: 'image', assetId: newId<'Asset'>() },
      sourceStart: at(0, rate),
      reframe,
    };
    expect(
      issuePaths(
        timelineSchema,
        withTracks([{ ...video, items: [still, ...video.items.slice(1)] }, audio, text]),
      ),
    ).toContain('tracks.0.items.0.reframe');
    const tooFar = { ...firstClip, reframe: { ...reframe, scale: 2.5, nudge: { x: 0.6, y: 0 } } };
    expect(
      issuePaths(
        timelineSchema,
        withTracks([{ ...video, items: [tooFar, ...video.items.slice(1)] }, audio, text]),
      ),
    ).toEqual(expect.arrayContaining(['tracks.0.items.0.reframe.scale', 'tracks.0.items.0.reframe.nudge.x']));
  });

  it('has at most one voice track and one effects track', () => {
    const copy = (id: string, role: string) => ({
      ...audio,
      id,
      role,
      items: audio.items.map((item) => ({ ...item, id: newId<'TimelineItem'>() })),
    });
    const voice = (id: string) => copy(id, 'voice');
    expect(
      timelineSchema.safeParse(json(withTracks([video, audio, voice('A2'), copy('A3', 'sfx'), text])))
        .success,
    ).toBe(true);
    expect(issuePaths(timelineSchema, withTracks([video, audio, voice('A2'), voice('A3'), text]))).toEqual([
      'tracks.3.role',
    ]);
    expect(
      timelineSchema.safeParse(json(withTracks([video, { ...audio, role: 'music' }, text]))).success,
    ).toBe(false);
  });

  it('a voiceover line plays from a clip on the voice track, once', () => {
    const voiceClip = { ...bed, id: newId<'TimelineItem'>() };
    const voiceTrack = { ...audio, id: 'A2', role: 'voice', items: [voiceClip] };
    const line = (clipId: string | null) => ({
      id: newId<'VoiceLine'>(),
      text: 'Day one in Goa.',
      slotId: null,
      clipId,
      assetId: null,
      quality: 'draft',
      duration: at(54),
      offBeat: false,
    });
    const voiceover = (lines: unknown[]) => ({
      id: newId<'Voiceover'>(),
      voiceId: 'v1',
      voiceName: 'Asha',
      own: false,
      language: 'en',
      seed: 7,
      lines,
    });
    const placed = withTracks([video, audio, voiceTrack, text], {
      voiceover: voiceover([line(voiceClip.id), line(null)]),
    });
    expect(timelineSchema.safeParse(json(placed)).success).toBe(true);
    const twice = withTracks([video, audio, voiceTrack, text], {
      voiceover: voiceover([line(voiceClip.id), line(voiceClip.id)]),
    });
    expect(issuePaths(timelineSchema, twice)).toEqual(['voiceover.lines.1.clipId']);
    const elsewhere = withTracks([video, audio, text], { voiceover: voiceover([line(bed.id)]) });
    expect(issuePaths(timelineSchema, elsewhere)).toEqual(['voiceover.lines.0.clipId']);
    expect(voiceoverSchema.safeParse(voiceover(Array(41).fill(line(null)))).success).toBe(false);
  });

  it('the mix ducks music under the voice within bounds', () => {
    expect(timelineMixSchema.parse(DEFAULT_MIX)).toEqual(DEFAULT_MIX);
    const ducking = { ...DEFAULT_MIX.ducking, marginLu: 4, floorDb: 0 };
    expect(issuePaths(timelineMixSchema, { ducking })).toEqual(['ducking.marginLu', 'ducking.floorDb']);
    expect(SFX_CATEGORIES).toEqual(['whoosh', 'riser', 'impact', 'hit']);
  });

  it('cast notes say when a gap was filled, a slot dropped or a shot asked for', () => {
    expect(CAST_NOTES).toEqual(expect.arrayContaining(['gapFilled', 'dropped', 'filmRequested']));
    const cast = timeline.cast!;
    const noted: Timeline = {
      ...timeline,
      cast: { ...cast, slots: cast.slots.map((slot) => ({ ...slot, note: 'gapFilled' })) },
    };
    expect(timelineSchema.safeParse(json(noted)).success).toBe(true);
  });
});

describe('graphics', () => {
  it('anchor to a phrase, a slot or a time, and sit at a placement or in a box', () => {
    const base = graphic(0, 30);
    const anchors = [
      { kind: 'slot', slotId: newId<'TemplateSlot'>() },
      { kind: 'time', at: at(15, rate) },
    ];
    for (const anchor of anchors) expect(graphicItemSchema.safeParse({ ...base, anchor }).success).toBe(true);
    const box = { box: { x: 0.1, y: 0.7, width: 0.8, height: 0.1 } };
    expect(graphicItemSchema.safeParse({ ...base, placement: box }).success).toBe(true);
    expect(
      graphicItemSchema.safeParse({ ...base, anchor: { kind: 'phrase', text: '', occurrence: 0 } }).success,
    ).toBe(false);
  });
});
